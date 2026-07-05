# PhonoManager — Entrega de galerías fotográficas a clientes

**Fecha:** 2026-07-05
**Estado:** Aprobado por el usuario (diseño validado por secciones)

## Resumen

Aplicación tipo Pixieset para que un fotógrafo entregue galerías a sus clientes.
El fotógrafo administra galerías con secciones, fotos publicadas/ocultas, marca de
agua, descargas por resolución y presentación configurable. Los clientes acceden
por enlace (con contraseña opcional), dejan su email, marcan favoritas y comentan.

- **Hoy:** un solo fotógrafo (un tenant).
- **Después:** SaaS multi-fotógrafo. El modelo de datos ya nace multi-tenant
  (todo cuelga de `studios`); el salto a SaaS es agregar registro, no migrar datos.

## Roles

| Rol | Acceso | Capacidades |
|---|---|---|
| Fotógrafo | `/admin`, login Auth0 | Administra todo: galerías, fotos, configuración, actividad |
| Cliente | `/g/[slug]`, contraseña opcional + email obligatorio | Ve fotos publicadas, marca favoritas, comenta, descarga si está habilitado |

## Stack

| Pieza | Tecnología |
|---|---|
| App web + API | Next.js 15 (App Router) + TypeScript, monolito en Vercel |
| Base de datos | PostgreSQL en Neon, ORM Drizzle |
| Almacenamiento de fotos | Cloudflare R2, bucket privado, URLs prefirmadas |
| Auth del fotógrafo | Auth0 (OIDC) |
| Sesión del cliente | JWT propio en cookie HttpOnly, alcance de una galería |
| Procesamiento de imágenes | sharp en funciones serverless (Node runtime) |
| ZIPs | Cloudflare Worker mínimo que hace streaming desde R2 |
| Emails | Resend (aviso de actividad al fotógrafo) |
| i18n | next-intl, español e inglés |
| Validación | Zod en todos los endpoints |

## Arquitectura

Una sola aplicación Next.js con dos áreas:

- **`/admin`** — dashboard del fotógrafo (Auth0).
- **`/g/[slug]`** — galería del cliente (contraseña opcional + email).

### Pipeline de imágenes (derivados pre-generados al subir)

1. El navegador pide a la API una URL prefirmada y sube el **original directo a R2**
   (nunca pasa por Vercel; sin límite de tamaño del body).
2. Al confirmar la subida, una función serverless con sharp genera y guarda en R2:
   - miniatura (~400 px)
   - tamaño web (2048 px)
   - variantes con marca de agua (web y alta) según configuración de la galería
3. La foto pasa a `ready` en la base de datos. Se procesa una foto por invocación
   para respetar los límites de memoria/tiempo de Vercel.
4. Si cambia la configuración de marca de agua de una galería, las variantes se
   regeneran en background.

La API de subida usa autenticación por **API key** además de la sesión Auth0,
de modo que el plugin de Lightroom del usuario pueda consumir los mismos
endpoints (incluida la creación de colección/galería). La integración del plugin
queda **fuera de este spec** (fase futura; el usuario compartirá el plugin).

### ZIPs (única pieza fuera de Vercel)

Una galería de originales puede superar los 10 GB; eso no cabe en una función de
Vercel. Un **Cloudflare Worker** (~100 líneas) arma el ZIP en streaming leyendo
directo de R2 (modo *store*, sin compresión: los JPEG ya están comprimidos).
La app Next.js firma los enlaces al Worker (token corto con la lista de claves
permitidas). Cloudflare no cobra egreso desde R2.

## Modelo de datos

```
studios ──< galleries ──< sections ──< photos
   │            │                        │
   │            ├──< gallery_clients >── clients (email)
   │            │         │
   │            │         ├──< likes ──── photo
   │            │         └──< comments ─ photo
   │            └──< activity_events
   └──< api_keys (plugin Lightroom, futuro)
```

- **`studios`** — tenant: nombre, slug, logo, `auth0_user_id` del dueño.
- **`galleries`** — título, slug del enlace, estado (`draft/published/archived`),
  `password_hash` (null = sin contraseña), portada (foto, plantilla, punto focal
  x/y), tema (claro/oscuro), orden de fotos (`captura/nombre/manual`), y entrega:
  `download_enabled`, resoluciones habilitadas (web/alta/original),
  `watermark_mode` (`none/view/download/both`), imagen o texto de marca de agua.
- **`sections`** — nombre, posición, `visible`.
- **`photos`** — claves R2 (original y derivados), dimensiones, fecha de captura
  (EXIF), posición manual, `published`, estado (`processing/ready/error`).
- **`clients`** — email, nombre opcional. **`gallery_clients`** — cliente↔galería,
  último acceso.
- **`likes`** — únicos por (cliente, foto). **`comments`** — cliente, foto, texto.
- **`activity_events`** — acceso, like, comentario; alimenta dashboard y emails.
- **`api_keys`** — hasheadas; para el plugin (futuro).

### Privacidad de la actividad

Cada cliente ve **solo su propia** actividad (likes y comentarios). El fotógrafo
ve toda la actividad agrupada por cliente (email).

## Flujos

**Fotógrafo:** crear galería → secciones → subir fotos (drag & drop, directo a
R2) → configurar portada/tema/orden/contraseña/marca de agua/descargas →
publicar y compartir enlace → seguir actividad (accesos, favoritas filtrables,
comentarios) en el dashboard.

**Cliente:** abre enlace → contraseña si la hay → email (siempre; crea la sesión)
→ navega secciones visibles y fotos publicadas con la variante permitida →
favoritas y comentarios → descargas si están habilitadas: foto suelta o ZIP
(galería, sección o favoritas) en las resoluciones habilitadas por el fotógrafo.

**Flujo de dos fases (selección → entrega):** se logra con configuración, sin
estados especiales: publicar con marca de agua y descarga desactivada; para la
entrega final, reemplazar/añadir fotos finales, quitar marca y activar descargas.

## Seguridad

- Bucket R2 **privado siempre**; fotos servidas solo con URLs prefirmadas de
  ~15 min tras verificar sesión.
- La variante que recibe el cliente se decide **en el servidor**: la versión
  limpia o las fotos ocultas jamás llegan al navegador (ni HTML ni API).
- Sesión cliente: JWT firmado, cookie HttpOnly/Secure/SameSite, alcance a una
  sola galería. Contraseñas de galería con bcrypt y rate limit por IP.
- Rutas y endpoints `/admin`: verificación de sesión Auth0 en servidor
  (middleware **y** por endpoint).
- Zod en cada endpoint; SQL parametrizado vía Drizzle; comentarios con límite de
  longitud y frecuencia (anti-spam).
- URLs prefirmadas de subida restringen content-type, tamaño máximo y prefijo,
  y expiran rápido.
- Secretos solo en variables de entorno de Vercel.

## Pruebas

- **Vitest (unidad):** reglas de dominio — qué variante corresponde según
  `watermark_mode`, permisos de descarga por resolución, visibilidad de fotos.
- **Integración:** endpoints contra base de datos de prueba.
- **Playwright (e2e):** acceso con contraseña, like, comentario, y verificación
  de que fotos ocultas o variantes sin marca nunca se filtran al cliente.

## Fases de construcción

1. **Fundación** — proyecto Next.js, esquema Drizzle, Auth0, CRUD de galerías y
   secciones en el dashboard.
2. **Fotos** — subida directa a R2, pipeline de derivados, vista de galería del
   cliente (solo lectura).
3. **Acceso de clientes** — contraseña + email + sesión, likes, comentarios,
   panel de actividad, emails vía Resend.
4. **Entrega** — descargas por resolución, marca de agua configurable, Worker
   de ZIP.
5. **Presentación** — plantillas de portada con punto focal, temas, orden manual,
   i18n completo.
6. **Futuro (fuera de este spec)** — endpoints para el plugin de Lightroom,
   registro multi-tenant (SaaS), notificaciones a clientes.

## Fuera de alcance (v1)

- Venta/pagos y carrito (Pixieset Store).
- Registro de fotógrafos (multi-tenant activo).
- Integración del plugin de Lightroom (la API queda preparada).
- Notificaciones por email a clientes.
