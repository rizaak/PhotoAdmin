# PhonoManager Fase 1 (Fundación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proyecto Next.js funcionando en local con esquema completo de base de datos, login del fotógrafo vía Auth0, CRUD de galerías y secciones, y lista de galerías con buscador y filtros.

**Architecture:** Monolito Next.js (App Router) con capa de dominio en `src/server/*` (funciones puras que reciben la conexión `db` como parámetro — testeables con PGlite sin red), server actions delgadas que validan sesión + Zod y llaman al dominio, y UI mínima con Tailwind. El esquema Drizzle se define completo (todas las tablas del spec) aunque la UI de fases posteriores no exista aún.

**Tech Stack:** Next.js 15+ (App Router, TypeScript, src dir), Drizzle ORM + drizzle-kit, PostgreSQL (Neon en prod; PGlite en tests), @auth0/nextjs-auth0 v4, Zod, bcryptjs, nanoid, next-intl, Vitest, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-07-05-photo-gallery-delivery-design.md`

## Global Constraints

- TypeScript `strict: true`; imports con alias `@/*` → `./src/*`.
- Toda ruta y server action bajo `/admin` verifica la sesión Auth0 **en el servidor** (middleware Y por acción), nunca solo en el cliente.
- Toda entrada externa se valida con Zod antes de tocar la base de datos.
- Multi-tenant desde el día 1: toda función de dominio recibe y filtra por `studioId`; los tests verifican que un tenant no puede tocar datos de otro.
- Contraseñas de galería: bcryptjs con cost 10; hash o `null`, nunca texto plano.
- Migraciones generadas con drizzle-kit en `./drizzle`; los tests las aplican con el migrator de PGlite (misma fuente de verdad).
- Textos de UI vía next-intl (`messages/es.json`, `messages/en.json`), español por defecto; no hardcodear textos en JSX.
- Commits frecuentes con mensajes convencionales en inglés (`feat:`, `test:`, `chore:`).
- Variables de entorno (ver `.env.example`): `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`.

---

### Task 1: Scaffold del proyecto y tooling de tests

**Files:**
- Create: proyecto Next.js completo en la raíz (`package.json`, `src/app/*`, `tsconfig.json`, etc.)
- Create: `vitest.config.ts`
- Create: `.env.example`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nada (repo solo tiene `docs/`).
- Produces: proyecto compilable; comando `npm test` (Vitest); alias `@/*`.

- [ ] **Step 1: Scaffold con create-next-app** (el directorio tiene `docs/`, que create-next-app rechaza; se aparta y restaura)

```bash
cd /Users/isaaclopez/phonomanager
mv docs /tmp/phonomanager-docs
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
mv /tmp/phonomanager-docs docs
```

Expected: estructura `src/app/` creada; `git status` muestra archivos nuevos y `docs/` intacto.

- [ ] **Step 2: Instalar dependencias**

```bash
npm install drizzle-orm pg zod bcryptjs nanoid next-intl @auth0/nextjs-auth0
npm install -D drizzle-kit vitest @electric-sql/pglite @types/pg @types/bcryptjs
```

Expected: sin errores; deps en `package.json`.

- [ ] **Step 3: Configurar Vitest** — crear `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
```

- [ ] **Step 4: Scripts y .env.example** — en `package.json` agregar a `"scripts"`:

```json
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

Crear `.env.example`:

```bash
# Postgres (Neon en prod, o local para desarrollo)
DATABASE_URL=postgres://user:pass@localhost:5432/phonomanager
# Auth0 (aplicación "Regular Web Application")
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=xxx
AUTH0_CLIENT_SECRET=xxx
AUTH0_SECRET=use-openssl-rand-hex-32
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 5: Verificar build y test runner**

```bash
npm run build
npx vitest run
```

Expected: build OK; Vitest reporta "No test files found" (exit code puede ser 1 — es lo esperado, aún no hay tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Drizzle, Auth0, Vitest tooling"
```

---

### Task 2: Esquema Drizzle completo + migraciones + harness PGlite

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `drizzle/` (migraciones generadas)
- Create: `tests/helpers/db.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Todas las tablas: `studios, galleries, sections, photos, clients, galleryClients, likes, comments, activityEvents, apiKeys` y enums exportados desde `@/db/schema`.
  - `db` y `export type Db` desde `@/db` (los módulos de dominio tipan su parámetro con `Db`).
  - `createTestDb(): Promise<Db>` desde `tests/helpers/db` (PGlite con migraciones aplicadas).

- [ ] **Step 1: Escribir el esquema completo** — `src/db/schema.ts`:

```ts
import {
  pgTable, pgEnum, text, uuid, integer, bigint, boolean,
  timestamp, real, jsonb, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const galleryStatusEnum = pgEnum("gallery_status", ["draft", "published", "archived"]);
export const watermarkModeEnum = pgEnum("watermark_mode", ["none", "view", "download", "both"]);
export const photoStatusEnum = pgEnum("photo_status", ["processing", "ready", "error"]);
export const photoOrderEnum = pgEnum("photo_order", ["capture", "filename", "manual"]);
export const galleryThemeEnum = pgEnum("gallery_theme", ["light", "dark"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "access", "like_added", "like_removed", "comment", "download_photo", "download_zip",
]);

export const studios = pgTable("studios", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoKey: text("logo_key"),
  auth0UserId: text("auth0_user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const galleries = pgTable("galleries", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  status: galleryStatusEnum("status").notNull().default("draft"),
  passwordHash: text("password_hash"),
  coverPhotoId: uuid("cover_photo_id").references((): AnyPgColumn => photos.id, { onDelete: "set null" }),
  coverTemplate: text("cover_template").notNull().default("classic"),
  coverFocalX: real("cover_focal_x").notNull().default(0.5),
  coverFocalY: real("cover_focal_y").notNull().default(0.5),
  theme: galleryThemeEnum("theme").notNull().default("light"),
  photoOrder: photoOrderEnum("photo_order").notNull().default("capture"),
  downloadEnabled: boolean("download_enabled").notNull().default(false),
  resWebEnabled: boolean("res_web_enabled").notNull().default(true),
  resHighEnabled: boolean("res_high_enabled").notNull().default(false),
  resOriginalEnabled: boolean("res_original_enabled").notNull().default(false),
  watermarkMode: watermarkModeEnum("watermark_mode").notNull().default("none"),
  watermarkText: text("watermark_text"),
  watermarkImageKey: text("watermark_image_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sections = pgTable("sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  // Overrides de entrega: null = hereda de la galería
  watermarkMode: watermarkModeEnum("watermark_mode"),
  downloadEnabled: boolean("download_enabled"),
});

export const photos = pgTable("photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  originalKey: text("original_key").notNull(),
  thumbKey: text("thumb_key"),
  webKey: text("web_key"),
  webWmKey: text("web_wm_key"),
  highKey: text("high_key"),
  highWmKey: text("high_wm_key"),
  width: integer("width"),
  height: integer("height"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
  published: boolean("published").notNull().default(true),
  status: photoStatusEnum("status").notNull().default("processing"),
  // null = hereda de sección/galería; true/false fuerza marca de agua por foto
  watermarkOverride: boolean("watermark_override"),
  sizeOriginalBytes: bigint("size_original_bytes", { mode: "number" }).notNull().default(0),
  sizeDerivativesBytes: bigint("size_derivatives_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("clients_studio_email_idx").on(t.studioId, t.email)]);

export const galleryClients = pgTable("gallery_clients", {
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.galleryId, t.clientId] })]);

export const likes = pgTable("likes", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.clientId, t.photoId] })]);

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  galleryId: uuid("gallery_id").notNull().references(() => galleries.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").references(() => photos.id, { onDelete: "set null" }),
  type: activityTypeEnum("type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Studio = typeof studios.$inferSelect;
export type Gallery = typeof galleries.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type GalleryStatus = (typeof galleryStatusEnum.enumValues)[number];
```

- [ ] **Step 2: Cliente de base de datos** — `src/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Tipo aceptado por toda la capa de dominio: sirve tanto para el pool de
// node-postgres (prod/dev) como para PGlite (tests).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db: Db = drizzle(pool, { schema });
```

- [ ] **Step 3: Config de drizzle-kit** — `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/phonomanager" },
});
```

- [ ] **Step 4: Generar la migración inicial**

```bash
npm run db:generate
```

Expected: aparece `drizzle/0000_*.sql` con los CREATE TABLE de las 10 tablas y los enums.

- [ ] **Step 5: Harness de tests** — `tests/helpers/db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  return db;
}

export async function seedStudio(db: Db, auth0UserId = "auth0|test-user") {
  const [studio] = await db
    .insert(schema.studios)
    .values({ name: "Test Studio", slug: `test-${auth0UserId.replace(/\W/g, "")}`, auth0UserId })
    .returning();
  return studio;
}
```

- [ ] **Step 6: Escribir el test de esquema (failing)** — `tests/db/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { galleries, sections, photos } from "@/db/schema";

describe("schema", () => {
  it("applies migrations and wires FKs studio→gallery→section→photo", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);

    const [gallery] = await db.insert(galleries)
      .values({ studioId: studio.id, title: "Boda A", slug: "boda-a-x1" }).returning();
    const [section] = await db.insert(sections)
      .values({ galleryId: gallery.id, name: "Selección", position: 0 }).returning();
    const [photo] = await db.insert(photos)
      .values({ galleryId: gallery.id, sectionId: section.id, filename: "IMG_0001.jpg", originalKey: "orig/x" })
      .returning();

    expect(gallery.status).toBe("draft");
    expect(gallery.watermarkMode).toBe("none");
    expect(section.visible).toBe(true);
    expect(section.watermarkMode).toBeNull(); // hereda
    expect(photo.published).toBe(true);

    // borrar la sección deja la foto "sin sección", no la borra
    await db.delete(sections).where(eq(sections.id, section.id));
    const [orphan] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(orphan.sectionId).toBeNull();
  });
});
```

- [ ] **Step 7: Correr el test**

```bash
npx vitest run tests/db/schema.test.ts
```

Expected: PASS (el esquema y las migraciones de los pasos previos lo satisfacen; si falla, el esquema o la migración están mal — arreglar antes de seguir).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add full Drizzle schema, initial migration, PGlite test harness"
```

---

### Task 3: Utilidad de slug

**Files:**
- Create: `src/server/slug.ts`
- Test: `tests/server/slug.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `makeSlug(title: string): string` — minúsculas, sin acentos, guiones, sufijo aleatorio de 6 chars `[a-z0-9]`.

- [ ] **Step 1: Test failing** — `tests/server/slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeSlug } from "@/server/slug";

describe("makeSlug", () => {
  it("normalizes accents, spaces and case, and appends a 6-char suffix", () => {
    const slug = makeSlug("Boda de María & José 2026");
    expect(slug).toMatch(/^boda-de-maria-jose-2026-[a-z0-9]{6}$/);
  });
  it("handles empty/symbol-only titles with a fallback base", () => {
    expect(makeSlug("!!!")).toMatch(/^galeria-[a-z0-9]{6}$/);
  });
  it("produces distinct slugs for the same title", () => {
    expect(makeSlug("Boda")).not.toBe(makeSlug("Boda"));
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/server/slug.test.ts
```

Expected: FAIL — `Cannot find module '@/server/slug'`.

- [ ] **Step 3: Implementación** — `src/server/slug.ts`:

```ts
import { customAlphabet } from "nanoid";

const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export function makeSlug(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${base || "galeria"}-${suffix()}`;
}
```

- [ ] **Step 4: Verificar que pasa**

```bash
npx vitest run tests/server/slug.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/slug.ts tests/server/slug.test.ts
git commit -m "feat: add slug generator for galleries and studios"
```

---

### Task 4: Auth0 + middleware + bootstrap del studio + shell de admin

**Files:**
- Create: `src/lib/auth0.ts`
- Create: `src/middleware.ts`
- Create: `src/server/studio.ts`
- Create: `src/server/auth.ts`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/server/studio.test.ts`

**Interfaces:**
- Consumes: `Db`, `studios` (Task 2); `makeSlug` (Task 3).
- Produces:
  - `ensureStudio(db: Db, auth0UserId: string, displayName: string): Promise<Studio>` — get-or-create idempotente.
  - `requireStudio(): Promise<Studio>` desde `@/server/auth` — lanza `Error("UNAUTHORIZED")` sin sesión; TODAS las server actions posteriores la llaman primero.
  - Rutas `/auth/login`, `/auth/logout` montadas por el middleware de Auth0; `/admin/*` redirige a login sin sesión.

- [ ] **Step 1: Test failing de ensureStudio** — `tests/server/studio.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/db";
import { ensureStudio } from "@/server/studio";

describe("ensureStudio", () => {
  it("creates a studio on first login and returns the same one afterwards", async () => {
    const db = await createTestDb();
    const first = await ensureStudio(db, "auth0|abc123", "Isaac López");
    expect(first.name).toBe("Isaac López");
    expect(first.auth0UserId).toBe("auth0|abc123");

    const second = await ensureStudio(db, "auth0|abc123", "Otro Nombre");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Isaac López"); // no sobreescribe
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
npx vitest run tests/server/studio.test.ts
```

Expected: FAIL — `Cannot find module '@/server/studio'`.

- [ ] **Step 3: Implementar** — `src/server/studio.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { studios, type Studio } from "@/db/schema";
import { makeSlug } from "./slug";

export async function ensureStudio(db: Db, auth0UserId: string, displayName: string): Promise<Studio> {
  const existing = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(studios)
    .values({ name: displayName, slug: makeSlug(displayName), auth0UserId })
    .returning();
  return created;
}
```

- [ ] **Step 4: Verificar que pasa**

```bash
npx vitest run tests/server/studio.test.ts
```

Expected: PASS.

- [ ] **Step 5: Cliente Auth0 y middleware** — `src/lib/auth0.ts`:

```ts
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client();
```

`src/middleware.ts`:

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function middleware(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  if (request.nextUrl.pathname.startsWith("/auth")) return authResponse;

  if (request.nextUrl.pathname.startsWith("/admin")) {
    const session = await auth0.getSession(request);
    if (!session) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
  }
  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
```

- [ ] **Step 6: Helper de sesión para actions** — `src/server/auth.ts`:

```ts
import { auth0 } from "@/lib/auth0";
import { db } from "@/db";
import type { Studio } from "@/db/schema";
import { ensureStudio } from "./studio";

export async function requireStudio(): Promise<Studio> {
  const session = await auth0.getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  const displayName =
    (session.user.name as string | undefined) ??
    (session.user.email as string | undefined) ??
    "Mi Estudio";
  return ensureStudio(db, session.user.sub, displayName);
}
```

- [ ] **Step 7: Shell de admin y home** — `src/app/admin/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <a href="/admin" className="font-semibold tracking-tight">PhonoManager</a>
        <a href="/auth/logout" className="text-sm text-neutral-500 hover:text-neutral-900">Salir</a>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

`src/app/admin/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function AdminHome() {
  redirect("/admin/galleries");
}
```

Reemplazar `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/admin");
}
```

- [ ] **Step 8: Verificación manual** — requiere una aplicación "Regular Web Application" en Auth0 con Allowed Callback URL `http://localhost:3000/auth/callback` y Allowed Logout URL `http://localhost:3000`. Copiar `.env.example` a `.env.local` con valores reales (`AUTH0_SECRET` = `openssl rand -hex 32`) y una `DATABASE_URL` válida (Neon o Postgres local con `npm run db:migrate` aplicado).

```bash
npm run dev
```

Expected: visitar `http://localhost:3000/admin` redirige a Auth0; tras login vuelve a `/admin` (mostrará 404 de `/admin/galleries` hasta la Task 7 — correcto por ahora). Si no hay credenciales Auth0 disponibles en este entorno, documentarlo en el reporte de la task y continuar (la protección queda verificada por code review + el 302 a `/auth/login` sin cookie, comprobable con `curl -I http://localhost:3000/admin`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add Auth0 login, admin route protection, studio bootstrap"
```

---

### Task 5: Dominio de galerías (CRUD + búsqueda/filtros)

**Files:**
- Create: `src/server/galleries.ts`
- Test: `tests/server/galleries.test.ts`

**Interfaces:**
- Consumes: `Db`, `galleries`, `Gallery`, `GalleryStatus` (Task 2); `makeSlug` (Task 3); `seedStudio` (helper).
- Produces (firmas exactas; las server actions de Task 7/8 las llaman):
  - `createGallery(db: Db, studioId: string, input: { title: string; password?: string }): Promise<Gallery>`
  - `listGalleries(db: Db, studioId: string, opts?: { search?: string; status?: GalleryStatus }): Promise<Gallery[]>`
  - `getGallery(db: Db, studioId: string, galleryId: string): Promise<Gallery>` — lanza `Error("NOT_FOUND")`
  - `updateGallerySettings(db: Db, studioId: string, galleryId: string, patch: UpdateGalleryInput): Promise<Gallery>`
  - `deleteGallery(db: Db, studioId: string, galleryId: string): Promise<void>`
  - `UpdateGalleryInput` (tipo exportado): parcial de `{ title, status, theme, photoOrder, downloadEnabled, resWebEnabled, resHighEnabled, resOriginalEnabled, watermarkMode, watermarkText, password }` donde `password: string | null` (null limpia la contraseña).

- [ ] **Step 1: Tests failing** — `tests/server/galleries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { createTestDb, seedStudio } from "../helpers/db";
import {
  createGallery, listGalleries, getGallery, updateGallerySettings, deleteGallery,
} from "@/server/galleries";

describe("galleries domain", () => {
  it("creates a gallery with defaults and hashed optional password", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda María", password: "secreto1" });
    expect(g.status).toBe("draft");
    expect(g.slug).toMatch(/^boda-maria-[a-z0-9]{6}$/);
    expect(g.passwordHash).not.toBe("secreto1");
    expect(await bcrypt.compare("secreto1", g.passwordHash!)).toBe(true);

    const open = await createGallery(db, studio.id, { title: "Sin clave" });
    expect(open.passwordHash).toBeNull();
  });

  it("lists with search (accent-insensitive input handled by caller) and status filter", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await createGallery(db, studio.id, { title: "Boda María" });
    const pub = await createGallery(db, studio.id, { title: "XV Ana" });
    await updateGallerySettings(db, studio.id, pub.id, { status: "published" });

    expect(await listGalleries(db, studio.id)).toHaveLength(2);
    expect(await listGalleries(db, studio.id, { search: "maría" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { search: "boda" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { status: "published" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { search: "nada" })).toHaveLength(0);
  });

  it("updates settings, sets and clears password", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda" });

    const updated = await updateGallerySettings(db, studio.id, g.id, {
      watermarkMode: "view", downloadEnabled: true, resOriginalEnabled: true, password: "clave123",
    });
    expect(updated.watermarkMode).toBe("view");
    expect(updated.downloadEnabled).toBe(true);
    expect(updated.passwordHash).not.toBeNull();

    const cleared = await updateGallerySettings(db, studio.id, g.id, { password: null });
    expect(cleared.passwordHash).toBeNull();
  });

  it("is tenant-scoped: another studio cannot read, update or delete", async () => {
    const db = await createTestDb();
    const a = await seedStudio(db, "auth0|studio-a");
    const b = await seedStudio(db, "auth0|studio-b");
    const g = await createGallery(db, a.id, { title: "Privada" });

    await expect(getGallery(db, b.id, g.id)).rejects.toThrow("NOT_FOUND");
    await expect(updateGallerySettings(db, b.id, g.id, { title: "hack" })).rejects.toThrow("NOT_FOUND");
    await expect(deleteGallery(db, b.id, g.id)).rejects.toThrow("NOT_FOUND");
    expect(await listGalleries(db, b.id)).toHaveLength(0);
  });

  it("deletes a gallery", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Temporal" });
    await deleteGallery(db, studio.id, g.id);
    await expect(getGallery(db, studio.id, g.id)).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
npx vitest run tests/server/galleries.test.ts
```

Expected: FAIL — `Cannot find module '@/server/galleries'`.

- [ ] **Step 3: Implementar** — `src/server/galleries.ts`:

```ts
import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { galleries, type Gallery, type GalleryStatus } from "@/db/schema";
import { makeSlug } from "./slug";

const createGallerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  password: z.string().min(4).max(100).optional(),
});
export type CreateGalleryInput = z.infer<typeof createGallerySchema>;

const updateGallerySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  photoOrder: z.enum(["capture", "filename", "manual"]).optional(),
  downloadEnabled: z.boolean().optional(),
  resWebEnabled: z.boolean().optional(),
  resHighEnabled: z.boolean().optional(),
  resOriginalEnabled: z.boolean().optional(),
  watermarkMode: z.enum(["none", "view", "download", "both"]).optional(),
  watermarkText: z.string().max(100).nullable().optional(),
  password: z.string().min(4).max(100).nullable().optional(),
});
export type UpdateGalleryInput = z.infer<typeof updateGallerySchema>;

export async function createGallery(db: Db, studioId: string, input: CreateGalleryInput): Promise<Gallery> {
  const data = createGallerySchema.parse(input);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;
  const [gallery] = await db
    .insert(galleries)
    .values({ studioId, title: data.title, slug: makeSlug(data.title), passwordHash })
    .returning();
  return gallery;
}

export async function listGalleries(
  db: Db, studioId: string,
  opts: { search?: string; status?: GalleryStatus } = {},
): Promise<Gallery[]> {
  const conditions = [eq(galleries.studioId, studioId)];
  if (opts.search?.trim()) conditions.push(ilike(galleries.title, `%${opts.search.trim()}%`));
  if (opts.status) conditions.push(eq(galleries.status, opts.status));
  return db.select().from(galleries).where(and(...conditions)).orderBy(desc(galleries.createdAt));
}

export async function getGallery(db: Db, studioId: string, galleryId: string): Promise<Gallery> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function updateGallerySettings(
  db: Db, studioId: string, galleryId: string, patch: UpdateGalleryInput,
): Promise<Gallery> {
  const data = updateGallerySchema.parse(patch);
  const { password, ...rest } = data;
  const values: Partial<typeof galleries.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (password !== undefined) {
    values.passwordHash = password === null ? null : await bcrypt.hash(password, 10);
  }
  const [gallery] = await db.update(galleries).set(values)
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)))
    .returning();
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function deleteGallery(db: Db, studioId: string, galleryId: string): Promise<void> {
  const deleted = await db.delete(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)))
    .returning({ id: galleries.id });
  if (deleted.length === 0) throw new Error("NOT_FOUND");
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
npx vitest run tests/server/galleries.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/galleries.ts tests/server/galleries.test.ts
git commit -m "feat: add tenant-scoped gallery domain with search and filters"
```

---

### Task 6: Dominio de secciones

**Files:**
- Create: `src/server/sections.ts`
- Test: `tests/server/sections.test.ts`

**Interfaces:**
- Consumes: `Db`, `sections`, `galleries`, `photos` (Task 2); `getGallery` (Task 5).
- Produces:
  - `createSection(db: Db, studioId: string, galleryId: string, name: string): Promise<Section>` — position = último + 1.
  - `renameSection(db: Db, studioId: string, sectionId: string, name: string): Promise<Section>`
  - `setSectionVisible(db: Db, studioId: string, sectionId: string, visible: boolean): Promise<Section>`
  - `reorderSections(db: Db, studioId: string, galleryId: string, orderedIds: string[]): Promise<void>`
  - `deleteSection(db: Db, studioId: string, sectionId: string): Promise<void>` — las fotos quedan `sectionId = null` (lo garantiza el FK `set null`).
  - `listSections(db: Db, studioId: string, galleryId: string): Promise<Section[]>` — orden por `position`.

- [ ] **Step 1: Tests failing** — `tests/server/sections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery } from "@/server/galleries";
import {
  createSection, renameSection, setSectionVisible, reorderSections, deleteSection, listSections,
} from "@/server/sections";
import { photos } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const gallery = await createGallery(db, studio.id, { title: "Boda" });
  return { db, studio, gallery };
}

describe("sections domain", () => {
  it("creates sections with incremental positions and lists them in order", async () => {
    const { db, studio, gallery } = await setup();
    const s1 = await createSection(db, studio.id, gallery.id, "Selección");
    const s2 = await createSection(db, studio.id, gallery.id, "Fotos listas");
    expect([s1.position, s2.position]).toEqual([0, 1]);
    expect((await listSections(db, studio.id, gallery.id)).map((s) => s.name))
      .toEqual(["Selección", "Fotos listas"]);
  });

  it("renames, toggles visibility and reorders", async () => {
    const { db, studio, gallery } = await setup();
    const s1 = await createSection(db, studio.id, gallery.id, "A");
    const s2 = await createSection(db, studio.id, gallery.id, "B");

    expect((await renameSection(db, studio.id, s1.id, "Ceremonia")).name).toBe("Ceremonia");
    expect((await setSectionVisible(db, studio.id, s2.id, false)).visible).toBe(false);

    await reorderSections(db, studio.id, gallery.id, [s2.id, s1.id]);
    expect((await listSections(db, studio.id, gallery.id)).map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  it("deleting a section moves its photos to 'sin sección'", async () => {
    const { db, studio, gallery } = await setup();
    const s = await createSection(db, studio.id, gallery.id, "Temporal");
    const [photo] = await db.insert(photos)
      .values({ galleryId: gallery.id, sectionId: s.id, filename: "a.jpg", originalKey: "o/a" })
      .returning();

    await deleteSection(db, studio.id, s.id);
    const [after] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(after.sectionId).toBeNull();
  });

  it("is tenant-scoped", async () => {
    const { db, studio, gallery } = await setup();
    const intruder = await seedStudio(db, "auth0|intruder");
    const s = await createSection(db, studio.id, gallery.id, "Privada");

    await expect(createSection(db, intruder.id, gallery.id, "X")).rejects.toThrow("NOT_FOUND");
    await expect(renameSection(db, intruder.id, s.id, "X")).rejects.toThrow("NOT_FOUND");
    await expect(deleteSection(db, intruder.id, s.id)).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
npx vitest run tests/server/sections.test.ts
```

Expected: FAIL — `Cannot find module '@/server/sections'`.

- [ ] **Step 3: Implementar** — `src/server/sections.ts`:

```ts
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { galleries, sections, type Section } from "@/db/schema";
import { getGallery } from "./galleries";

const nameSchema = z.string().trim().min(1).max(100);

async function assertSectionOwnership(db: Db, studioId: string, sectionId: string) {
  const [row] = await db
    .select({ id: sections.id, galleryId: sections.galleryId })
    .from(sections)
    .innerJoin(galleries, eq(sections.galleryId, galleries.id))
    .where(and(eq(sections.id, sectionId), eq(galleries.studioId, studioId)));
  if (!row) throw new Error("NOT_FOUND");
  return row;
}

export async function createSection(db: Db, studioId: string, galleryId: string, name: string): Promise<Section> {
  await getGallery(db, studioId, galleryId); // valida tenancy
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${sections.position}) + 1, 0)` })
    .from(sections)
    .where(eq(sections.galleryId, galleryId));
  const [section] = await db.insert(sections)
    .values({ galleryId, name: nameSchema.parse(name), position: next })
    .returning();
  return section;
}

export async function listSections(db: Db, studioId: string, galleryId: string): Promise<Section[]> {
  await getGallery(db, studioId, galleryId);
  return db.select().from(sections)
    .where(eq(sections.galleryId, galleryId))
    .orderBy(asc(sections.position));
}

export async function renameSection(db: Db, studioId: string, sectionId: string, name: string): Promise<Section> {
  await assertSectionOwnership(db, studioId, sectionId);
  const [section] = await db.update(sections)
    .set({ name: nameSchema.parse(name) })
    .where(eq(sections.id, sectionId))
    .returning();
  return section;
}

export async function setSectionVisible(db: Db, studioId: string, sectionId: string, visible: boolean): Promise<Section> {
  await assertSectionOwnership(db, studioId, sectionId);
  const [section] = await db.update(sections)
    .set({ visible })
    .where(eq(sections.id, sectionId))
    .returning();
  return section;
}

export async function reorderSections(db: Db, studioId: string, galleryId: string, orderedIds: string[]): Promise<void> {
  await getGallery(db, studioId, galleryId);
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(sections)
      .set({ position: i })
      .where(and(eq(sections.id, orderedIds[i]), eq(sections.galleryId, galleryId)));
  }
}

export async function deleteSection(db: Db, studioId: string, sectionId: string): Promise<void> {
  await assertSectionOwnership(db, studioId, sectionId);
  // FK photos.section_id ON DELETE SET NULL deja las fotos "sin sección"
  await db.delete(sections).where(eq(sections.id, sectionId));
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
npx vitest run tests/server/sections.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/sections.ts tests/server/sections.test.ts
git commit -m "feat: add tenant-scoped section domain (create/rename/visibility/reorder/delete)"
```

---

### Task 7: i18n (next-intl, es/en) + UI de lista de galerías con buscador

**Files:**
- Create: `src/i18n/request.ts`
- Create: `messages/es.json`
- Create: `messages/en.json`
- Modify: `next.config.ts`
- Modify: `src/app/layout.tsx`
- Create: `src/app/admin/galleries/page.tsx`
- Create: `src/app/admin/galleries/actions.ts`

**Interfaces:**
- Consumes: `requireStudio` (Task 4); `createGallery`, `listGalleries`, `deleteGallery`, `GalleryStatus` (Task 5); `db` (Task 2).
- Produces:
  - Server actions: `createGalleryAction(formData: FormData)`, `deleteGalleryAction(formData: FormData)` — usadas por los forms.
  - Página `/admin/galleries` con búsqueda (`?q=`) y filtro de estado (`?status=`).
  - Infra i18n: `getTranslations` disponible en todos los server components; locale por cookie `locale` (default `es`).

- [ ] **Step 1: Configurar next-intl** — `src/i18n/request.ts`:

```ts
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = store.get("locale")?.value === "en" ? "en" : "es";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

`next.config.ts` (reemplazar):

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

En `src/app/layout.tsx`, envolver `children` con el provider (mantener el resto del archivo generado):

```tsx
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Mensajes** — `messages/es.json`:

```json
{
  "galleries": {
    "title": "Galerías",
    "searchPlaceholder": "Buscar por título…",
    "filter": "Filtrar",
    "allStatuses": "Todos los estados",
    "status": { "draft": "Borrador", "published": "Publicada", "archived": "Archivada" },
    "newGallery": "Nueva galería",
    "galleryTitle": "Título",
    "passwordOptional": "Contraseña (opcional, mín. 4)",
    "create": "Crear",
    "delete": "Eliminar",
    "empty": "No hay galerías que coincidan.",
    "created": "Creada"
  }
}
```

`messages/en.json`:

```json
{
  "galleries": {
    "title": "Galleries",
    "searchPlaceholder": "Search by title…",
    "filter": "Filter",
    "allStatuses": "All statuses",
    "status": { "draft": "Draft", "published": "Published", "archived": "Archived" },
    "newGallery": "New gallery",
    "galleryTitle": "Title",
    "passwordOptional": "Password (optional, min 4)",
    "create": "Create",
    "delete": "Delete",
    "empty": "No galleries match.",
    "created": "Created"
  }
}
```

- [ ] **Step 3: Server actions** — `src/app/admin/galleries/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { createGallery, deleteGallery } from "@/server/galleries";

const createForm = z.object({
  title: z.string().trim().min(1).max(200),
  password: z.string().min(4).max(100).optional().or(z.literal("").transform(() => undefined)),
});

export async function createGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const data = createForm.parse({
    title: formData.get("title"),
    password: formData.get("password") ?? "",
  });
  await createGallery(db, studio.id, data);
  revalidatePath("/admin/galleries");
}

export async function deleteGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = z.string().uuid().parse(formData.get("galleryId"));
  await deleteGallery(db, studio.id, galleryId);
  revalidatePath("/admin/galleries");
}
```

- [ ] **Step 4: Página de lista** — `src/app/admin/galleries/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { listGalleries } from "@/server/galleries";
import type { GalleryStatus } from "@/db/schema";
import { createGalleryAction, deleteGalleryAction } from "./actions";

const STATUSES: GalleryStatus[] = ["draft", "published", "archived"];

export default async function GalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const [studio, t, params] = await Promise.all([
    requireStudio(),
    getTranslations("galleries"),
    searchParams,
  ]);
  const status = STATUSES.includes(params.status as GalleryStatus)
    ? (params.status as GalleryStatus)
    : undefined;
  const items = await listGalleries(db, studio.id, { search: params.q, status });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <form method="GET" className="flex gap-2">
        <input
          name="q" defaultValue={params.q ?? ""} placeholder={t("searchPlaceholder")}
          className="w-64 rounded border px-3 py-1.5 text-sm"
        />
        <select name="status" defaultValue={params.status ?? ""} className="rounded border px-2 py-1.5 text-sm">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("filter")}</button>
      </form>

      <ul className="divide-y rounded border bg-white">
        {items.length === 0 && <li className="p-4 text-sm text-neutral-500">{t("empty")}</li>}
        {items.map((g) => (
          <li key={g.id} className="flex items-center justify-between p-4">
            <div>
              <Link href={`/admin/galleries/${g.id}`} className="font-medium hover:underline">
                {g.title}
              </Link>
              <p className="text-xs text-neutral-500">
                {t(`status.${g.status}`)} · {t("created")} {g.createdAt.toISOString().slice(0, 10)}
              </p>
            </div>
            <form action={deleteGalleryAction}>
              <input type="hidden" name="galleryId" value={g.id} />
              <button className="text-sm text-red-600 hover:underline">{t("delete")}</button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createGalleryAction} className="flex max-w-md flex-col gap-2 rounded border bg-white p-4">
        <h2 className="font-medium">{t("newGallery")}</h2>
        <input name="title" required placeholder={t("galleryTitle")} className="rounded border px-3 py-1.5 text-sm" />
        <input name="password" placeholder={t("passwordOptional")} className="rounded border px-3 py-1.5 text-sm" />
        <button className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("create")}</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verificar build y suite completa**

```bash
npm run build && npm test
```

Expected: build OK; todos los tests previos siguen en PASS.

- [ ] **Step 6: Verificación manual** (con `.env.local` configurado): `npm run dev`, entrar a `/admin/galleries`, crear dos galerías, buscar por título, filtrar por estado, eliminar una. Si no hay Auth0/DB en el entorno, dejar constancia y apoyarse en build + tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add i18n (es/en) and gallery list page with search, filters, create/delete"
```

---

### Task 8: UI de detalle de galería — configuración + secciones

**Files:**
- Create: `src/app/admin/galleries/[id]/page.tsx`
- Create: `src/app/admin/galleries/[id]/actions.ts`
- Modify: `messages/es.json`, `messages/en.json` (agregar claves `galleryDetail`)

**Interfaces:**
- Consumes: `requireStudio`; `getGallery`, `updateGallerySettings` (Task 5); dominio de secciones completo (Task 6).
- Produces: página `/admin/galleries/[id]` con formulario de configuración y gestión de secciones (agregar, renombrar, subir/bajar, mostrar/ocultar, eliminar).

- [ ] **Step 1: Agregar mensajes** — merge en `messages/es.json` (clave hermana de `galleries`):

```json
{
  "galleryDetail": {
    "settings": "Configuración",
    "title": "Título",
    "status": "Estado",
    "theme": "Tema",
    "themes": { "light": "Claro", "dark": "Oscuro" },
    "photoOrder": "Orden de fotos",
    "orders": { "capture": "Fecha de captura", "filename": "Nombre de archivo", "manual": "Manual" },
    "watermarkMode": "Marca de agua",
    "watermarks": { "none": "Sin marca", "view": "En vista", "download": "En descarga", "both": "Ambas" },
    "downloadEnabled": "Permitir descargas",
    "resolutions": "Resoluciones habilitadas",
    "resWeb": "Web (2048px)", "resHigh": "Alta", "resOriginal": "Original",
    "newPassword": "Nueva contraseña (vacío = sin cambio)",
    "clearPassword": "Quitar contraseña",
    "save": "Guardar",
    "shareLink": "Enlace para clientes",
    "sections": "Secciones",
    "sectionName": "Nombre de la sección",
    "add": "Agregar",
    "rename": "Renombrar",
    "up": "Subir", "down": "Bajar",
    "show": "Mostrar", "hide": "Ocultar",
    "delete": "Eliminar",
    "noSections": "Aún no hay secciones."
  }
}
```

Y su equivalente en inglés en `messages/en.json`:

```json
{
  "galleryDetail": {
    "settings": "Settings",
    "title": "Title",
    "status": "Status",
    "theme": "Theme",
    "themes": { "light": "Light", "dark": "Dark" },
    "photoOrder": "Photo order",
    "orders": { "capture": "Capture date", "filename": "Filename", "manual": "Manual" },
    "watermarkMode": "Watermark",
    "watermarks": { "none": "None", "view": "On view", "download": "On download", "both": "Both" },
    "downloadEnabled": "Allow downloads",
    "resolutions": "Enabled resolutions",
    "resWeb": "Web (2048px)", "resHigh": "High", "resOriginal": "Original",
    "newPassword": "New password (empty = unchanged)",
    "clearPassword": "Remove password",
    "save": "Save",
    "shareLink": "Client link",
    "sections": "Sections",
    "sectionName": "Section name",
    "add": "Add",
    "rename": "Rename",
    "up": "Up", "down": "Down",
    "show": "Show", "hide": "Hide",
    "delete": "Delete",
    "noSections": "No sections yet."
  }
}
```

- [ ] **Step 2: Server actions del detalle** — `src/app/admin/galleries/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { updateGallerySettings } from "@/server/galleries";
import {
  createSection, renameSection, setSectionVisible, reorderSections, deleteSection, listSections,
} from "@/server/sections";

const id = z.string().uuid();

const settingsForm = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(["draft", "published", "archived"]),
  theme: z.enum(["light", "dark"]),
  photoOrder: z.enum(["capture", "filename", "manual"]),
  watermarkMode: z.enum(["none", "view", "download", "both"]),
  downloadEnabled: z.boolean(),
  resWebEnabled: z.boolean(),
  resHighEnabled: z.boolean(),
  resOriginalEnabled: z.boolean(),
});

export async function updateGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  const data = settingsForm.parse({
    title: formData.get("title"),
    status: formData.get("status"),
    theme: formData.get("theme"),
    photoOrder: formData.get("photoOrder"),
    watermarkMode: formData.get("watermarkMode"),
    downloadEnabled: formData.get("downloadEnabled") === "on",
    resWebEnabled: formData.get("resWebEnabled") === "on",
    resHighEnabled: formData.get("resHighEnabled") === "on",
    resOriginalEnabled: formData.get("resOriginalEnabled") === "on",
  });
  const newPassword = String(formData.get("password") ?? "");
  const clearPassword = formData.get("clearPassword") === "on";
  await updateGallerySettings(db, studio.id, galleryId, {
    ...data,
    ...(clearPassword ? { password: null } : newPassword ? { password: newPassword } : {}),
  });
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function addSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await createSection(db, studio.id, galleryId, String(formData.get("name") ?? ""));
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function renameSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await renameSection(db, studio.id, id.parse(formData.get("sectionId")), String(formData.get("name") ?? ""));
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function toggleSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await setSectionVisible(
    db, studio.id, id.parse(formData.get("sectionId")), formData.get("visible") === "true",
  );
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function moveSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  const sectionId = id.parse(formData.get("sectionId"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));

  const current = await listSections(db, studio.id, galleryId);
  const ids = current.map((s) => s.id);
  const i = ids.indexOf(sectionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderSections(db, studio.id, galleryId, ids);
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function deleteSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await deleteSection(db, studio.id, id.parse(formData.get("sectionId")));
  revalidatePath(`/admin/galleries/${galleryId}`);
}
```

- [ ] **Step 3: Página de detalle** — `src/app/admin/galleries/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getGallery } from "@/server/galleries";
import { listSections } from "@/server/sections";
import {
  updateGalleryAction, addSectionAction, renameSectionAction,
  toggleSectionAction, moveSectionAction, deleteSectionAction,
} from "./actions";

export default async function GalleryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studio = await requireStudio();
  const t = await getTranslations("galleryDetail");

  const gallery = await getGallery(db, studio.id, id).catch(() => null);
  if (!gallery) notFound();
  const sectionList = await listSections(db, studio.id, id);

  const check = "h-4 w-4 accent-neutral-900";
  const input = "rounded border px-3 py-1.5 text-sm";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{gallery.title}</h1>
        <p className="text-sm text-neutral-500">
          {t("shareLink")}: <code className="rounded bg-neutral-100 px-1">/g/{gallery.slug}</code>
        </p>
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{t("settings")}</h2>
        <form action={updateGalleryAction} className="grid max-w-2xl grid-cols-2 gap-4 text-sm">
          <input type="hidden" name="galleryId" value={gallery.id} />
          <label className="col-span-2 flex flex-col gap-1">
            {t("title")}
            <input name="title" defaultValue={gallery.title} required className={input} />
          </label>
          <label className="flex flex-col gap-1">
            {t("status")}
            <select name="status" defaultValue={gallery.status} className={input}>
              <option value="draft">Borrador</option>
              <option value="published">Publicada</option>
              <option value="archived">Archivada</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t("theme")}
            <select name="theme" defaultValue={gallery.theme} className={input}>
              <option value="light">{t("themes.light")}</option>
              <option value="dark">{t("themes.dark")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t("photoOrder")}
            <select name="photoOrder" defaultValue={gallery.photoOrder} className={input}>
              <option value="capture">{t("orders.capture")}</option>
              <option value="filename">{t("orders.filename")}</option>
              <option value="manual">{t("orders.manual")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t("watermarkMode")}
            <select name="watermarkMode" defaultValue={gallery.watermarkMode} className={input}>
              <option value="none">{t("watermarks.none")}</option>
              <option value="view">{t("watermarks.view")}</option>
              <option value="download">{t("watermarks.download")}</option>
              <option value="both">{t("watermarks.both")}</option>
            </select>
          </label>
          <fieldset className="col-span-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="downloadEnabled" defaultChecked={gallery.downloadEnabled} className={check} />
              {t("downloadEnabled")}
            </label>
            <span className="text-neutral-400">|</span>
            <span>{t("resolutions")}:</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resWebEnabled" defaultChecked={gallery.resWebEnabled} className={check} />
              {t("resWeb")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resHighEnabled" defaultChecked={gallery.resHighEnabled} className={check} />
              {t("resHigh")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resOriginalEnabled" defaultChecked={gallery.resOriginalEnabled} className={check} />
              {t("resOriginal")}
            </label>
          </fieldset>
          <label className="flex flex-col gap-1">
            {t("newPassword")}
            <input name="password" type="password" className={input} />
          </label>
          <label className="flex items-center gap-2 self-end">
            <input type="checkbox" name="clearPassword" className={check} />
            {t("clearPassword")}
          </label>
          <button className="col-span-2 justify-self-start rounded bg-neutral-900 px-4 py-1.5 text-white">
            {t("save")}
          </button>
        </form>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{t("sections")}</h2>
        <ul className="mb-4 divide-y">
          {sectionList.length === 0 && <li className="py-2 text-sm text-neutral-500">{t("noSections")}</li>}
          {sectionList.map((s, idx) => (
            <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
              <form action={renameSectionAction} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input name="name" defaultValue={s.name} className={`${input} flex-1`} />
                <button className="text-neutral-600 hover:underline">{t("rename")}</button>
              </form>
              {!s.visible && <span className="rounded bg-neutral-200 px-1.5 text-xs">oculta</span>}
              <form action={moveSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="direction" value="up" />
                <button disabled={idx === 0} className="px-1 disabled:opacity-30">↑</button>
              </form>
              <form action={moveSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="direction" value="down" />
                <button disabled={idx === sectionList.length - 1} className="px-1 disabled:opacity-30">↓</button>
              </form>
              <form action={toggleSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="visible" value={s.visible ? "false" : "true"} />
                <button className="text-neutral-600 hover:underline">
                  {s.visible ? t("hide") : t("show")}
                </button>
              </form>
              <form action={deleteSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <button className="text-red-600 hover:underline">{t("delete")}</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addSectionAction} className="flex gap-2">
          <input type="hidden" name="galleryId" value={gallery.id} />
          <input name="name" required placeholder={t("sectionName")} className={input} />
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("add")}</button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verificar build y suite completa**

```bash
npm run build && npm test
```

Expected: build OK; todos los tests en PASS.

- [ ] **Step 5: Verificación manual** (si hay `.env.local`): crear galería → abrirla → cambiar configuración y guardar → agregar 3 secciones, renombrar, reordenar con ↑↓, ocultar una, eliminar otra.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add gallery detail page with settings form and section management"
```

---

### Task 9: Verificación final de la fase

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: fase 1 verificada y documentada.

- [ ] **Step 1: Suite completa + build + lint**

```bash
npm test && npm run build && npx eslint src tests
```

Expected: todo PASS/OK, sin errores de lint.

- [ ] **Step 2: README** — crear `README.md`:

```markdown
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
```

- [ ] **Step 3: Commit final**

```bash
git add README.md
git commit -m "docs: add README with setup instructions"
```

---

## Self-Review (ya aplicado)

- **Cobertura del spec (fase 1):** esquema completo ✓, Auth0 + verificación server-side doble ✓, CRUD galerías con contraseña bcrypt ✓, secciones con visible/overrides en esquema y fotos→sin sección al borrar ✓, lista con buscador y filtro de estado ✓, i18n es/en ✓, multi-tenant con tests de aislamiento ✓. Fuera de fase 1 (correcto): fotos/R2, indicador de almacenamiento (fase 2), acceso de clientes (fase 3).
- **Placeholders:** ninguno; todo paso tiene código o comando completo.
- **Consistencia de tipos:** firmas de dominio usadas por las actions coinciden (`createGallery(db, studioId, {title, password?})`, etc.); `Db` unifica node-postgres y PGlite.
