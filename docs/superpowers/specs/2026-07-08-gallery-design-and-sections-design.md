# PhonoManager — Diseño por galería (ejes), secciones obligatorias, preview y compartir

**Fecha:** 2026-07-08
**Estado:** Aprobado por el usuario (diseño validado por secciones; catálogos delegados con "confío en ti")
**Reemplaza:** el modelo de plantillas fijas de `docs/superpowers/specs/2026-07-08-client-gallery-templates-design.md` (mergeado hoy) — la infraestructura (tokens, fuentes, covers, grid, lightbox) se conserva y se REORGANIZA en ejes.

## Resumen

Desaparecen las 4 plantillas fijas. Cada galería tiene una sección **Diseño** con 4 ejes
independientes (portada, tipografía, colores, cuadrícula) + imagen de portada propia con punto de
foco. Además: toda foto pertenece a una sección (se elimina "sin sección"), la galería del cliente
navega por **pestañas de secciones visibles** con **filtro de favoritas**, el admin gana **modo
preview** con banda y **copiar enlace**.

## Modelo de datos (galleries)

Migración 0008 (una sola):

- Nuevas columnas con default: `cover_style` text `full`, `font_set` text `elegante`,
  `palette` text `blanco`, `grid_style` text `justificada`, `cover_image_key` text nullable.
- Mapeo desde `cover_template`: editorial→(full, elegante, blanco, justificada),
  cinematico→(overlay, dramatica, carbon, justificada), luminoso→(overlay, amable, calido, aireada),
  clasico→(split, clasica, marfil, cuadrada). Luego DROP `cover_template` y DROP `theme`.
- `photos.section_id` pasa a NOT NULL: antes, cada galería con fotos huérfanas recibe una sección
  "Fotos" (position al final, visible) y sus fotos se mueven ahí.

Constantes en `src/db/schema.ts` (mismo patrón que GALLERY_TEMPLATES, que desaparece):
`COVER_STYLES = ["full","overlay","split","banner"]`, `FONT_SETS = ["elegante","dramatica","amable","clasica"]`,
`PALETTES = ["blanco","marfil","calido","carbon","noche"]`, `GRID_STYLES = ["justificada","aireada","cuadrada"]`.

## Catálogos (elegidos por Claude con aprobación delegada)

- **Portada** (`coverStyle`): `full` foto 100vh, título centrado, flecha de scroll SOBRE la foto;
  `overlay` foto 78vh, título abajo-izquierda con degradado hacia el fondo de la paleta;
  `split` mitad texto / mitad foto con filete de acento; `banner` foto 50vh con título debajo.
- **Tipografía** (`fontSet`): `elegante` Cormorant Garamond 300 + Inter (tracking amplio, uppercase);
  `dramatica` Playfair Display itálica + Inter; `amable` Nunito; `clasica` EB Garamond + Lato.
  (Fuentes ya cargadas vía next/font — se desacoplan de las paletas.)
- **Colores** (`palette`): `blanco` #ffffff/#1a1a1a acento #1a1a1a; `marfil` #faf7f2/#2b2b2b
  acento #b59a68; `calido` #fdf9f4/#5b4a3f acento #c98d6b; `carbon` #0e0e10/#f4f1ea acento #c8a96a
  (oscura); `noche` #12151c/#e8ebf2 acento #aab4c4 (oscura). Cada una: bg/text/muted/accent/surface/dark.
- **Cuadrícula** (`gridStyle`): `justificada` filas justificadas altura ~280 gap 8px (actual);
  `aireada` justificada altura ~360 gap 24px; `cuadrada` retícula uniforme con recorte 1:1.
  El radio de foto deja de ser rasgo de plantilla: fijo 2px en todos los estilos (sin marcos).

`templates.ts` se convierte en `design-options.ts`: `PALETTE_TOKENS`, `FONT_TOKENS`,
`GRID_TOKENS` (targetH/gap/square), y helpers; los componentes reciben `design =
{ coverStyle, fontSet, palette, gridStyle }` en lugar de `template`.

## Portada efectiva y foco

- Prioridad de imagen: `coverImageKey` (subida ex profeso) → `coverPhotoId` (foto de la galería,
  flujo actual) → primera foto publicada+ready de la primera sección visible → sin imagen (fondo
  de paleta).
- `coverImageKey`: `studios/{studioId}/covers/{galleryId}/{uuid}.(jpg|png)`, subida con URL
  prefirmada (jpeg/png, ≤10 MB, ContentLength firmado); al reemplazar/quitar se borra el objeto R2;
  al borrar la galería también. NO pasa por gates de marca de agua (no es foto entregable);
  la ruta coverPhotoId/primera-foto CONSERVA los gates fail-closed + published/ready/section-visible
  existentes (puerta y galería).
- **Punto de foco** (`coverFocalX/Y`, ya en schema): picker clicable sobre la miniatura en el admin;
  aplica a la imagen efectiva en portada y puerta de acceso.

## Barra de título + pestañas + favoritas (galería del cliente)

- Banda bajo la portada: título (tipografía display) a la izquierda; a la derecha iconos SVG de
  **favoritas** (corazón: activa filtro de fotos liked) y **descarga** (menú ZIP ámbito+resolución,
  solo si hay descargas habilitadas). Al hacer scroll la barra se vuelve pegajosa arriba —
  REEMPLAZA al gallery-header pegajoso actual (una sola pieza).
- Debajo del título: **pestañas** = solo las secciones VISIBLES, sin "Todas"; la primera visible
  activa por defecto; una pestaña filtra el grid a esa sección (sin encabezados redundantes).
  El zip por sección vive en el menú de descarga (opción "esta sección") — desaparece el icono
  junto al encabezado.
- Filtro de favoritas: dentro de la pestaña activa; estado vacío "Aún no tienes favoritas".
- El botón/flecha de scroll queda sobre la foto de portada (estilo `full`), no en la barra.

## Secciones obligatorias

- Subir fotos exige sección destino; sin secciones, el uploader se deshabilita con aviso y atajo
  "crear primera sección". Desaparece la opción "Sin sección" en uploader y mover.
- Eliminar sección CON fotos: diálogo para elegir a qué sección moverlas (mover en lote existente);
  si no hay otra sección, no se permite eliminar. Vacía → eliminar directo.
- Dominio: `deleteSection(db, studioId, galleryId, sectionId, moveToSectionId?)` —
  `SECTION_NOT_EMPTY` si tiene fotos y no llega destino; destino validado misma galería.
- La sección combinada desde Actividad y los overrides por sección siguen igual. El bloque
  "sin sección" desaparece del admin y del cliente.

## Modo preview y compartir (admin)

- **`/g/{slug}/preview`**: server component protegido con `requireStudio()` + galería del estudio
  (si no → 404). Renderiza la MISMA ClientGallery con datos frescos SIN sesión de cliente:
  likes/comentarios vacíos, `previewMode: true` → banda superior fija "Vista previa — así verán
  tus clientes esta galería" y acciones de cliente (like, comentario, descargas, zip)
  deshabilitadas con title="Solo disponible para clientes". Funciona con galerías en borrador.
  El link real `/g/{slug}` no cambia.
- **Compartir** en el detalle de galería: reemplaza el `<code>/g/slug</code>` por dos botones:
  "Vista previa" (target _blank a /preview) y "Copiar enlace" (navigator.clipboard con la URL
  completa, feedback "Copiado ✓" 2 s). Componente cliente pequeño.

## Sección Diseño (admin, detalle de galería)

- Bloque propio separado de Configuración: 4 grupos de tarjetas-radio compactas (nombre + hint de
  una línea, sin miniaturas) para portada/tipografía/paleta/cuadrícula; gestor de imagen de portada
  (miniatura de la efectiva con **picker de foco** clicable, subir imagen, quitar); guardar con
  `updateGalleryDesignAction` → `updateGalleryDesign(db, studioId, galleryId, patch)` (Zod enums,
  tenant-scoped, focal 0..1). El select de plantilla desaparece.

## Verificación

- Dominio: tests de `updateGalleryDesign` (enums inválidos rechazados, tenant, focal clamp),
  `deleteSection` nueva firma (mover, SECTION_NOT_EMPTY, intruder), migración de huérfanas a
  "Fotos" (PGlite aplica 0008), portada efectiva (prioridad subida > foto > primera visible).
- UI: gates (`npm test && npx tsc --noEmit && npm run build && npx eslint src tests` cero warnings).
- Walkthrough manual: sección Diseño (los 4 ejes + foco + subir/quitar portada), preview con banda
  y acciones deshabilitadas, copiar enlace, pestañas + favoritas + zip en cliente, subir sin
  secciones, eliminar sección con fotos.

## Fuera de alcance

- Miniaturas visuales en las tarjetas-radio del admin (el preview real está a un clic).
- Paletas/fuentes personalizadas por el fotógrafo (catálogos fijos).
- Reordenar fotos drag&drop (fase 5 del spec maestro).
- Marcos de foto tipo álbum (retirados con las plantillas; pueden volver como opción de cuadrícula).
