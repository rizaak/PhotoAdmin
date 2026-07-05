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

## Comandos
- `npm test` — Vitest (dominio, con PGlite en memoria; no requiere Postgres)
- `npm run db:generate` — generar migraciones tras cambiar `src/db/schema.ts`
- `npm run db:migrate` — aplicar migraciones a `DATABASE_URL`
