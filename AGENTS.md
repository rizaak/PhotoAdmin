<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PhonoManager

App tipo Pixieset: un fotógrafo entrega galerías de fotos a sus clientes (bodas, graduaciones,
smash cake, newborn, familiares, sesiones personales). Dos roles: **fotógrafo** (admin, sesión
Auth0) y **cliente** (sesión propia por galería, sin cuenta). Repo: github.com/rizaak/PhotoAdmin.

Lee esto ANTES de explorar el código a ciegas — evita quemar tokens redescubriendo lo que ya está
decidido. Si algo aquí no cuadra con lo que ves en el código, el código manda (este documento se
actualiza a mano y puede quedar un paso atrás).

## Stack

Next.js 16 App Router (TS strict, `src/`, alias `@/*`) · React 19 · Drizzle ORM + PostgreSQL (Neon
en prod, PGlite en memoria en tests) · Auth0 v4 (`@auth0/nextjs-auth0`) para el fotógrafo · JWT
propio (`jose`, HS256) para sesiones de cliente · Cloudflare R2 (S3 API) para storage · `sharp`
para el pipeline de imágenes · `motion` (framer-motion) para animaciones del cliente · `next-intl`
(es default, en) · Zod en cada frontera de dominio · Vitest.

## Mapa del código

- `src/server/*` — dominio puro, tenant-scoped, sin JSX. Cada función recibe `db` + `studioId` (o
  `clientId`) explícitos, nunca los infiere. Módulos clave:
  - `auth.ts` / `client-auth.ts` / `client-session.ts` — `requireStudio()` (fotógrafo, Auth0) vs.
    sesión de cliente (JWT propio, cookie `client_session` con `path=/g/{slug}`, 30 días).
  - `galleries.ts`, `sections.ts`, `photos.ts` — CRUD tenant-scoped; toda foto vive en una sección
    (`photos.section_id` NOT NULL — no existe "sin sección").
  - `watermarks.ts` — catálogo de hasta 3 marcas por ESTUDIO (texto o PNG, opacidad/tamaño/
    posición); cada galería selecciona UNA marca del catálogo (`galleries.watermark_id`, nullable)
    o ninguna — las marcas NO se componen entre sí.
  - `images.ts` — pipeline sharp: `applyWatermarks`/`makeDerivatives` generan variantes fijas
    `{dir}/thumb|web|high(+-wm).jpg`.
  - `processing.ts` — `processPhoto` (unifica subida inicial + reprocess/retry), carga la marca
    seleccionada de la galería y genera las 6 variantes.
  - `delivery.ts` — el corazón de la seguridad de entrega: `effectiveWatermarkMode` (herencia
    foto→sección→galería), `effectiveDownloadEnabled`, `enabledResolutions`, `viewKeys`,
    `downloadKey`, `clientViewPhotos`. **Fail-closed**: si falta la variante `-wm` requerida, la
    foto queda excluida — nunca se sirve la variante limpia como fallback.
  - `client-access.ts` — `getClientGalleryData` (cliente autenticado, solo secciones visibles +
    fotos publicadas+ready) y `getPreviewGalleryData` (fotógrafo, `/g/[slug]/preview`, incluye
    borradores, sin likes/comentarios).
  - `cover.ts` — `pickCoverSource`: prioridad imagen subida > foto elegida > primera foto elegible.
  - `storage.ts` — presign R2 (PUT ≤600s/GET ≤900s clamped, `ContentLength` firmado).
  - `zip.ts` — arma el manifest para el Worker de ZIP.
  - `engagement.ts` / `activity.ts` — likes/comentarios (un comentario editable por foto y
    cliente) y el log de actividad para el fotógrafo.
- `src/app/g/[slug]/` — la galería del cliente. `page.tsx` (autenticado) y `preview/page.tsx`
  (fotógrafo, ver abajo) comparten `build-props.ts`. Componentes: `access-form.tsx` (puerta),
  `gallery-cover.tsx` (4 estilos de portada), `title-bar.tsx` (barra pegajosa con pestañas de
  secciones visibles + favoritas + menú ZIP), `photo-grid.tsx` (grid justificado/aireado/cuadrado),
  `lightbox.tsx` (inmersivo, sin contador, controles SVG auto-ocultables). `design-options.ts`
  tiene los tokens de los 4 ejes de diseño (`coverStyle`/`fontSet`/`palette`/`gridStyle` — NO son
  plantillas fijas, son ejes independientes que cada galería combina a su gusto).
- `src/app/admin/galleries/[id]/` — panel del fotógrafo: `photo-uploader.tsx`/`photo-manager.tsx`
  (exige sección para subir), `design-section.tsx` (los 4 ejes + subir portada + picker de foco
  clicable), `delete-section.tsx` (eliminar sección con fotos exige mover a otra), `share-links.tsx`
  (botones Vista previa / Copiar enlace).
- `src/app/admin/settings/` — catálogo de marcas de agua del estudio (independiente de galerías).
- `workers/zip/` — Cloudflare Worker STANDALONE (su propio `package.json`/`tsconfig.json`, excluido
  del `tsconfig` raíz) que arma el ZIP en streaming (zip64 store-mode implementado a mano,
  verificado contra unzip/Python/ditto) verificando un JWT firmado con `ZIP_SIGNING_SECRET`.
  Requiere plan Workers **Paid** (CPU) — normalmente el usuario aún no lo ha desplegado; sin
  `ZIP_WORKER_URL` en `.env.local` la app funciona igual, solo el ZIP queda deshabilitado.
- `docs/superpowers/specs/` y `docs/superpowers/plans/` — specs de diseño y planes de
  implementación de cada feature, en orden cronológico por nombre de archivo. Son la fuente de
  verdad de las decisiones de producto tomadas; léelos antes de rehacer una decisión ya tomada.
- `.superpowers/sdd/progress.md` — ledger de ejecución (gitignored, scratch) con qué tareas de cada
  plan quedaron hechas y qué se dejó pendiente a propósito.

## Invariantes de seguridad (no negociables)

1. **Fail-closed en entrega**: nunca debe llegar al cliente una variante limpia cuando el modo
   efectivo exige marca. Toda la lógica vive en `delivery.ts` — si tocas algo relacionado con
   vista/descarga/ZIP, pasa por sus funciones, no reimplementes el gate.
2. **Tenant scoping estricto**: toda función de `src/server/*` recibe `studioId` (o `clientId`) y
   filtra por él en la query, nunca confía en un id que "ya viene filtrado". Los tests de dominio
   incluyen siempre un caso "intruso" (otro estudio no puede leer/mutar).
3. **`galleryId`/`studioId` siempre de la sesión**, nunca de input del cliente.
4. **R2 privado siempre**: solo URLs prefirmadas de vida corta; nunca exponer el bucket.
5. El modo **preview** (`/g/[slug]/preview`) exige `requireStudio()` + que la galería sea del
   estudio; NUNCA crea ni toca una sesión de cliente; las 4 acciones de cliente (like/comentario/
   descarga/zip) deben ser inalcanzables a nivel de handler cuando `previewMode` es true, no solo
   ocultas visualmente.
6. Nunca imprimir ni hacer `cat`/`echo` de `.env.local` ni de sus variables. Para correr comandos
   que necesitan esas variables (p. ej. migraciones): `sh -c 'set -a; . ./.env.local; set +a; <comando>'`.

## Patrones y gotchas ya resueltos (no los redescubras)

- **sharp 0.35 + ESM**: `import sharp, { type Metadata } from "sharp"` — acceder a `sharp.Metadata`
  como namespace falla con `moduleResolution: bundler`.
- **`sharp().stats()` ignora `.extract()` previo en la misma cadena** — si necesitas estadísticas de
  una región, extrae a un buffer primero y vuelve a envolver con `sharp()` antes de `.stats()`.
- **React 19 + Server Actions**: un formulario no controlado se resetea a su `defaultValue` original
  tras la acción, no al valor guardado — usa `key={algo-que-cambie-al-guardar}` para remontar el
  formulario con datos frescos (patrón usado en varios formularios del admin).
- **`useState`/efectos que notifican al padre**: nunca llames al `onChange` del padre DENTRO de un
  updater de `setState` (React tira "Cannot update a component while rendering another") — hazlo en
  un `useEffect` separado sobre el estado ya actualizado.
- **next-intl con variables ICU** (`{count}` etc.): si el string se interpola después en cliente con
  `.replace()`, pide la clave con `t.raw("key") as string`, no `t("key")` (que exige la variable en
  el momento y explota).
- **Promesas fire-and-forget** (p. ej. enviar email) mueren tras la respuesta en Vercel — envuélvelas
  en `after()` de `next/server`.
- **Next.js 16 puede diferir de tu conocimiento previo** de versiones anteriores — antes de asumir
  una API, revisa `node_modules/next/dist/docs/`.
- **Migraciones con datos**: `drizzle-kit generate` genera el DDL; cuando hace falta mover datos
  (backfill, mapeo de valores viejos→nuevos), edita a mano el SQL generado insertando los
  `UPDATE`/`INSERT` necesarios ANTES de los `DROP COLUMN`/`SET NOT NULL`, separados con
  `--> statement-breakpoint`. El SQL final debe ser válido también contra PGlite (los tests aplican
  toda la carpeta `./drizzle` desde cero).
- **Zod v4** en todas las fronteras de dominio (nunca confiar en el tipo de TS solo).

## Flujo de trabajo (así es como yo — Claude — trabajo aquí; síguelo si quieres el mismo resultado)

Este proyecto usa el plugin `superpowers`. Para cualquier feature nueva o cambio de diseño no
trivial, el flujo es:

1. **`superpowers:brainstorming`** — preguntas una a la vez, proponer 2-3 enfoques, presentar el
   diseño por secciones y esperar aprobación explícita del usuario en cada una.
2. Guardar el spec aprobado en `docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md` y commitear.
3. **`superpowers:writing-plans`** — plan con tareas TDD de grano fino (pasos de 2-5 min, código
   completo en cada paso, sin placeholders), guardado en
   `docs/superpowers/plans/YYYY-MM-DD-<tema>.md` y commiteado.
4. **`superpowers:subagent-driven-development`** — por cada tarea: rama propia, subagente
   implementador (modelo según complejidad: mecánico→barato, integración→medio, diseño→el más
   capaz), luego un subagente revisor que da DOS veredictos (cumplimiento de spec + calidad de
   código), fixes dirigidos a Critical/Important, re-review hasta quedar limpio. Registrar cada
   tarea cerrada en `.superpowers/sdd/progress.md`.
5. Al terminar todas las tareas: **review final de rama completa** en el modelo más capaz
   disponible, con foco explícito en invariantes de seguridad + hallazgos diferidos acumulados.
6. **`superpowers:finishing-a-development-branch`** — el usuario históricamente pide "merge a main
   + push" al cerrar cada feature; confirma con él si no es evidente por el contexto reciente.

Para bugs puntuales o pedidos pequeños y bien acotados (como este mismo documento, o un fix de una
línea), no hace falta todo el flujo — arréglalo directo, corre el gate, y si el usuario pide
commit/push, hazlo.

## Comandos

```bash
npm test                 # Vitest + PGlite (no requiere Postgres real)
npx tsc --noEmit          # type-check
npm run build             # build de Next
npx eslint src tests      # el gate exige CERO warnings, no solo cero errores
npm run db:generate       # generar migración tras cambiar src/db/schema.ts
sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'   # aplicar a Neon (nunca imprimir el .env.local)
cd workers/zip && npx tsc --noEmit   # el worker tiene su propio gate, tsconfig raíz lo excluye
```

Gate completo antes de cualquier commit de feature: `npm test && npx tsc --noEmit && npm run build
&& npx eslint src tests` (cero warnings).

## Variables de entorno relevantes

`DATABASE_URL` (Neon), credenciales Auth0, credenciales R2, `CLIENT_SESSION_SECRET` (obligatoria,
`openssl rand -hex 32`), `ZIP_SIGNING_SECRET` + `ZIP_WORKER_URL` (opcionales, sin ellas el ZIP se
deshabilita solo), `RESEND_API_KEY` + `RESEND_FROM` (opcionales, sin ellas los emails son no-op).

## Estado / pendientes conocidos del usuario (no tuyos, no los "arregles" sin que te lo pidan)

- Deploy del Worker de ZIP (`workers/zip`, requiere Workers Paid) + `ZIP_WORKER_URL` en `.env.local`.
- `RESEND_API_KEY` sin configurar todavía (emails de actividad en no-op).
- Plugin propio de Lightroom que sube fotos a R2 — integración (API keys + endpoints) diferida,
  pendiente de que el usuario lo comparta para revisarlo.
- Janitor de objetos huérfanos en R2 (portadas/PNGs subidos y nunca guardados) — no implementado,
  bajo impacto, mencionado en varios reviews como diferido.

Para el detalle línea por línea de qué se decidió y por qué en cada feature, el spec y el plan de
esa fecha en `docs/superpowers/specs/` y `docs/superpowers/plans/` son la fuente de verdad — este
documento es el resumen, no el reemplazo.
