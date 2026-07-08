# PhonoManager

Entrega de galerías fotográficas a clientes (tipo Pixieset).
Spec: `docs/superpowers/specs/2026-07-05-photo-gallery-delivery-design.md`.

## Stack
Next.js (App Router, TS) · Drizzle + PostgreSQL (Neon) · Auth0 · Cloudflare R2 · next-intl (es/en)

## Desarrollo

1. `cp .env.example .env.local` y completar credenciales (Auth0 + Postgres).
2. `npm install`
3. `npm run db:migrate`
4. `npm run dev` → http://localhost:3000/admin

## Cloudflare R2 (fotos)

1. Crear bucket privado en R2 y un API token con permisos de lectura/escritura de objetos.
2. Completar en `.env.local`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
3. Configurar CORS del bucket (Settings → CORS policy) para permitir la subida directa desde el navegador:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

En producción, agregar el dominio de la app a `AllowedOrigins`.

## Acceso de clientes

- Galerías publicadas se comparten en `/g/<slug>`; el cliente deja su email (y contraseña si la galería tiene).
- `CLIENT_SESSION_SECRET` (obligatoria): `openssl rand -hex 32`.
- `RESEND_API_KEY` + `RESEND_FROM` (opcionales): emails de actividad al fotógrafo; sin key no se envía nada.
- Marca de agua: las variantes se generan en la Fase 4 — hasta entonces la vista cliente sirve la versión web limpia.

## Marca de agua y descargas

- La marca de agua es el TEXTO configurado en la galería (vacío = sin marca); se hereda galería → sección → foto (override por foto desde el gestor).
- Tras cambiar el texto o subir fotos antiguas, usa el banner "Actualizar fotos" del detalle para regenerar variantes.
- La resolución Original se desactiva automáticamente cuando la marca aplica a descargas.

### ZIP worker (Cloudflare)

1. `cd workers/zip && npm install`
2. `npx wrangler login` (una vez)
3. `npx wrangler secret put ZIP_SIGNING_SECRET` (el MISMO valor que en `.env.local`)
4. `npm run deploy` — anota la URL resultante
5. En `.env.local`: `ZIP_WORKER_URL=https://phonomanager-zip.<tu-subdominio>.workers.dev` y `ZIP_SIGNING_SECRET=<hex 32>`

Sin estas variables la app funciona igual; solo la descarga ZIP queda deshabilitada.

## Comandos
- `npm test` — Vitest (dominio, con PGlite en memoria; no requiere Postgres)
- `npm run db:generate` — generar migraciones tras cambiar `src/db/schema.ts`
- `npm run db:migrate` — aplicar migraciones a `DATABASE_URL`
