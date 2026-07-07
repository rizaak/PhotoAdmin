# PhonoManager Fase 3 (Acceso de clientes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los clientes entran a `/g/[slug]` (contraseña opcional + email obligatorio), ven la galería publicada, marcan favoritas y comentan; el fotógrafo ve la actividad por cliente, crea secciones desde selecciones y recibe emails de actividad.

**Architecture:** Sesión de cliente = JWT propio (jose, HS256) en cookie HttpOnly con path scoped a `/g/[slug]`. Tres módulos de dominio nuevos (`clientAccess` = entrada/upserts/datos de galería, `engagement` = likes/comentarios/actividad, `emails` = Resend con no-op sin API key) + helper `requireClientSession` espejo de `requireStudio`. UI: página pública `/g/[slug]` (form de acceso o galería) y pestaña Actividad en el admin.

**Tech Stack:** Se agrega `jose` (JWT) y `resend` (emails). Lo demás ya existe.

**Spec:** `docs/superpowers/specs/2026-07-05-photo-gallery-delivery-design.md`

**Desviaciones/decisiones aprobadas:**
- La vista cliente sirve thumb/web **sin marca de agua** (las variantes con marca se generan en F4; ahí se conecta la resolución foto→sección→galería al serving). No compartir enlaces que dependan de marca de agua hasta F4.
- Descargas del cliente: F4. Badges de favoritas/comentarios en el gestor admin: se agregan aquí (los datos ya existen).
- Emails al fotógrafo: inmediatos en **primer acceso de un cliente** y en **cada comentario**; los likes solo se ven en el dashboard (evita spam).
- "¿Ocultar las demás secciones?" al crear sección desde selección = checkbox en el mismo formulario.

## Global Constraints

- Sesión cliente: JWT HS256 firmado con `CLIENT_SESSION_SECRET` (env nueva), payload exacto `{ clientId, galleryId }`, expiración 30 días, cookie `client_session` HttpOnly+Secure+SameSite=Lax con `path=/g/{slug}` — alcance a UNA galería.
- Toda server action del cliente re-verifica el JWT en el servidor y toma `galleryId` DEL TOKEN, jamás del input.
- Solo galerías `status=published` son accesibles; secciones `visible=true`; fotos `published=true` y `status=ready`. Fotos ocultas o galerías draft/archived → 404, nunca "existe pero bloqueada".
- Contraseña de galería: bcrypt.compare contra `passwordHash`; rate limit 10 intentos / 15 min por (IP + slug) — in-memory, documentado que es por instancia serverless.
- Privacidad: cada cliente ve SOLO sus likes/comentarios (queries filtran por clientId). El fotógrafo ve todo agrupado por cliente.
- Eventos `activity_events` solo relevantes: `access` (cada acceso exitoso), `like_added`, `like_removed`, `comment`.
- Emails: si falta `RESEND_API_KEY` o el studio no tiene `notificationEmail`, la función es no-op silenciosa (log) — nunca rompe el flujo del cliente. Envío fire-and-forget (`.catch`) — jamás bloquea la respuesta.
- URLs de fotos SIEMPRE prefirmadas cortas server-side (`presignDownload`); multi-tenant y Zod como en fases previas; TDD en dominio; i18n es/en con paridad; TypeScript strict; suite gate: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` sin errores ni warnings.
- Envs nuevas en `.env.example`: `CLIENT_SESSION_SECRET` (hex 32), `RESEND_API_KEY` (opcional), `RESEND_FROM` (opcional, default `onboarding@resend.dev`).

---

### Task 1: Deps + email de notificación del studio + envs

**Files:**
- Modify: `src/db/schema.ts` (columna `notificationEmail` en studios)
- Create: `drizzle/0001_*.sql` (generada)
- Modify: `src/server/studio.ts`, `src/server/auth.ts`
- Modify: `.env.example`
- Test: `tests/server/studio.test.ts` (ampliar)

**Interfaces:**
- Consumes: `ensureStudio(db, auth0UserId, displayName)` existente.
- Produces: `ensureStudio(db: Db, auth0UserId: string, displayName: string, email?: string | null): Promise<Studio>` — guarda `notificationEmail` al crear (no sobreescribe después); `studios.notificationEmail: string | null` en el schema.

- [ ] **Step 1: Instalar deps**

```bash
npm install jose resend
```

- [ ] **Step 2: Test failing** — agregar a `tests/server/studio.test.ts`:

```ts
  it("stores notification email on first login without overwriting later", async () => {
    const db = await createTestDb();
    const s1 = await ensureStudio(db, "auth0|mail1", "Isaac", "isaac@example.com");
    expect(s1.notificationEmail).toBe("isaac@example.com");
    const s2 = await ensureStudio(db, "auth0|mail1", "Isaac", "otro@example.com");
    expect(s2.notificationEmail).toBe("isaac@example.com");
    const s3 = await ensureStudio(db, "auth0|mail2", "Sin Mail");
    expect(s3.notificationEmail).toBeNull();
  });
```

- [ ] **Step 3: Verificar RED**

Run: `npx vitest run tests/server/studio.test.ts`
Expected: FAIL (columna/parámetro inexistentes).

- [ ] **Step 4: Schema + migración** — en `src/db/schema.ts`, dentro de `studios`, después de `auth0UserId`:

```ts
  notificationEmail: text("notification_email"),
```

```bash
npm run db:generate
```

Expected: `drizzle/0001_*.sql` con `ALTER TABLE "studios" ADD COLUMN "notification_email" text;`.

- [ ] **Step 5: ensureStudio** — `src/server/studio.ts`:

```ts
export async function ensureStudio(
  db: Db, auth0UserId: string, displayName: string, email?: string | null,
): Promise<Studio> {
  const existing = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(studios)
    .values({ name: displayName, slug: makeSlug(displayName), auth0UserId, notificationEmail: email ?? null })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const [winner] = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  return winner;
}
```

En `src/server/auth.ts`, pasar el email de la sesión:

```ts
  return ensureStudio(db, session.user.sub, displayName, (session.user.email as string | undefined) ?? null);
```

- [ ] **Step 6: Verificar GREEN + aplicar migración a Neon**

```bash
npx vitest run tests/server/studio.test.ts && npm test
sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'
```

Expected: tests PASS; migración aplicada sin error.

- [ ] **Step 7: `.env.example`** — agregar al final:

```bash
# Sesión de clientes (JWT). Generar con: openssl rand -hex 32
CLIENT_SESSION_SECRET=use-openssl-rand-hex-32
# Emails de actividad al fotógrafo (opcional; sin key = no se envían)
RESEND_API_KEY=
RESEND_FROM=onboarding@resend.dev
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add studio notification email and client-session/resend env scaffolding"
```

---

### Task 2: Módulo de sesión de cliente (JWT)

**Files:**
- Create: `src/server/client-session.ts`
- Test: `tests/server/client-session.test.ts`

**Interfaces:**
- Produces:
  - `signClientSession(payload: { clientId: string; galleryId: string }): Promise<string>` — JWT HS256, exp 30d.
  - `verifyClientSession(token: string): Promise<{ clientId: string; galleryId: string } | null>` — null si inválido/expirado/payload incompleto.
  - `CLIENT_COOKIE = "client_session"` y `clientCookieOptions(slug: string)` → `{ httpOnly: true, secure: true, sameSite: "lax" as const, path: \`/g/${slug}\`, maxAge: 60 * 60 * 24 * 30 }`.

- [ ] **Step 1: Test failing** — `tests/server/client-session.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.CLIENT_SESSION_SECRET = "a".repeat(64);
});

describe("client session JWT", () => {
  it("signs and verifies a round-trip payload", async () => {
    const { signClientSession, verifyClientSession } = await import("@/server/client-session");
    const token = await signClientSession({ clientId: "c1", galleryId: "g1" });
    expect(await verifyClientSession(token)).toEqual({ clientId: "c1", galleryId: "g1" });
  });

  it("rejects tampered tokens and garbage", async () => {
    const { signClientSession, verifyClientSession } = await import("@/server/client-session");
    const token = await signClientSession({ clientId: "c1", galleryId: "g1" });
    expect(await verifyClientSession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifyClientSession("garbage")).toBeNull();
  });

  it("builds gallery-scoped cookie options", async () => {
    const { clientCookieOptions, CLIENT_COOKIE } = await import("@/server/client-session");
    expect(CLIENT_COOKIE).toBe("client_session");
    const opts = clientCookieOptions("boda-ana-x1");
    expect(opts.path).toBe("/g/boda-ana-x1");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/client-session.test.ts` → FAIL módulo inexistente.

- [ ] **Step 3: Implementar** — `src/server/client-session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

export const CLIENT_COOKIE = "client_session";

export type ClientSession = { clientId: string; galleryId: string };

function secret(): Uint8Array {
  const value = process.env.CLIENT_SESSION_SECRET;
  if (!value) throw new Error("Missing env var CLIENT_SESSION_SECRET");
  return new TextEncoder().encode(value);
}

export async function signClientSession(payload: ClientSession): Promise<string> {
  return new SignJWT({ clientId: payload.clientId, galleryId: payload.galleryId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyClientSession(token: string): Promise<ClientSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.clientId !== "string" || typeof payload.galleryId !== "string") return null;
    return { clientId: payload.clientId, galleryId: payload.galleryId };
  } catch {
    return null;
  }
}

export function clientCookieOptions(slug: string) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: `/g/${slug}`,
    maxAge: 60 * 60 * 24 * 30,
  };
}
```

- [ ] **Step 4: GREEN** — `npx vitest run tests/server/client-session.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/server/client-session.ts tests/server/client-session.test.ts
git commit -m "feat: add gallery-scoped client session JWT module"
```

---

### Task 3: Rate limiter en memoria

**Files:**
- Create: `src/server/rate-limit.ts`
- Test: `tests/server/rate-limit.test.ts`

**Interfaces:**
- Produces: `checkRateLimit(key: string, max?: number, windowMs?: number): boolean` (defaults 10 / 900000) — true = permitido; ventana deslizante simple; `resetRateLimit()` exportada solo para tests.

- [ ] **Step 1: Test failing** — `tests/server/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/server/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => { resetRateLimit(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("allows up to max attempts then blocks", () => {
    for (let i = 0; i < 10; i++) expect(checkRateLimit("ip1:slug", 10, 900000)).toBe(true);
    expect(checkRateLimit("ip1:slug", 10, 900000)).toBe(false);
    expect(checkRateLimit("ip2:slug", 10, 900000)).toBe(true); // otra clave no afectada
  });

  it("frees attempts after the window slides", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("k", 10, 900000);
    expect(checkRateLimit("k", 10, 900000)).toBe(false);
    vi.advanceTimersByTime(900001);
    expect(checkRateLimit("k", 10, 900000)).toBe(true);
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/rate-limit.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/server/rate-limit.ts`:

```ts
// Ventana deslizante en memoria. En serverless es por instancia: suficiente
// como fricción anti fuerza bruta v1; endurecer con storage compartido si escala.
const attempts = new Map<string, number[]>();

export function checkRateLimit(key: string, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

export function resetRateLimit(): void {
  attempts.clear();
}
```

- [ ] **Step 4: GREEN** — `npx vitest run tests/server/rate-limit.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/server/rate-limit.ts tests/server/rate-limit.test.ts
git commit -m "feat: add in-memory sliding-window rate limiter"
```

---

### Task 4: Dominio de acceso del cliente

**Files:**
- Create: `src/server/client-access.ts`
- Modify: `src/server/photos.ts` (extraer helper de orden)
- Test: `tests/server/client-access.test.ts`

**Interfaces:**
- Consumes: schema (`galleries, clients, galleryClients, activityEvents, sections, photos`), bcryptjs.
- Produces:
  - En `photos.ts`: `listPhotosForGallery(db: Db, gallery: Gallery): Promise<Photo[]>` (orden según gallery.photoOrder, SIN chequeo de tenancy — el caller ya validó); `listGalleryPhotos` pasa a delegarle.
  - `getPublicGallery(db: Db, slug: string): Promise<Gallery>` — solo `status=published`, si no `Error("NOT_FOUND")`.
  - `accessGallery(db: Db, slug: string, input: { email: string; name?: string; password?: string }): Promise<{ gallery: Gallery; clientId: string; firstAccess: boolean }>` — errores: `NOT_FOUND`, `PASSWORD_REQUIRED`, `INVALID_PASSWORD`. Email normalizado lowercase/trim; upsert `clients` por (studioId,email); upsert `gallery_clients` (lastSeenAt=now, firstAccess=true si la fila es nueva); registra evento `access` SIEMPRE que el acceso es exitoso.
  - `getClientGalleryData(db: Db, galleryId: string, clientId: string): Promise<ClientGalleryData>` con `ClientGalleryData = { gallery: Gallery; sections: Section[] (solo visible, orden position); photos: Photo[] (solo published+ready, orden de la galería); likedPhotoIds: string[]; commentsByPhoto: Record<string, { id: string; body: string; createdAt: Date }[]> (SOLO del cliente) }`.

- [ ] **Step 1: Tests failing** — `tests/server/client-access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { createSection, setSectionVisible } from "@/server/sections";
import { registerUpload, completeProcessing, setPhotosPublished } from "@/server/photos";
import { getPublicGallery, accessGallery, getClientGalleryData } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import { activityEvents } from "@/db/schema";

async function publishedGallery(db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, password?: string) {
  const g = await createGallery(db, studioId, { title: "Boda", password });
  await updateGallerySettings(db, studioId, g.id, { status: "published" });
  return (await getPublicGallery(db, g.slug));
}

async function readyPhoto(db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, galleryId: string, name = "a.jpg") {
  const p = await registerUpload(db, studioId, galleryId, { filename: name, size: 10, contentType: "image/jpeg", sectionId: null });
  return completeProcessing(db, studioId, p.id, {
    width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 10,
  });
}

describe("client access", () => {
  it("only exposes published galleries", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const draft = await createGallery(db, studio.id, { title: "Borrador" });
    await expect(getPublicGallery(db, draft.slug)).rejects.toThrow("NOT_FOUND");
    await expect(getPublicGallery(db, "no-existe")).rejects.toThrow("NOT_FOUND");
    const g = await publishedGallery(db, studio.id);
    expect(g.status).toBe("published");
  });

  it("enforces gallery password and rejects wrong ones", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id, "clave123");
    await expect(accessGallery(db, g.slug, { email: "ana@x.com" })).rejects.toThrow("PASSWORD_REQUIRED");
    await expect(accessGallery(db, g.slug, { email: "ana@x.com", password: "mala" })).rejects.toThrow("INVALID_PASSWORD");
    const ok = await accessGallery(db, g.slug, { email: "ana@x.com", password: "clave123" });
    expect(ok.firstAccess).toBe(true);
  });

  it("upserts client by normalized email and tracks first vs repeat access", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id);
    const first = await accessGallery(db, g.slug, { email: "  Ana@X.com ", name: "Ana" });
    const again = await accessGallery(db, g.slug, { email: "ana@x.com" });
    expect(again.clientId).toBe(first.clientId);
    expect(first.firstAccess).toBe(true);
    expect(again.firstAccess).toBe(false);
    const events = await db.select().from(activityEvents);
    expect(events.filter((e) => e.type === "access")).toHaveLength(2);
  });

  it("returns only visible sections, published+ready photos, and only the client's own activity", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id);
    const visible = await createSection(db, studio.id, g.id, "Visible");
    const hidden = await createSection(db, studio.id, g.id, "Oculta");
    await setSectionVisible(db, studio.id, hidden.id, false);

    const shown = await readyPhoto(db, studio.id, g.id, "shown.jpg");
    const unpublished = await readyPhoto(db, studio.id, g.id, "hidden.jpg");
    await setPhotosPublished(db, studio.id, g.id, [unpublished.id], false);
    await registerUpload(db, studio.id, g.id, { filename: "processing.jpg", size: 5, contentType: "image/jpeg", sectionId: null });

    const ana = await accessGallery(db, g.slug, { email: "ana@x.com" });
    const beto = await accessGallery(db, g.slug, { email: "beto@x.com" });
    await toggleLike(db, beto.clientId, g.id, shown.id);
    await addComment(db, beto.clientId, g.id, shown.id, "de beto");
    await toggleLike(db, ana.clientId, g.id, shown.id);

    const data = await getClientGalleryData(db, g.id, ana.clientId);
    expect(data.sections.map((s) => s.id)).toEqual([visible.id]);
    expect(data.photos.map((p) => p.id)).toEqual([shown.id]);
    expect(data.likedPhotoIds).toEqual([shown.id]); // solo el like de ana
    expect(data.commentsByPhoto[shown.id] ?? []).toHaveLength(0); // el comentario de beto no se ve
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/client-access.test.ts` → FAIL (módulos inexistentes; `engagement` llega en Task 5 — implementar Task 4 y dejar este test en rojo SOLO en los asserts de engagement no es aceptable: coordinar con Task 5 significa que este archivo de test se completa aquí pero la suite total quedará verde recién al terminar Task 5. Para mantener cada task verde: en ESTA task crear también un stub NO es aceptable. Solución: este test importa `toggleLike`/`addComment` — se implementan en Task 5; por eso el último test de este archivo se escribe aquí pero se marca `it.todo(...)` y Task 5 lo activa. Concretamente: escribir el cuarto test como `it.todo("returns only visible sections, published+ready photos, and only the client's own activity")` con el cuerpo comentado, y Task 5 lo des-todo-iza. Los tres primeros tests deben quedar GREEN en esta task.)

- [ ] **Step 3: Implementar** — en `src/server/photos.ts`, reemplazar `listGalleryPhotos` por:

```ts
export async function listPhotosForGallery(db: Db, gallery: Gallery): Promise<Photo[]> {
  const base = db.select().from(photos).where(eq(photos.galleryId, gallery.id));
  if (gallery.photoOrder === "manual") return base.orderBy(asc(photos.position), asc(photos.filename));
  if (gallery.photoOrder === "filename") return base.orderBy(asc(photos.filename));
  return base.orderBy(sql`${photos.takenAt} asc nulls last`, asc(photos.filename));
}

export async function listGalleryPhotos(db: Db, studioId: string, galleryId: string): Promise<Photo[]> {
  const gallery = await getGallery(db, studioId, galleryId);
  return listPhotosForGallery(db, gallery);
}
```

(importar `type Gallery` desde `@/db/schema`). Crear `src/server/client-access.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import {
  galleries, clients, galleryClients, activityEvents, sections, comments, likes, photos,
  type Gallery, type Section, type Photo,
} from "@/db/schema";
import { listPhotosForGallery } from "./photos";

const accessSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(100).optional(),
  password: z.string().max(100).optional(),
});
export type AccessInput = z.infer<typeof accessSchema>;

export async function getPublicGallery(db: Db, slug: string): Promise<Gallery> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.slug, slug), eq(galleries.status, "published")));
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function accessGallery(
  db: Db, slug: string, input: AccessInput,
): Promise<{ gallery: Gallery; clientId: string; firstAccess: boolean }> {
  const data = accessSchema.parse(input);
  const gallery = await getPublicGallery(db, slug);

  if (gallery.passwordHash) {
    if (!data.password) throw new Error("PASSWORD_REQUIRED");
    if (!(await bcrypt.compare(data.password, gallery.passwordHash))) {
      throw new Error("INVALID_PASSWORD");
    }
  }

  await db.insert(clients)
    .values({ studioId: gallery.studioId, email: data.email, name: data.name ?? null })
    .onConflictDoNothing();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.studioId, gallery.studioId), eq(clients.email, data.email)));

  const inserted = await db.insert(galleryClients)
    .values({ galleryId: gallery.id, clientId: client.id, lastSeenAt: new Date() })
    .onConflictDoNothing()
    .returning();
  const firstAccess = inserted.length > 0;
  if (!firstAccess) {
    await db.update(galleryClients).set({ lastSeenAt: new Date() })
      .where(and(eq(galleryClients.galleryId, gallery.id), eq(galleryClients.clientId, client.id)));
  }

  await db.insert(activityEvents)
    .values({ galleryId: gallery.id, clientId: client.id, type: "access" });

  return { gallery, clientId: client.id, firstAccess };
}

export type ClientGalleryData = {
  gallery: Gallery;
  sections: Section[];
  photos: Photo[];
  likedPhotoIds: string[];
  commentsByPhoto: Record<string, { id: string; body: string; createdAt: Date }[]>;
};

export async function getClientGalleryData(db: Db, galleryId: string, clientId: string): Promise<ClientGalleryData> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.status, "published")));
  if (!gallery) throw new Error("NOT_FOUND");

  const visibleSections = await db.select().from(sections)
    .where(and(eq(sections.galleryId, galleryId), eq(sections.visible, true)))
    .orderBy(asc(sections.position));

  const allPhotos = await listPhotosForGallery(db, gallery);
  const shown = allPhotos.filter((p) => p.published && p.status === "ready");
  const visibleSectionIds = new Set(visibleSections.map((s) => s.id));
  const clientPhotos = shown.filter((p) => p.sectionId === null || visibleSectionIds.has(p.sectionId));
  const shownIds = new Set(clientPhotos.map((p) => p.id));

  const myLikes = await db.select({ photoId: likes.photoId }).from(likes)
    .where(eq(likes.clientId, clientId));
  const myComments = await db.select().from(comments)
    .where(eq(comments.clientId, clientId))
    .orderBy(asc(comments.createdAt));

  const commentsByPhoto: ClientGalleryData["commentsByPhoto"] = {};
  for (const c of myComments) {
    if (!shownIds.has(c.photoId)) continue;
    (commentsByPhoto[c.photoId] ??= []).push({ id: c.id, body: c.body, createdAt: c.createdAt });
  }

  return {
    gallery,
    sections: visibleSections,
    photos: clientPhotos,
    likedPhotoIds: myLikes.map((l) => l.photoId).filter((id) => shownIds.has(id)),
    commentsByPhoto,
  };
}
```

- [ ] **Step 4: GREEN parcial** — `npx vitest run tests/server/client-access.test.ts` → 3 PASS + 1 todo. Suite completa `npm test` verde.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add client access domain (published-only, password, upserts, access events)"
```

---

### Task 5: Dominio de engagement del cliente (likes + comentarios)

**Files:**
- Create: `src/server/engagement.ts`
- Modify: `tests/server/client-access.test.ts` (activar el `it.todo` de Task 4)
- Test: `tests/server/engagement.test.ts`

**Interfaces:**
- Produces (Tasks 6/9/10 consumen):
  - `toggleLike(db: Db, clientId: string, galleryId: string, photoId: string): Promise<{ liked: boolean }>` — valida foto ∈ galería, published, ready; registra evento `like_added`/`like_removed`; `Error("NOT_FOUND")` si no aplica.
  - `addComment(db: Db, clientId: string, galleryId: string, photoId: string, body: string): Promise<{ id: string; body: string; createdAt: Date }>` — Zod body trim 1..1000; mismas validaciones; evento `comment`.
  - Ambas verifican además que el cliente pertenece a la galería (fila en `gallery_clients`) — `Error("NOT_FOUND")` si no.

- [ ] **Step 1: Tests failing** — `tests/server/engagement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { registerUpload, completeProcessing, setPhotosPublished } from "@/server/photos";
import { accessGallery } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import { activityEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const g = await createGallery(db, studio.id, { title: "Boda" });
  await updateGallerySettings(db, studio.id, g.id, { status: "published" });
  const p0 = await registerUpload(db, studio.id, g.id, { filename: "a.jpg", size: 10, contentType: "image/jpeg", sectionId: null });
  const photo = await completeProcessing(db, studio.id, p0.id, {
    width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 10,
  });
  const { clientId } = await accessGallery(db, g.slug, { email: "ana@x.com" });
  return { db, studio, gallery: g, photo, clientId };
}

describe("engagement", () => {
  it("toggles likes with events", async () => {
    const { db, gallery, photo, clientId } = await setup();
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: true });
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: false });
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: true });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.photoId, photo.id));
    expect(events.map((e) => e.type)).toEqual(["like_added", "like_removed", "like_added"]);
  });

  it("adds validated comments with events", async () => {
    const { db, gallery, photo, clientId } = await setup();
    const c = await addComment(db, clientId, gallery.id, photo.id, "  Preciosa!  ");
    expect(c.body).toBe("Preciosa!");
    await expect(addComment(db, clientId, gallery.id, photo.id, "   ")).rejects.toThrow();
    await expect(addComment(db, clientId, gallery.id, photo.id, "x".repeat(1001))).rejects.toThrow();
  });

  it("rejects hidden photos, foreign galleries and non-member clients", async () => {
    const { db, studio, gallery, photo, clientId } = await setup();
    await setPhotosPublished(db, studio.id, gallery.id, [photo.id], false);
    await expect(toggleLike(db, clientId, gallery.id, photo.id)).rejects.toThrow("NOT_FOUND");
    await setPhotosPublished(db, studio.id, gallery.id, [photo.id], true);

    const other = await createGallery(db, studio.id, { title: "Otra" });
    await updateGallerySettings(db, studio.id, other.id, { status: "published" });
    await expect(toggleLike(db, clientId, other.id, photo.id)).rejects.toThrow("NOT_FOUND");

    const { clientId: outsider } = await accessGallery(db, other.slug, { email: "otro@x.com" });
    await expect(addComment(db, outsider, gallery.id, photo.id, "hola")).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/engagement.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/server/engagement.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { photos, likes, comments, galleryClients, activityEvents } from "@/db/schema";

const bodySchema = z.string().trim().min(1).max(1000);

async function assertEngageable(db: Db, clientId: string, galleryId: string, photoId: string) {
  const [membership] = await db.select({ clientId: galleryClients.clientId }).from(galleryClients)
    .where(and(eq(galleryClients.galleryId, galleryId), eq(galleryClients.clientId, clientId)));
  if (!membership) throw new Error("NOT_FOUND");
  const [photo] = await db.select().from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.galleryId, galleryId)));
  if (!photo || !photo.published || photo.status !== "ready") throw new Error("NOT_FOUND");
  return photo;
}

export async function toggleLike(
  db: Db, clientId: string, galleryId: string, photoId: string,
): Promise<{ liked: boolean }> {
  await assertEngageable(db, clientId, galleryId, photoId);
  const deleted = await db.delete(likes)
    .where(and(eq(likes.clientId, clientId), eq(likes.photoId, photoId)))
    .returning();
  if (deleted.length > 0) {
    await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "like_removed" });
    return { liked: false };
  }
  await db.insert(likes).values({ clientId, photoId });
  await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "like_added" });
  return { liked: true };
}

export async function addComment(
  db: Db, clientId: string, galleryId: string, photoId: string, body: string,
): Promise<{ id: string; body: string; createdAt: Date }> {
  const text = bodySchema.parse(body);
  await assertEngageable(db, clientId, galleryId, photoId);
  const [comment] = await db.insert(comments)
    .values({ clientId, photoId, body: text })
    .returning();
  await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "comment" });
  return { id: comment.id, body: comment.body, createdAt: comment.createdAt };
}
```

- [ ] **Step 4: Activar el test diferido de Task 4** — en `tests/server/client-access.test.ts`, convertir el `it.todo(...)` en el test completo del Step 1 de Task 4 (cuarto test, cuerpo íntegro).

- [ ] **Step 5: GREEN total**

```bash
npx vitest run tests/server/engagement.test.ts tests/server/client-access.test.ts && npm test
```

Expected: todos PASS (client-access ahora 4/4).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add client engagement domain (likes and comments with events)"
```

---

### Task 6: Dominio de actividad del admin + sección desde selección

**Files:**
- Create: `src/server/activity.ts`
- Test: `tests/server/activity.test.ts`

**Interfaces:**
- Consumes: `getGallery`, `createSection`, `setSectionVisible` (fase 1), `movePhotos` (fase 2), engagement/client-access (para fixtures de test).
- Produces (Task 10 consume):
  - `listGalleryClients(db: Db, studioId: string, galleryId: string): Promise<{ clientId: string; email: string; name: string | null; lastSeenAt: Date | null; likeCount: number; commentCount: number }[]>`
  - `clientEngagementDetail(db: Db, studioId: string, galleryId: string, clientId: string): Promise<{ likedPhotos: Photo[]; comments: { id: string; body: string; createdAt: Date; photo: Photo }[] }>` — solo fotos de ESA galería.
  - `clientActivityLog(db: Db, studioId: string, galleryId: string, clientId: string): Promise<{ type: string; createdAt: Date; photoFilename: string | null }[]>` — desc por fecha, máx 200.
  - `selectionUnion(db: Db, studioId: string, galleryId: string, clientIds: string[]): Promise<string[]>` — photoIds únicos con like de cualquiera de esos clientes en esa galería.
  - `createSectionFromSelection(db: Db, studioId: string, galleryId: string, clientIds: string[], name: string, hideOthers: boolean): Promise<{ sectionId: string; movedCount: number }>` — crea sección, MUEVE las fotos de la unión (una foto vive en una sola sección), y si `hideOthers` oculta las demás secciones (la nueva queda visible). `Error("EMPTY_SELECTION")` si la unión es vacía.
  - Todo tenant-scoped vía `getGallery` primero; tests de aislamiento.

- [ ] **Step 1: Tests failing** — `tests/server/activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { createSection, listSections } from "@/server/sections";
import { registerUpload, completeProcessing, getOwnedPhoto } from "@/server/photos";
import { accessGallery } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import {
  listGalleryClients, clientEngagementDetail, clientActivityLog, selectionUnion, createSectionFromSelection,
} from "@/server/activity";

async function fixture() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const g = await createGallery(db, studio.id, { title: "Boda" });
  await updateGallerySettings(db, studio.id, g.id, { status: "published" });
  const mk = async (name: string) => {
    const p = await registerUpload(db, studio.id, g.id, { filename: name, size: 1, contentType: "image/jpeg", sectionId: null });
    return completeProcessing(db, studio.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 1,
    });
  };
  const [p1, p2, p3] = [await mk("1.jpg"), await mk("2.jpg"), await mk("3.jpg")];
  const ana = (await accessGallery(db, g.slug, { email: "ana@x.com", name: "Ana" })).clientId;
  const beto = (await accessGallery(db, g.slug, { email: "beto@x.com" })).clientId;
  await toggleLike(db, ana, g.id, p1.id);
  await toggleLike(db, ana, g.id, p2.id);
  await toggleLike(db, beto, g.id, p2.id);
  await toggleLike(db, beto, g.id, p3.id);
  await addComment(db, ana, g.id, p1.id, "me encanta");
  return { db, studio, g, p1, p2, p3, ana, beto };
}

describe("admin activity", () => {
  it("lists clients with engagement counts", async () => {
    const { db, studio, g } = await fixture();
    const rows = await listGalleryClients(db, studio.id, g.id);
    const ana = rows.find((r) => r.email === "ana@x.com")!;
    expect(rows).toHaveLength(2);
    expect(ana.name).toBe("Ana");
    expect(ana.likeCount).toBe(2);
    expect(ana.commentCount).toBe(1);
  });

  it("returns per-client detail and curated log", async () => {
    const { db, studio, g, ana, p1 } = await fixture();
    const detail = await clientEngagementDetail(db, studio.id, g.id, ana);
    expect(detail.likedPhotos.map((p) => p.filename).sort()).toEqual(["1.jpg", "2.jpg"]);
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].photo.id).toBe(p1.id);

    const log = await clientActivityLog(db, studio.id, g.id, ana);
    expect(log.map((e) => e.type)).toEqual(["comment", "like_added", "like_added", "access"]);
    expect(log[0].photoFilename).toBe("1.jpg");
  });

  it("unions selections without duplicates and creates the section moving photos", async () => {
    const { db, studio, g, ana, beto, p1, p2, p3 } = await fixture();
    const union = await selectionUnion(db, studio.id, g.id, [ana, beto]);
    expect(union.sort()).toEqual([p1.id, p2.id, p3.id].sort()); // p2 una sola vez

    const existing = await createSection(db, studio.id, g.id, "Anterior");
    const { sectionId, movedCount } = await createSectionFromSelection(
      db, studio.id, g.id, [ana, beto], "Favoritas combinadas", true,
    );
    expect(movedCount).toBe(3);
    expect((await getOwnedPhoto(db, studio.id, p2.id)).sectionId).toBe(sectionId);
    const sectionsNow = await listSections(db, studio.id, g.id);
    expect(sectionsNow.find((s) => s.id === sectionId)?.visible).toBe(true);
    expect(sectionsNow.find((s) => s.id === existing.id)?.visible).toBe(false); // hideOthers
  });

  it("rejects empty selections and is tenant-scoped", async () => {
    const { db, studio, g, ana } = await fixture();
    const intruder = await seedStudio(db, "auth0|intruder");
    await expect(createSectionFromSelection(db, studio.id, g.id, [], "X", false)).rejects.toThrow("EMPTY_SELECTION");
    await expect(listGalleryClients(db, intruder.id, g.id)).rejects.toThrow("NOT_FOUND");
    await expect(clientEngagementDetail(db, intruder.id, g.id, ana)).rejects.toThrow("NOT_FOUND");
    await expect(createSectionFromSelection(db, intruder.id, g.id, [ana], "X", false)).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/activity.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/server/activity.ts`:

```ts
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  clients, galleryClients, likes, comments, photos, activityEvents, type Photo,
} from "@/db/schema";
import { getGallery } from "./galleries";
import { createSection, listSections, setSectionVisible } from "./sections";
import { movePhotos } from "./photos";

export async function listGalleryClients(db: Db, studioId: string, galleryId: string) {
  await getGallery(db, studioId, galleryId);
  const rows = await db
    .select({
      clientId: clients.id,
      email: clients.email,
      name: clients.name,
      lastSeenAt: galleryClients.lastSeenAt,
      likeCount: sql<number>`(
        select count(*)::int from ${likes}
        join ${photos} on ${photos.id} = ${likes.photoId}
        where ${likes.clientId} = ${clients.id} and ${photos.galleryId} = ${galleryClients.galleryId}
      )`,
      commentCount: sql<number>`(
        select count(*)::int from ${comments}
        join ${photos} on ${photos.id} = ${comments.photoId}
        where ${comments.clientId} = ${clients.id} and ${photos.galleryId} = ${galleryClients.galleryId}
      )`,
    })
    .from(galleryClients)
    .innerJoin(clients, eq(galleryClients.clientId, clients.id))
    .where(eq(galleryClients.galleryId, galleryId))
    .orderBy(desc(galleryClients.lastSeenAt));
  return rows;
}

export async function clientEngagementDetail(db: Db, studioId: string, galleryId: string, clientId: string) {
  await getGallery(db, studioId, galleryId);
  const likedPhotos = await db.select({ photo: photos }).from(likes)
    .innerJoin(photos, eq(likes.photoId, photos.id))
    .where(and(eq(likes.clientId, clientId), eq(photos.galleryId, galleryId)))
    .then((rows) => rows.map((r) => r.photo));
  const commentRows = await db.select({ comment: comments, photo: photos }).from(comments)
    .innerJoin(photos, eq(comments.photoId, photos.id))
    .where(and(eq(comments.clientId, clientId), eq(photos.galleryId, galleryId)))
    .orderBy(desc(comments.createdAt));
  return {
    likedPhotos,
    comments: commentRows.map((r) => ({
      id: r.comment.id, body: r.comment.body, createdAt: r.comment.createdAt, photo: r.photo,
    })),
  };
}

export async function clientActivityLog(db: Db, studioId: string, galleryId: string, clientId: string) {
  await getGallery(db, studioId, galleryId);
  const rows = await db.select({
    type: activityEvents.type,
    createdAt: activityEvents.createdAt,
    photoFilename: photos.filename,
  })
    .from(activityEvents)
    .leftJoin(photos, eq(activityEvents.photoId, photos.id))
    .where(and(eq(activityEvents.galleryId, galleryId), eq(activityEvents.clientId, clientId)))
    .orderBy(desc(activityEvents.createdAt))
    .limit(200);
  return rows;
}

export async function selectionUnion(db: Db, studioId: string, galleryId: string, clientIds: string[]): Promise<string[]> {
  await getGallery(db, studioId, galleryId);
  if (clientIds.length === 0) return [];
  const rows = await db.selectDistinct({ photoId: likes.photoId }).from(likes)
    .innerJoin(photos, eq(likes.photoId, photos.id))
    .where(and(inArray(likes.clientId, clientIds), eq(photos.galleryId, galleryId)));
  return rows.map((r) => r.photoId);
}

const nameSchema = z.string().trim().min(1).max(100);

export async function createSectionFromSelection(
  db: Db, studioId: string, galleryId: string, clientIds: string[], name: string, hideOthers: boolean,
): Promise<{ sectionId: string; movedCount: number }> {
  const sectionName = nameSchema.parse(name);
  const photoIds = await selectionUnion(db, studioId, galleryId, clientIds);
  if (photoIds.length === 0) throw new Error("EMPTY_SELECTION");

  const section = await createSection(db, studioId, galleryId, sectionName);
  await movePhotos(db, studioId, galleryId, photoIds, section.id);
  if (hideOthers) {
    const all = await listSections(db, studioId, galleryId);
    for (const s of all) {
      if (s.id !== section.id && s.visible) await setSectionVisible(db, studioId, s.id, false);
    }
  }
  return { sectionId: section.id, movedCount: photoIds.length };
}
```

- [ ] **Step 4: GREEN** — `npx vitest run tests/server/activity.test.ts && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/activity.ts tests/server/activity.test.ts
git commit -m "feat: add admin activity domain (client engagement, log, section-from-selection)"
```

---

### Task 7: Módulo de emails (Resend, no-op sin key)

**Files:**
- Create: `src/server/emails.ts`
- Test: `tests/server/emails.test.ts`

**Interfaces:**
- Produces (Tasks 8/9 consumen):
  - `notifyPhotographer(input: { to: string | null; subject: string; text: string }): Promise<void>` — si falta `RESEND_API_KEY` o `to` es null: log y return (nunca lanza). Con key: `new Resend(key).emails.send({ from: process.env.RESEND_FROM ?? "onboarding@resend.dev", to, subject, text })`, errores capturados con `console.error`.
  - `firstAccessEmail(galleryTitle: string, clientEmail: string): { subject: string; text: string }` y `commentEmail(galleryTitle: string, clientEmail: string, commentBody: string, photoFilename: string): { subject: string; text: string }` — builders puros (testeables sin red), copy en español.

- [ ] **Step 1: Tests failing** — `tests/server/emails.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { notifyPhotographer, firstAccessEmail, commentEmail } from "@/server/emails";

describe("emails", () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; });

  it("builds first-access and comment payloads", () => {
    const a = firstAccessEmail("Boda Ana", "ana@x.com");
    expect(a.subject).toContain("Boda Ana");
    expect(a.text).toContain("ana@x.com");
    const c = commentEmail("Boda Ana", "ana@x.com", "Preciosa!", "IMG_1.jpg");
    expect(c.text).toContain("Preciosa!");
    expect(c.text).toContain("IMG_1.jpg");
  });

  it("is a silent no-op without API key or recipient", async () => {
    await expect(notifyPhotographer({ to: "x@y.com", subject: "s", text: "t" })).resolves.toBeUndefined();
    process.env.RESEND_API_KEY = "re_fake";
    await expect(notifyPhotographer({ to: null, subject: "s", text: "t" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: RED** → FAIL módulo inexistente.

- [ ] **Step 3: Implementar** — `src/server/emails.ts`:

```ts
import { Resend } from "resend";

export function firstAccessEmail(galleryTitle: string, clientEmail: string) {
  return {
    subject: `Nuevo acceso a "${galleryTitle}"`,
    text: `${clientEmail} entró por primera vez a la galería "${galleryTitle}".`,
  };
}

export function commentEmail(galleryTitle: string, clientEmail: string, commentBody: string, photoFilename: string) {
  return {
    subject: `Nuevo comentario en "${galleryTitle}"`,
    text: `${clientEmail} comentó la foto ${photoFilename} de "${galleryTitle}":\n\n"${commentBody}"`,
  };
}

export async function notifyPhotographer(input: { to: string | null; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !input.to) {
    console.log("email skipped (sin RESEND_API_KEY o destinatario):", input.subject);
    return;
  }
  try {
    await new Resend(key).emails.send({
      from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  } catch (e) {
    console.error("email send failed:", input.subject, e);
  }
}
```

- [ ] **Step 4: GREEN + commit**

```bash
npx vitest run tests/server/emails.test.ts && npm test
git add src/server/emails.ts tests/server/emails.test.ts
git commit -m "feat: add Resend email module with silent no-op fallback"
```

---

### Task 8: Página pública `/g/[slug]` — acceso y sesión

**Files:**
- Create: `src/server/client-auth.ts`
- Create: `src/app/g/[slug]/page.tsx`
- Create: `src/app/g/[slug]/actions.ts`
- Create: `src/app/g/[slug]/access-form.tsx`
- Modify: `messages/es.json`, `messages/en.json` (namespace `clientGallery`)

**Interfaces:**
- Consumes: Tasks 2/3/4/7; `studios` schema (para email del fotógrafo).
- Produces (Task 9 consume):
  - `requireClientSession(slug: string): Promise<{ gallery: Gallery; clientId: string }>` en `@/server/client-auth` — lee cookie, verifica JWT, carga galería published por slug, exige `payload.galleryId === gallery.id`; lanza `Error("UNAUTHORIZED")`.
  - `getOptionalClientSession(slug: string)` — igual pero devuelve null en vez de lanzar.
  - Server action `enterGalleryAction(slug: string, formData: FormData)` — rate limit, accessGallery, set cookie, email de primer acceso, redirect a `/g/${slug}`.

- [ ] **Step 1: client-auth** — `src/server/client-auth.ts`:

```ts
import { cookies } from "next/headers";
import { db } from "@/db";
import type { Gallery } from "@/db/schema";
import { CLIENT_COOKIE, verifyClientSession } from "./client-session";
import { getPublicGallery } from "./client-access";

export async function getOptionalClientSession(
  slug: string,
): Promise<{ gallery: Gallery; clientId: string } | null> {
  const gallery = await getPublicGallery(db, slug); // NOT_FOUND si no publicada
  const token = (await cookies()).get(CLIENT_COOKIE)?.value;
  if (!token) return null;
  const session = await verifyClientSession(token);
  if (!session || session.galleryId !== gallery.id) return null;
  return { gallery, clientId: session.clientId };
}

export async function requireClientSession(slug: string): Promise<{ gallery: Gallery; clientId: string }> {
  const session = await getOptionalClientSession(slug);
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
```

- [ ] **Step 2: Mensajes** — agregar namespace raíz `clientGallery` a `messages/es.json`:

```json
{
  "clientGallery": {
    "welcome": "Bienvenido a la galería",
    "emailLabel": "Tu email",
    "nameLabel": "Tu nombre (opcional)",
    "passwordLabel": "Contraseña de la galería",
    "enter": "Entrar",
    "invalidPassword": "Contraseña incorrecta.",
    "tooManyAttempts": "Demasiados intentos. Espera unos minutos.",
    "genericError": "No se pudo entrar. Revisa los datos.",
    "notFoundTitle": "Galería no disponible",
    "like": "Me gusta",
    "unlike": "Quitar me gusta",
    "comments": "Comentarios",
    "commentPlaceholder": "Escribe un comentario…",
    "send": "Enviar",
    "empty": "Esta galería aún no tiene fotos.",
    "yourActivity": "Solo tú y el fotógrafo ven tus me gusta y comentarios."
  }
}
```

Y su equivalente en inglés en `messages/en.json`:

```json
{
  "clientGallery": {
    "welcome": "Welcome to the gallery",
    "emailLabel": "Your email",
    "nameLabel": "Your name (optional)",
    "passwordLabel": "Gallery password",
    "enter": "Enter",
    "invalidPassword": "Wrong password.",
    "tooManyAttempts": "Too many attempts. Wait a few minutes.",
    "genericError": "Could not enter. Check your details.",
    "notFoundTitle": "Gallery unavailable",
    "like": "Like",
    "unlike": "Remove like",
    "comments": "Comments",
    "commentPlaceholder": "Write a comment…",
    "send": "Send",
    "empty": "This gallery has no photos yet.",
    "yourActivity": "Only you and the photographer can see your likes and comments."
  }
}
```

- [ ] **Step 3: Action de entrada** — `src/app/g/[slug]/actions.ts`:

```ts
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studios } from "@/db/schema";
import { accessGallery } from "@/server/client-access";
import { signClientSession, clientCookieOptions, CLIENT_COOKIE } from "@/server/client-session";
import { checkRateLimit } from "@/server/rate-limit";
import { notifyPhotographer, firstAccessEmail } from "@/server/emails";

export type EnterState = { error: "invalidPassword" | "tooManyAttempts" | "genericError" } | null;

export async function enterGalleryAction(
  slug: string, _prev: EnterState, formData: FormData,
): Promise<EnterState> {
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!checkRateLimit(`${ip}:${slug}`)) return { error: "tooManyAttempts" };

  let result;
  try {
    result = await accessGallery(db, slug, {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
      password: String(formData.get("password") ?? "") || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "INVALID_PASSWORD" || msg === "PASSWORD_REQUIRED") return { error: "invalidPassword" };
    return { error: "genericError" };
  }

  const token = await signClientSession({ clientId: result.clientId, galleryId: result.gallery.id });
  (await cookies()).set(CLIENT_COOKIE, token, clientCookieOptions(slug));

  if (result.firstAccess) {
    const [studio] = await db.select().from(studios).where(eq(studios.id, result.gallery.studioId));
    const email = String(formData.get("email") ?? "");
    const payload = firstAccessEmail(result.gallery.title, email.toLowerCase().trim());
    void notifyPhotographer({ to: studio?.notificationEmail ?? null, ...payload }).catch(() => {});
  }

  redirect(`/g/${slug}`);
}
```

- [ ] **Step 4: Form de acceso** — `src/app/g/[slug]/access-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { enterGalleryAction, type EnterState } from "./actions";

type Labels = {
  welcome: string; emailLabel: string; nameLabel: string; passwordLabel: string;
  enter: string; invalidPassword: string; tooManyAttempts: string; genericError: string;
};

export function AccessForm({
  slug, galleryTitle, hasPassword, labels,
}: {
  slug: string; galleryTitle: string; hasPassword: boolean; labels: Labels;
}) {
  const action = enterGalleryAction.bind(null, slug);
  const [state, formAction, pending] = useActionState<EnterState, FormData>(action, null);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow">
        <p className="text-sm text-neutral-500">{labels.welcome}</p>
        <h1 className="text-2xl font-semibold">{galleryTitle}</h1>
        <input
          name="email" type="email" required placeholder={labels.emailLabel}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          name="name" placeholder={labels.nameLabel}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {hasPassword && (
          <input
            name="password" type="password" required placeholder={labels.passwordLabel}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        )}
        {state?.error && (
          <p className="text-sm text-red-600">{labels[state.error]}</p>
        )}
        <button disabled={pending} className="w-full rounded bg-neutral-900 py-2 text-sm text-white disabled:opacity-50">
          {labels.enter}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Página (solo acceso por ahora)** — `src/app/g/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalClientSession } from "@/server/client-auth";
import { AccessForm } from "./access-form";

export default async function ClientGalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations("clientGallery");

  let session;
  try {
    session = await getOptionalClientSession(slug);
  } catch {
    notFound();
  }

  if (!session) {
    const { getPublicGallery } = await import("@/server/client-access");
    const { db } = await import("@/db");
    const gallery = await getPublicGallery(db, slug).catch(() => null);
    if (!gallery) notFound();
    return (
      <AccessForm
        slug={slug}
        galleryTitle={gallery.title}
        hasPassword={gallery.passwordHash !== null}
        labels={{
          welcome: t("welcome"), emailLabel: t("emailLabel"), nameLabel: t("nameLabel"),
          passwordLabel: t("passwordLabel"), enter: t("enter"),
          invalidPassword: t("invalidPassword"), tooManyAttempts: t("tooManyAttempts"),
          genericError: t("genericError"),
        }}
      />
    );
  }

  // Task 9 reemplaza este placeholder por la galería completa
  return <main className="p-8">{session.gallery.title}</main>;
}
```

Nota: agregar `CLIENT_SESSION_SECRET` real a `.env.local` es prerrequisito de la verificación manual (el runner lo genera con `openssl rand -hex 32` y lo escribe él mismo con `>>` sin imprimir el resto del archivo).

- [ ] **Step 6: Verificar**

```bash
npm run build && npm test && npx tsc --noEmit
```

Manual (si hay `.env.local` completo): `npm run dev`; visitar una galería publicada en `/g/<slug>` en ventana incógnita → form de email (+contraseña si tiene); entrar → placeholder con el título; galería draft → 404.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add public gallery access page with client session"
```

---

### Task 9: Vista de galería del cliente (fotos, likes, comentarios)

**Files:**
- Create: `src/app/g/[slug]/client-gallery.tsx`
- Modify: `src/app/g/[slug]/page.tsx` (reemplazar placeholder)
- Modify: `src/app/g/[slug]/actions.ts` (agregar toggleLikeAction y addCommentAction)

**Interfaces:**
- Consumes: `requireClientSession` (Task 8), `getClientGalleryData` (Task 4), `toggleLike`/`addComment` (Task 5), `presignDownload` (F2), `commentEmail`/`notifyPhotographer` (Task 7).
- Produces: server actions `toggleLikeAction(input: { slug: string; photoId: string }): Promise<{ liked: boolean }>` y `addCommentAction(input: { slug: string; photoId: string; body: string }): Promise<{ id: string; body: string }>` — ambas via `requireClientSession(slug)` y galleryId del token.

- [ ] **Step 1: Actions** — agregar a `src/app/g/[slug]/actions.ts`:

```ts
import { z } from "zod";
import { requireClientSession } from "@/server/client-auth";
import { toggleLike, addComment } from "@/server/engagement";
import { photos } from "@/db/schema";

const likeInput = z.object({ slug: z.string().min(1), photoId: z.string().uuid() });

export async function toggleLikeAction(input: { slug: string; photoId: string }) {
  const data = likeInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);
  return toggleLike(db, clientId, gallery.id, data.photoId);
}

const commentInput = likeInput.extend({ body: z.string().trim().min(1).max(1000) });

export async function addCommentAction(input: { slug: string; photoId: string; body: string }) {
  const data = commentInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);
  const comment = await addComment(db, clientId, gallery.id, data.photoId, data.body);

  const [studio] = await db.select().from(studios).where(eq(studios.id, gallery.studioId));
  const [photo] = await db.select({ filename: photos.filename }).from(photos).where(eq(photos.id, data.photoId));
  const { commentEmail } = await import("@/server/emails");
  const clientRow = await db.query; // (no) — ver nota
  void notifyPhotographer({
    to: studio?.notificationEmail ?? null,
    ...commentEmail(gallery.title, clientId, comment.body, photo?.filename ?? ""),
  }).catch(() => {});

  return { id: comment.id, body: comment.body };
}
```

Nota de implementación: la línea `const clientRow = await db.query;` del borrador anterior es un ERROR intencionalmente señalado — NO transcribirla. Para el email usar el email real del cliente: `const [clientRow] = await db.select({ email: clients.email }).from(clients).where(eq(clients.id, clientId));` (importar `clients` de `@/db/schema`) y pasar `clientRow?.email ?? "cliente"` a `commentEmail` en lugar de `clientId`.

- [ ] **Step 2: Componente de galería** — `src/app/g/[slug]/client-gallery.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toggleLikeAction, addCommentAction } from "./actions";

export type ClientPhoto = {
  id: string;
  filename: string;
  sectionId: string | null;
  thumbUrl: string;
  webUrl: string;
  liked: boolean;
  comments: { id: string; body: string }[];
};

type Labels = {
  like: string; unlike: string; comments: string; commentPlaceholder: string;
  send: string; empty: string; yourActivity: string;
};

export function ClientGallery({
  slug, title, theme, coverUrl, coverFocalX, coverFocalY,
  sections, photos: initialPhotos, labels,
}: {
  slug: string; title: string; theme: "light" | "dark";
  coverUrl: string | null; coverFocalX: number; coverFocalY: number;
  sections: { id: string | null; name: string | null }[];
  photos: ClientPhoto[]; labels: Labels;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [openPhoto, setOpenPhoto] = useState<ClientPhoto | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const dark = theme === "dark";
  const bg = dark ? "bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900";

  async function onToggleLike(photo: ClientPhoto) {
    const { liked } = await toggleLikeAction({ slug, photoId: photo.id });
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, liked } : p)));
    setOpenPhoto((prev) => (prev && prev.id === photo.id ? { ...prev, liked } : prev));
  }

  async function onComment(photo: ClientPhoto) {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addCommentAction({ slug, photoId: photo.id, body: draft });
      const update = (p: ClientPhoto) =>
        p.id === photo.id ? { ...p, comments: [...p.comments, { id: c.id, body: c.body }] } : p;
      setPhotos((prev) => prev.map(update));
      setOpenPhoto((prev) => (prev ? update(prev) : prev));
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  const bySection = sections
    .map((s) => ({ ...s, photos: photos.filter((p) => p.sectionId === s.id) }))
    .filter((s) => s.photos.length > 0);

  return (
    <main className={`min-h-screen ${bg}`}>
      <header className="relative flex h-[45vh] min-h-64 items-end justify-center overflow-hidden">
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl} alt="" draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: `${coverFocalX * 100}% ${coverFocalY * 100}%` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <h1 className="relative pb-10 font-serif text-4xl text-white drop-shadow">{title}</h1>
      </header>

      <p className="mx-auto max-w-5xl px-4 pt-4 text-xs opacity-60">{labels.yourActivity}</p>

      {photos.length === 0 && <p className="p-10 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="mx-auto max-w-5xl space-y-10 p-4">
        {bySection.map((s) => (
          <section key={s.id ?? "none"}>
            {s.name && <h2 className="mb-3 font-serif text-2xl">{s.name}</h2>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {s.photos.map((p) => (
                <figure key={p.id} className="group relative cursor-pointer" onClick={() => setOpenPhoto(p)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={p.filename} draggable={false}
                    className="aspect-square w-full rounded object-cover" />
                  <button
                    aria-label={p.liked ? labels.unlike : labels.like}
                    onClick={(e) => { e.stopPropagation(); void onToggleLike(p); }}
                    className={`absolute right-2 top-2 rounded-full px-2 py-1 text-sm backdrop-blur ${
                      p.liked ? "bg-red-500 text-white" : "bg-black/40 text-white opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    ♥
                  </button>
                  {p.comments.length > 0 && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 text-xs text-white">
                      💬 {p.comments.length}
                    </span>
                  )}
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>

      {openPhoto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 md:flex-row" onClick={() => setOpenPhoto(null)}>
          <div className="flex flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openPhoto.webUrl} alt={openPhoto.filename}
              className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
          <aside
            className="w-full space-y-3 bg-white p-4 text-neutral-900 md:h-full md:w-80 md:overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => void onToggleLike(openPhoto)}
              className={`rounded px-3 py-1.5 text-sm ${openPhoto.liked ? "bg-red-500 text-white" : "border"}`}
            >
              ♥ {openPhoto.liked ? labels.unlike : labels.like}
            </button>
            <h3 className="text-sm font-medium">{labels.comments}</h3>
            <ul className="space-y-2 text-sm">
              {openPhoto.comments.map((c) => (
                <li key={c.id} className="rounded bg-neutral-100 p-2">{c.body}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder={labels.commentPlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter") void onComment(openPhoto); }}
                className="flex-1 rounded border px-2 py-1.5 text-sm"
              />
              <button disabled={busy} onClick={() => void onComment(openPhoto)}
                className="rounded bg-neutral-900 px-3 text-sm text-white disabled:opacity-50">
                {labels.send}
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Página completa** — en `src/app/g/[slug]/page.tsx`, reemplazar el placeholder del final por:

```tsx
  const data = await getClientGalleryData(db, session.gallery.id, session.clientId);
  const photoViews = await Promise.all(
    data.photos.map(async (p) => ({
      id: p.id,
      filename: p.filename,
      sectionId: p.sectionId,
      thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : "",
      webUrl: p.webKey ? await presignDownload(p.webKey) : "",
      liked: data.likedPhotoIds.includes(p.id),
      comments: (data.commentsByPhoto[p.id] ?? []).map((c) => ({ id: c.id, body: c.body })),
    })),
  );
  const cover = data.photos.find((p) => p.id === data.gallery.coverPhotoId);
  const coverUrl = cover?.webKey ? await presignDownload(cover.webKey) : null;
  const sectionBlocks: { id: string | null; name: string | null }[] = [
    { id: null, name: null },
    ...data.sections.map((s) => ({ id: s.id, name: s.name })),
  ];

  return (
    <ClientGallery
      slug={slug}
      title={data.gallery.title}
      theme={data.gallery.theme}
      coverUrl={coverUrl}
      coverFocalX={data.gallery.coverFocalX}
      coverFocalY={data.gallery.coverFocalY}
      sections={sectionBlocks}
      photos={photoViews.filter((p) => p.thumbUrl && p.webUrl)}
      labels={{
        like: t("like"), unlike: t("unlike"), comments: t("comments"),
        commentPlaceholder: t("commentPlaceholder"), send: t("send"),
        empty: t("empty"), yourActivity: t("yourActivity"),
      }}
    />
  );
```

con los imports estáticos correspondientes al tope del archivo (`getClientGalleryData` de `@/server/client-access`, `db` de `@/db`, `presignDownload` de `@/server/storage`, `ClientGallery` de `./client-gallery`) — y eliminar los `await import(...)` dinámicos del Step 5 de Task 8, dejando imports estáticos.

- [ ] **Step 4: Verificar**

```bash
npm run build && npm test && npx tsc --noEmit && npx eslint src tests
```

Manual: entrar como cliente, dar like (corazón queda rojo, persiste al recargar), comentar desde el lightbox, verificar en otra ventana incógnita con OTRO email que no se ven los likes/comentarios del primero.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add client gallery view with likes and comments"
```

---

### Task 10: Pestaña Actividad del admin

**Files:**
- Create: `src/app/admin/galleries/[id]/activity/page.tsx`
- Create: `src/app/admin/galleries/[id]/activity/actions.ts`
- Create: `src/app/admin/galleries/[id]/activity/selection-form.tsx`
- Modify: `src/app/admin/galleries/[id]/page.tsx` (link a la pestaña)
- Modify: `messages/es.json`, `messages/en.json` (namespace `activity`)

**Interfaces:**
- Consumes: Task 6 completo, `requireStudio`, `getGallery`, `presignDownload`.
- Produces: página `/admin/galleries/[id]/activity` con lista de clientes, detalle (`?client=`), log y formulario de sección desde selección.

- [ ] **Step 1: Mensajes** — namespace raíz `activity` en `messages/es.json`:

```json
{
  "activity": {
    "title": "Actividad",
    "backToGallery": "Volante a la galería",
    "clients": "Clientes",
    "noClients": "Aún nadie ha entrado a esta galería.",
    "lastSeen": "Último acceso",
    "likes": "Me gusta",
    "comments": "Comentarios",
    "log": "Movimientos",
    "event": { "access": "Entró a la galería", "like_added": "Marcó favorita", "like_removed": "Quitó favorita", "comment": "Comentó", "download_photo": "Descargó foto", "download_zip": "Descargó ZIP" },
    "favoritesOf": "Favoritas de",
    "commentsOf": "Comentarios de",
    "createSection": "Crear sección con la selección",
    "sectionName": "Nombre de la nueva sección",
    "selectClients": "Clientes a combinar (unión sin duplicados)",
    "hideOthers": "Ocultar las demás secciones y dejar visible solo esta",
    "create": "Crear sección",
    "created": "Sección creada con {count} fotos.",
    "emptySelection": "Los clientes elegidos no tienen favoritas en esta galería."
  }
}
```

En `messages/en.json` (mismas claves): "Activity", "Back to gallery", "Clients", "No one has entered this gallery yet.", "Last access", "Likes", "Comments", "Activity log", eventos ("Entered the gallery", "Liked a photo", "Removed a like", "Commented", "Downloaded photo", "Downloaded ZIP"), "Favorites of", "Comments of", "Create section from selection", "New section name", "Clients to combine (deduplicated union)", "Hide all other sections and leave only this one visible", "Create section", "Section created with {count} photos.", "The selected clients have no favorites in this gallery."

CORRECCIÓN sobre el JSON anterior: la clave `backToGallery` en español debe ser "Volver a la galería" (no "Volante") — usar el texto correcto.

- [ ] **Step 2: Actions** — `src/app/admin/galleries/[id]/activity/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { createSectionFromSelection } from "@/server/activity";

const schema = z.object({
  galleryId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).min(1),
  name: z.string().trim().min(1).max(100),
  hideOthers: z.boolean(),
});

export type SelectionState = { error: "emptySelection" } | { created: number } | null;

export async function createSectionFromSelectionAction(
  _prev: SelectionState, formData: FormData,
): Promise<SelectionState> {
  const studio = await requireStudio();
  const data = schema.parse({
    galleryId: formData.get("galleryId"),
    clientIds: formData.getAll("clientIds").map(String),
    name: formData.get("name"),
    hideOthers: formData.get("hideOthers") === "on",
  });
  try {
    const { movedCount } = await createSectionFromSelection(
      db, studio.id, data.galleryId, data.clientIds, data.name, data.hideOthers,
    );
    revalidatePath(`/admin/galleries/${data.galleryId}`);
    revalidatePath(`/admin/galleries/${data.galleryId}/activity`);
    return { created: movedCount };
  } catch (e) {
    if (e instanceof Error && e.message === "EMPTY_SELECTION") return { error: "emptySelection" };
    throw e;
  }
}
```

- [ ] **Step 3: Form cliente** — `src/app/admin/galleries/[id]/activity/selection-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createSectionFromSelectionAction, type SelectionState } from "./actions";

type Labels = {
  createSection: string; sectionName: string; selectClients: string;
  hideOthers: string; create: string; created: string; emptySelection: string;
};

export function SelectionForm({
  galleryId, clients, labels,
}: {
  galleryId: string;
  clients: { clientId: string; email: string }[];
  labels: Labels;
}) {
  const [state, formAction, pending] = useActionState<SelectionState, FormData>(
    createSectionFromSelectionAction, null,
  );

  return (
    <form action={formAction} className="space-y-3 rounded border bg-white p-4 text-sm">
      <h2 className="font-medium">{labels.createSection}</h2>
      <input type="hidden" name="galleryId" value={galleryId} />
      <p className="text-neutral-600">{labels.selectClients}</p>
      <div className="flex flex-wrap gap-3">
        {clients.map((c) => (
          <label key={c.clientId} className="flex items-center gap-1.5">
            <input type="checkbox" name="clientIds" value={c.clientId} className="h-4 w-4 accent-neutral-900" />
            {c.email}
          </label>
        ))}
      </div>
      <input name="name" required placeholder={labels.sectionName} className="w-64 rounded border px-3 py-1.5" />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="hideOthers" className="h-4 w-4 accent-neutral-900" />
        {labels.hideOthers}
      </label>
      {state && "created" in state && (
        <p className="text-green-700">{labels.created.replace("{count}", String(state.created))}</p>
      )}
      {state && "error" in state && <p className="text-red-600">{labels.emptySelection}</p>}
      <button disabled={pending} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">
        {labels.create}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Página** — `src/app/admin/galleries/[id]/activity/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getGallery } from "@/server/galleries";
import {
  listGalleryClients, clientEngagementDetail, clientActivityLog,
} from "@/server/activity";
import { presignDownload } from "@/server/storage";
import { SelectionForm } from "./selection-form";

export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const [{ id }, { client: selectedClient }] = await Promise.all([params, searchParams]);
  const studio = await requireStudio();
  const t = await getTranslations("activity");

  const gallery = await getGallery(db, studio.id, id).catch(() => null);
  if (!gallery) notFound();
  const clientRows = await listGalleryClients(db, studio.id, id);

  const detail = selectedClient
    ? await clientEngagementDetail(db, studio.id, id, selectedClient).catch(() => null)
    : null;
  const log = selectedClient
    ? await clientActivityLog(db, studio.id, id, selectedClient).catch(() => [])
    : [];
  const likedThumbs = detail
    ? await Promise.all(detail.likedPhotos.map(async (p) => ({
        id: p.id, filename: p.filename,
        thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : null,
      })))
    : [];
  const selected = clientRows.find((c) => c.clientId === selectedClient);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")} · {gallery.title}</h1>
        <Link href={`/admin/galleries/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← {t("backToGallery")}
        </Link>
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-medium">{t("clients")}</h2>
        {clientRows.length === 0 && <p className="text-sm text-neutral-500">{t("noClients")}</p>}
        <ul className="divide-y text-sm">
          {clientRows.map((c) => (
            <li key={c.clientId} className="flex items-center justify-between py-2">
              <Link
                href={`/admin/galleries/${id}/activity?client=${c.clientId}`}
                className={`hover:underline ${c.clientId === selectedClient ? "font-semibold" : ""}`}
              >
                {c.email}{c.name ? ` (${c.name})` : ""}
              </Link>
              <span className="text-xs text-neutral-500">
                ♥ {c.likeCount} · 💬 {c.commentCount} · {t("lastSeen")}:{" "}
                {c.lastSeenAt ? c.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {clientRows.length > 0 && (
        <SelectionForm
          galleryId={id}
          clients={clientRows.map((c) => ({ clientId: c.clientId, email: c.email }))}
          labels={{
            createSection: t("createSection"), sectionName: t("sectionName"),
            selectClients: t("selectClients"), hideOthers: t("hideOthers"),
            create: t("create"), created: t.raw("created") as string,
            emptySelection: t("emptySelection"),
          }}
        />
      )}

      {detail && selected && (
        <>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("favoritesOf")} {selected.email}</h2>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {likedThumbs.map((p) => p.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.thumbUrl} alt={p.filename} className="aspect-square w-full rounded object-cover" />
              ))}
            </div>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("commentsOf")} {selected.email}</h2>
            <ul className="space-y-2 text-sm">
              {detail.comments.map((c) => (
                <li key={c.id} className="rounded bg-neutral-50 p-2">
                  <span className="text-xs text-neutral-500">{c.photo.filename}: </span>{c.body}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("log")}</h2>
            <ul className="space-y-1 text-sm">
              {log.map((e, i) => (
                <li key={i} className="flex justify-between">
                  <span>{t(`event.${e.type}`)}{e.photoFilename ? ` · ${e.photoFilename}` : ""}</span>
                  <span className="text-xs text-neutral-500">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Link desde el detalle** — en `src/app/admin/galleries/[id]/page.tsx`, junto al enlace `/g/{slug}` del encabezado, agregar (usando el import existente de `Link` o agregándolo):

```tsx
<Link href={`/admin/galleries/${gallery.id}/activity`} className="text-sm text-neutral-500 hover:underline">
  {tActivity("title")} →
</Link>
```

con `const tActivity = await getTranslations("activity");` junto a las demás traducciones.

- [ ] **Step 6: Verificar**

```bash
npm run build && npm test && npx tsc --noEmit && npx eslint src tests
```

Manual: con actividad de la Task 9, abrir Actividad → clientes listados con contadores; clic en cliente → favoritas/comentarios/log; crear sección combinada de 2 clientes con "ocultar demás" → en el detalle aparece la sección nueva con las fotos movidas y las otras ocultas.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add admin activity tab with client engagement and section-from-selection"
```

---

### Task 11: Verificación final de la fase

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Gate completo**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
```

Expected: todo verde, cero warnings.

- [ ] **Step 2: README** — en la sección de variables/desarrollo, agregar:

```markdown
## Acceso de clientes

- Galerías publicadas se comparten en `/g/<slug>`; el cliente deja su email (y contraseña si la galería tiene).
- `CLIENT_SESSION_SECRET` (obligatoria): `openssl rand -hex 32`.
- `RESEND_API_KEY` + `RESEND_FROM` (opcionales): emails de actividad al fotógrafo; sin key no se envía nada.
- Marca de agua: las variantes se generan en la Fase 4 — hasta entonces la vista cliente sirve la versión web limpia.
```

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: document client access and phase 3 env vars"
```

---

## Self-Review (ya aplicado)

- **Cobertura spec fase 3:** enlace + contraseña opcional/desactivable + email siempre ✓; sesión JWT cookie HttpOnly alcance 1 galería ✓; secciones visibles / fotos publicadas+ready / draft→404 ✓; likes y comentarios privados por cliente ✓; rate limit contraseña ✓; pestaña actividad: favoritas/comentarios por cliente ✓, log curado (access/like/comment, sin ruido) ✓, sección desde selección de uno o varios clientes con unión sin duplicados, fotos MOVIDAS, y opción de ocultar las demás ✓; emails al fotógrafo (primer acceso + comentario) vía Resend con no-op ✓; búsqueda por cliente en lista de galerías queda para cuando haya datos (spec la menciona: se difiere a F5 pulido — anotar en ledger). Watermark en vista → F4 (desviación documentada).
- **Placeholders:** el pseudo-error `const clientRow = await db.query;` de Task 9 está explícitamente marcado como NO-transcribir con la corrección al lado; la clave "Volante" tiene su corrección explícita en el mismo paso.
- **Consistencia de tipos:** firmas de Tasks 4/5/6 coinciden con los usos en 8/9/10; `theme` es `"light" | "dark"` (enum de fase 1); `EnterState`/`SelectionState` definidos donde se consumen.
