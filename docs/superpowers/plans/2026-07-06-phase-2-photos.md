# PhonoManager Fase 2 (Fotos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El fotógrafo puede subir fotos (directo a R2, sin pasar por el servidor), verlas procesadas en un gestor con selección múltiple (mover de sección, publicar/ocultar, eliminar, portada, lightbox) y ver cuánto almacenamiento consume todo.

**Architecture:** Tres módulos de servidor nuevos (`storage` = R2/presign, `images` = sharp, `photos` = dominio tenant-scoped) + dos route handlers (presign de subida, completar procesamiento) + dos componentes cliente (uploader con cola de concurrencia, gestor de fotos con selección). El navegador sube el original a R2 con URL prefirmada; al confirmar, el servidor descarga el original, genera miniatura (400px) y web (2048px), las guarda en R2 y marca la foto `ready`.

**Tech Stack:** Se agrega: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 es S3-compatible), `sharp`, `exif-reader`. Lo demás ya existe (Next 16, Drizzle, Vitest+PGlite, next-intl).

**Spec:** `docs/superpowers/specs/2026-07-05-photo-gallery-delivery-design.md`

**Desviaciones de alcance aprobadas respecto al spec:**
- Variantes con marca de agua NO se generan aquí → Fase 4 (entrega), donde vive toda la lógica de watermark/regeneración.
- Vista de galería del cliente (`/g/[slug]`) → Fase 3, junto con el control de acceso (evita exponer fotos sin protección).
- Badges de favoritas/comentarios en el grid → Fase 3 (aún no hay datos de clientes).

## Global Constraints

- Bucket R2 **privado siempre**: ninguna URL pública; GET prefirmado ≤ 900s, PUT prefirmado ≤ 600s.
- Claves R2 con prefijo tenant: `studios/{studioId}/galleries/{galleryId}/{photoId}/…` — el studioId en la clave viene SIEMPRE de la sesión, nunca del cliente.
- Límite de subida: 100 MB por foto; tipos permitidos exactos: `image/jpeg`, `image/png`, `image/webp`.
- Toda server action y route handler verifica sesión con `requireStudio()` PRIMERO y valida entrada con Zod antes de tocar DB o R2.
- Multi-tenant: toda función de dominio recibe `studioId` y filtra por él (vía join photos→galleries); tests de aislamiento por función mutadora.
- Derivados: miniatura 400px (jpeg q80), web 2048px (jpeg q85), `fit: inside`, sin agrandar; respetar orientación EXIF (`.rotate()`).
- i18n: TODA copy de UI nueva en `messages/es.json` Y `messages/en.json` con estructura de claves idéntica; nada hardcodeado en JSX.
- TypeScript strict; alias `@/*`; TDD para módulos de dominio (storage/images/photos y formatBytes); tests con Vitest (PGlite para DB, sin red: los tests de storage solo verifican la forma de las URLs firmadas).
- `.env.local` contiene secretos reales: NUNCA imprimirlo. Variables nuevas: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (agregar a `.env.example`).
- Commits frecuentes convencionales en inglés.

---

### Task 1: Módulo de storage R2 (cliente S3 + URLs prefirmadas)

**Files:**
- Create: `src/server/storage.ts`
- Modify: `.env.example` (agregar las 4 vars R2)
- Test: `tests/server/storage.test.ts`

**Interfaces:**
- Consumes: nada del código propio.
- Produces (Tasks 4, 6 las consumen):
  - `presignUpload(key: string, contentType: string, expiresIn?: number): Promise<string>` (default 600)
  - `presignDownload(key: string, expiresIn?: number): Promise<string>` (default 900)
  - `getObjectBuffer(key: string): Promise<Buffer>`
  - `putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void>`
  - `deleteObjects(keys: string[]): Promise<void>` (troceo en lotes de 1000)

- [ ] **Step 1: Instalar dependencias de la fase**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp exif-reader
```

Expected: sin errores.

- [ ] **Step 2: Test failing** — `tests/server/storage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "testaccount";
  process.env.R2_ACCESS_KEY_ID = "testkey";
  process.env.R2_SECRET_ACCESS_KEY = "testsecret";
  process.env.R2_BUCKET = "test-bucket";
});

describe("storage presigning (offline)", () => {
  it("creates a signed PUT URL scoped to bucket, key and content type", async () => {
    const { presignUpload } = await import("@/server/storage");
    const url = await presignUpload("studios/a/galleries/b/c/orig-x.jpg", "image/jpeg");
    expect(url).toContain("testaccount.r2.cloudflarestorage.com/test-bucket/studios/a/galleries/b/c/orig-x.jpg");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=600");
  });

  it("creates a signed GET URL with 900s expiry", async () => {
    const { presignDownload } = await import("@/server/storage");
    const url = await presignDownload("k/thumb.jpg");
    expect(url).toContain("/test-bucket/k/thumb.jpg");
    expect(url).toContain("X-Amz-Expires=900");
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `npx vitest run tests/server/storage.test.ts`
Expected: FAIL — `Cannot find module '@/server/storage'` (o "package").

- [ ] **Step 4: Implementar** — `src/server/storage.ts`:

```ts
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

let client: S3Client | null = null;
function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}
const bucket = () => required("R2_BUCKET");

export async function presignUpload(key: string, contentType: string, expiresIn = 600): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function presignDownload(key: string, expiresIn = 900): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error("EMPTY_OBJECT");
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
    }));
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run tests/server/storage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Actualizar `.env.example`** — agregar al final:

```bash
# Cloudflare R2 (S3 API). CORS del bucket debe permitir PUT desde el origen de la app.
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET=phonomanager
```

- [ ] **Step 7: Commit**

```bash
git add src/server/storage.ts tests/server/storage.test.ts .env.example package.json package-lock.json
git commit -m "feat: add R2 storage module with presigned upload/download"
```

---

### Task 2: Módulo de procesamiento de imágenes (sharp)

**Files:**
- Create: `src/server/images.ts`
- Test: `tests/server/images.test.ts`

**Interfaces:**
- Consumes: nada del código propio (solo sharp/exif-reader).
- Produces (Task 4 la consume):
  - `processImage(original: Buffer): Promise<ProcessedImage>` donde `ProcessedImage = { thumb: Buffer; web: Buffer; width: number; height: number; takenAt: Date | null }`. Lanza `Error("INVALID_IMAGE")` si el buffer no es una imagen.

- [ ] **Step 1: Tests failing** — `tests/server/images.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "@/server/images";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } },
  }).jpeg().toBuffer();
}

describe("processImage", () => {
  it("generates 400px thumb and 2048px web derivatives and reports dimensions", async () => {
    const out = await processImage(await makeJpeg(3000, 2000));
    expect(out.width).toBe(3000);
    expect(out.height).toBe(2000);
    const thumb = await sharp(out.thumb).metadata();
    const web = await sharp(out.web).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect(Math.max(web.width!, web.height!)).toBe(2048);
    expect(out.takenAt).toBeNull(); // imagen sintética sin EXIF
  });

  it("never enlarges small images", async () => {
    const out = await processImage(await makeJpeg(300, 200));
    const thumb = await sharp(out.thumb).metadata();
    const web = await sharp(out.web).metadata();
    expect(thumb.width).toBe(300);
    expect(web.width).toBe(300);
  });

  it("rejects non-image buffers", async () => {
    await expect(processImage(Buffer.from("not an image"))).rejects.toThrow("INVALID_IMAGE");
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run tests/server/images.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** — `src/server/images.ts`:

```ts
import sharp from "sharp";
import exifReader from "exif-reader";

export type ProcessedImage = {
  thumb: Buffer;
  web: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
};

const THUMB_SIZE = 400;
const WEB_SIZE = 2048;

export async function processImage(original: Buffer): Promise<ProcessedImage> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");

  const base = sharp(original).rotate(); // aplica orientación EXIF
  const [thumb, web] = await Promise.all([
    base.clone().resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer(),
    base.clone().resize(WEB_SIZE, WEB_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer(),
  ]);

  // dimensiones tal como se ven (orientaciones 5-8 intercambian ejes)
  const swapped = (meta.orientation ?? 1) >= 5;
  return {
    thumb,
    web,
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    takenAt: extractTakenAt(meta.exif),
  };
}

function extractTakenAt(exif?: Buffer): Date | null {
  if (!exif) return null;
  try {
    const parsed = exifReader(exif);
    const d = parsed.Photo?.DateTimeOriginal ?? parsed.Image?.DateTime;
    return d instanceof Date ? d : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run tests/server/images.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/images.ts tests/server/images.test.ts
git commit -m "feat: add sharp image processing (thumb/web derivatives, EXIF date)"
```

---

### Task 3: Dominio de fotos (tenant-scoped)

**Files:**
- Create: `src/server/photos.ts`
- Test: `tests/server/photos.test.ts`

**Interfaces:**
- Consumes: `Db`, schema (`photos`, `galleries`, `sections`, tipo `Photo`), `getGallery` (Task 5 fase 1).
- Produces (Tasks 4, 6, 8 las consumen — firmas exactas):
  - `registerUpload(db: Db, studioId: string, galleryId: string, input: { filename: string; size: number; contentType: string; sectionId?: string | null }): Promise<Photo>` — crea fila `processing` con `originalKey = studios/{studioId}/galleries/{galleryId}/{photoId}/orig-{filenameSaneado}`.
  - `getOwnedPhoto(db: Db, studioId: string, photoId: string): Promise<Photo>` — lanza `Error("NOT_FOUND")`.
  - `completeProcessing(db: Db, studioId: string, photoId: string, result: { width: number; height: number; takenAt: Date | null; thumbKey: string; webKey: string; sizeDerivativesBytes: number }): Promise<Photo>` — marca `ready`.
  - `markPhotoError(db: Db, studioId: string, photoId: string): Promise<void>`
  - `listGalleryPhotos(db: Db, studioId: string, galleryId: string): Promise<Photo[]>` — orden según `gallery.photoOrder` (capture → takenAt asc nulls last; filename → filename asc; manual → position asc).
  - `movePhotos(db: Db, studioId: string, galleryId: string, photoIds: string[], sectionId: string | null): Promise<void>` — `Error("SECTION_NOT_IN_GALLERY")` si la sección no pertenece.
  - `setPhotosPublished(db: Db, studioId: string, galleryId: string, photoIds: string[], published: boolean): Promise<void>`
  - `deletePhotos(db: Db, studioId: string, galleryId: string, photoIds: string[]): Promise<string[]>` — borra filas y devuelve TODAS las claves R2 (orig/thumb/web) para que el caller las borre del bucket.
  - `setCoverPhoto(db: Db, studioId: string, galleryId: string, photoId: string): Promise<void>`
  - `storageTotals(db: Db, studioId: string): Promise<{ totalBytes: number; perGallery: Record<string, number> }>`
  - `sanitizeFilename(name: string): string` (exportada para tests).

- [ ] **Step 1: Tests failing** — `tests/server/photos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings, getGallery } from "@/server/galleries";
import { createSection } from "@/server/sections";
import {
  registerUpload, getOwnedPhoto, completeProcessing, markPhotoError, listGalleryPhotos,
  movePhotos, setPhotosPublished, deletePhotos, setCoverPhoto, storageTotals, sanitizeFilename,
} from "@/server/photos";
import { galleries } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const gallery = await createGallery(db, studio.id, { title: "Boda" });
  return { db, studio, gallery };
}

const upload = (name = "IMG_0001.jpg") => ({
  filename: name, size: 1000, contentType: "image/jpeg", sectionId: null,
});

describe("photos domain", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../..\\raro año ñ%.jpg")).toMatch(/^[\w.\-]+$/);
    expect(sanitizeFilename("")).toBe("foto.jpg");
  });

  it("registers an upload as processing with tenant-prefixed key", async () => {
    const { db, studio, gallery } = await setup();
    const photo = await registerUpload(db, studio.id, gallery.id, upload());
    expect(photo.status).toBe("processing");
    expect(photo.originalKey).toBe(
      `studios/${studio.id}/galleries/${gallery.id}/${photo.id}/orig-IMG_0001.jpg`,
    );
    expect(photo.sizeOriginalBytes).toBe(1000);
  });

  it("rejects bad content types and oversized files", async () => {
    const { db, studio, gallery } = await setup();
    await expect(registerUpload(db, studio.id, gallery.id, { ...upload(), contentType: "video/mp4" }))
      .rejects.toThrow();
    await expect(registerUpload(db, studio.id, gallery.id, { ...upload(), size: 101 * 1024 * 1024 }))
      .rejects.toThrow();
  });

  it("completes processing and marks errors", async () => {
    const { db, studio, gallery } = await setup();
    const p = await registerUpload(db, studio.id, gallery.id, upload());
    const done = await completeProcessing(db, studio.id, p.id, {
      width: 3000, height: 2000, takenAt: new Date("2026-05-01T10:00:00Z"),
      thumbKey: "k/thumb.jpg", webKey: "k/web.jpg", sizeDerivativesBytes: 500,
    });
    expect(done.status).toBe("ready");
    expect(done.width).toBe(3000);

    const p2 = await registerUpload(db, studio.id, gallery.id, upload("b.jpg"));
    await markPhotoError(db, studio.id, p2.id);
    expect((await getOwnedPhoto(db, studio.id, p2.id)).status).toBe("error");
  });

  it("lists photos ordered by gallery photoOrder", async () => {
    const { db, studio, gallery } = await setup();
    const a = await registerUpload(db, studio.id, gallery.id, upload("bbb.jpg"));
    const b = await registerUpload(db, studio.id, gallery.id, upload("aaa.jpg"));
    await completeProcessing(db, studio.id, a.id, {
      width: 1, height: 1, takenAt: new Date("2026-01-02"), thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1,
    });
    await completeProcessing(db, studio.id, b.id, {
      width: 1, height: 1, takenAt: new Date("2026-01-01"), thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1,
    });

    // capture (default): b (01-01) antes que a (01-02)
    expect((await listGalleryPhotos(db, studio.id, gallery.id)).map((p) => p.id)).toEqual([b.id, a.id]);
    // filename: aaa antes que bbb
    await updateGallerySettings(db, studio.id, gallery.id, { photoOrder: "filename" });
    expect((await listGalleryPhotos(db, studio.id, gallery.id)).map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("moves photos between sections, validating section ownership", async () => {
    const { db, studio, gallery } = await setup();
    const section = await createSection(db, studio.id, gallery.id, "Selección");
    const other = await createGallery(db, studio.id, { title: "Otra" });
    const foreign = await createSection(db, studio.id, other.id, "Ajena");
    const p = await registerUpload(db, studio.id, gallery.id, upload());

    await movePhotos(db, studio.id, gallery.id, [p.id], section.id);
    expect((await getOwnedPhoto(db, studio.id, p.id)).sectionId).toBe(section.id);

    await movePhotos(db, studio.id, gallery.id, [p.id], null);
    expect((await getOwnedPhoto(db, studio.id, p.id)).sectionId).toBeNull();

    await expect(movePhotos(db, studio.id, gallery.id, [p.id], foreign.id))
      .rejects.toThrow("SECTION_NOT_IN_GALLERY");
  });

  it("publishes/hides, deletes returning R2 keys, and sets cover", async () => {
    const { db, studio, gallery } = await setup();
    const p = await registerUpload(db, studio.id, gallery.id, upload());
    await completeProcessing(db, studio.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "k/thumb.jpg", webKey: "k/web.jpg", sizeDerivativesBytes: 1,
    });

    await setPhotosPublished(db, studio.id, gallery.id, [p.id], false);
    expect((await getOwnedPhoto(db, studio.id, p.id)).published).toBe(false);

    await setCoverPhoto(db, studio.id, gallery.id, p.id);
    expect((await getGallery(db, studio.id, gallery.id)).coverPhotoId).toBe(p.id);

    const keys = await deletePhotos(db, studio.id, gallery.id, [p.id]);
    expect(keys).toContain(p.originalKey);
    expect(keys).toContain("k/thumb.jpg");
    expect(keys).toContain("k/web.jpg");
    await expect(getOwnedPhoto(db, studio.id, p.id)).rejects.toThrow("NOT_FOUND");
    // FK set null: la portada se limpia sola
    expect((await getGallery(db, studio.id, gallery.id)).coverPhotoId).toBeNull();
  });

  it("computes storage totals per gallery and total", async () => {
    const { db, studio, gallery } = await setup();
    const other = await createGallery(db, studio.id, { title: "Otra" });
    const p1 = await registerUpload(db, studio.id, gallery.id, upload());
    await completeProcessing(db, studio.id, p1.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 200,
    });
    await registerUpload(db, studio.id, other.id, { ...upload("x.jpg"), size: 5000 });

    const totals = await storageTotals(db, studio.id);
    expect(totals.perGallery[gallery.id]).toBe(1200); // 1000 orig + 200 deriv
    expect(totals.perGallery[other.id]).toBe(5000);
    expect(totals.totalBytes).toBe(6200);
  });

  it("is tenant-scoped for every mutator", async () => {
    const { db, studio, gallery } = await setup();
    const intruder = await seedStudio(db, "auth0|intruder");
    const p = await registerUpload(db, studio.id, gallery.id, upload());

    await expect(registerUpload(db, intruder.id, gallery.id, upload())).rejects.toThrow("NOT_FOUND");
    await expect(getOwnedPhoto(db, intruder.id, p.id)).rejects.toThrow("NOT_FOUND");
    await expect(completeProcessing(db, intruder.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1,
    })).rejects.toThrow("NOT_FOUND");
    await expect(movePhotos(db, intruder.id, gallery.id, [p.id], null)).rejects.toThrow("NOT_FOUND");
    await expect(setPhotosPublished(db, intruder.id, gallery.id, [p.id], false)).rejects.toThrow("NOT_FOUND");
    await expect(deletePhotos(db, intruder.id, gallery.id, [p.id])).rejects.toThrow("NOT_FOUND");
    await expect(setCoverPhoto(db, intruder.id, gallery.id, p.id)).rejects.toThrow("NOT_FOUND");
    expect((await storageTotals(db, intruder.id)).totalBytes).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run tests/server/photos.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** — `src/server/photos.ts`:

```ts
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db";
import { galleries, photos, sections, type Photo } from "@/db/schema";
import { getGallery } from "./galleries";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const registerSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sectionId: z.string().uuid().nullable().optional(),
});
export type RegisterUploadInput = z.infer<typeof registerSchema>;

export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_").slice(-100);
  return base && base !== "." && base !== ".." ? base : "foto.jpg";
}

async function assertSectionInGallery(db: Db, galleryId: string, sectionId: string) {
  const [row] = await db.select({ id: sections.id }).from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.galleryId, galleryId)));
  if (!row) throw new Error("SECTION_NOT_IN_GALLERY");
}

export async function registerUpload(
  db: Db, studioId: string, galleryId: string, input: RegisterUploadInput,
): Promise<Photo> {
  const data = registerSchema.parse(input);
  await getGallery(db, studioId, galleryId);
  if (data.sectionId) await assertSectionInGallery(db, galleryId, data.sectionId);

  const id = randomUUID();
  const filename = sanitizeFilename(data.filename);
  const [photo] = await db.insert(photos).values({
    id,
    galleryId,
    sectionId: data.sectionId ?? null,
    filename,
    originalKey: `studios/${studioId}/galleries/${galleryId}/${id}/orig-${filename}`,
    sizeOriginalBytes: data.size,
    status: "processing",
  }).returning();
  return photo;
}

export async function getOwnedPhoto(db: Db, studioId: string, photoId: string): Promise<Photo> {
  const [row] = await db.select({ photo: photos }).from(photos)
    .innerJoin(galleries, eq(photos.galleryId, galleries.id))
    .where(and(eq(photos.id, photoId), eq(galleries.studioId, studioId)));
  if (!row) throw new Error("NOT_FOUND");
  return row.photo;
}

export async function completeProcessing(
  db: Db, studioId: string, photoId: string,
  result: { width: number; height: number; takenAt: Date | null; thumbKey: string; webKey: string; sizeDerivativesBytes: number },
): Promise<Photo> {
  await getOwnedPhoto(db, studioId, photoId);
  const [photo] = await db.update(photos).set({
    status: "ready",
    width: result.width,
    height: result.height,
    takenAt: result.takenAt,
    thumbKey: result.thumbKey,
    webKey: result.webKey,
    sizeDerivativesBytes: result.sizeDerivativesBytes,
  }).where(eq(photos.id, photoId)).returning();
  return photo;
}

export async function markPhotoError(db: Db, studioId: string, photoId: string): Promise<void> {
  await getOwnedPhoto(db, studioId, photoId);
  await db.update(photos).set({ status: "error" }).where(eq(photos.id, photoId));
}

export async function listGalleryPhotos(db: Db, studioId: string, galleryId: string): Promise<Photo[]> {
  const gallery = await getGallery(db, studioId, galleryId);
  const base = db.select().from(photos).where(eq(photos.galleryId, galleryId));
  if (gallery.photoOrder === "manual") {
    return base.orderBy(asc(photos.position), asc(photos.filename));
  }
  if (gallery.photoOrder === "filename") {
    return base.orderBy(asc(photos.filename));
  }
  return base.orderBy(sql`${photos.takenAt} asc nulls last`, asc(photos.filename));
}

const idList = z.array(z.string().uuid()).min(1).max(500);

async function assertPhotosInGallery(db: Db, studioId: string, galleryId: string, photoIds: string[]) {
  await getGallery(db, studioId, galleryId);
  const rows = await db.select({ id: photos.id }).from(photos)
    .where(and(inArray(photos.id, photoIds), eq(photos.galleryId, galleryId)));
  if (rows.length !== new Set(photoIds).size) throw new Error("NOT_FOUND");
}

export async function movePhotos(
  db: Db, studioId: string, galleryId: string, photoIds: string[], sectionId: string | null,
): Promise<void> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  if (sectionId) await assertSectionInGallery(db, galleryId, sectionId);
  await db.update(photos).set({ sectionId })
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)));
}

export async function setPhotosPublished(
  db: Db, studioId: string, galleryId: string, photoIds: string[], published: boolean,
): Promise<void> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  await db.update(photos).set({ published })
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)));
}

export async function deletePhotos(
  db: Db, studioId: string, galleryId: string, photoIds: string[],
): Promise<string[]> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  const rows = await db.delete(photos)
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)))
    .returning({ originalKey: photos.originalKey, thumbKey: photos.thumbKey, webKey: photos.webKey });
  return rows.flatMap((r) => [r.originalKey, r.thumbKey, r.webKey].filter((k): k is string => !!k));
}

export async function setCoverPhoto(db: Db, studioId: string, galleryId: string, photoId: string): Promise<void> {
  await assertPhotosInGallery(db, studioId, galleryId, [photoId]);
  await db.update(galleries).set({ coverPhotoId: photoId, updatedAt: new Date() })
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
}

export async function storageTotals(
  db: Db, studioId: string,
): Promise<{ totalBytes: number; perGallery: Record<string, number> }> {
  const rows = await db.select({
    galleryId: photos.galleryId,
    bytes: sql<number>`coalesce(sum(${photos.sizeOriginalBytes} + ${photos.sizeDerivativesBytes}), 0)::bigint`,
  }).from(photos)
    .innerJoin(galleries, eq(photos.galleryId, galleries.id))
    .where(eq(galleries.studioId, studioId))
    .groupBy(photos.galleryId);

  const perGallery: Record<string, number> = {};
  let totalBytes = 0;
  for (const r of rows) {
    const n = Number(r.bytes);
    perGallery[r.galleryId] = n;
    totalBytes += n;
  }
  return { totalBytes, perGallery };
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run tests/server/photos.test.ts`
Expected: PASS (9 tests). Nota: en el test de orden por `filename`, `aaa.jpg` fue el segundo registro (`b`), por eso el orden esperado sigue siendo `[b.id, a.id]`.

- [ ] **Step 5: Suite completa y commit**

```bash
npm test
git add src/server/photos.ts tests/server/photos.test.ts
git commit -m "feat: add tenant-scoped photos domain (upload lifecycle, batch ops, storage totals)"
```

---

### Task 4: Route handlers de subida y procesamiento

**Files:**
- Create: `src/app/api/galleries/[galleryId]/uploads/route.ts`
- Create: `src/app/api/photos/[photoId]/complete/route.ts`

**Interfaces:**
- Consumes: `requireStudio` (`@/server/auth`); `registerUpload`, `getOwnedPhoto`, `completeProcessing`, `markPhotoError` (`@/server/photos`); `presignUpload`, `getObjectBuffer`, `putObjectBuffer` (`@/server/storage`); `processImage` (`@/server/images`).
- Produces (Task 5 los consume):
  - `POST /api/galleries/{galleryId}/uploads` con JSON `{ filename, size, contentType, sectionId? }` → `200 { photoId, uploadUrl }` | 400 | 401 | 404.
  - `POST /api/photos/{photoId}/complete` sin body → `200 { status: "ready" }` | `422 { status: "error" }` | 401 | 404.

- [ ] **Step 1: Endpoint de presign** — `src/app/api/galleries/[galleryId]/uploads/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { registerUpload } from "@/server/photos";
import { presignUpload } from "@/server/storage";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ galleryId: string }> },
) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { galleryId } = await params;
  if (!z.string().uuid().safeParse(galleryId).success) {
    return NextResponse.json({ error: "invalid_gallery" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const photo = await registerUpload(db, studioId, galleryId, body);
    const uploadUrl = await presignUpload(photo.originalKey, body.contentType);
    return NextResponse.json({ photoId: photo.id, uploadUrl });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    if (e instanceof Error && (e.message === "NOT_FOUND" || e.message === "SECTION_NOT_IN_GALLERY")) {
      return NextResponse.json({ error: e.message.toLowerCase() }, { status: 404 });
    }
    throw e;
  }
}
```

- [ ] **Step 2: Endpoint de procesamiento** — `src/app/api/photos/[photoId]/complete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getOwnedPhoto, completeProcessing, markPhotoError } from "@/server/photos";
import { getObjectBuffer, putObjectBuffer } from "@/server/storage";
import { processImage } from "@/server/images";

export const maxDuration = 60; // fotos grandes: descargar + sharp + subir

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { photoId } = await params;
  if (!z.string().uuid().safeParse(photoId).success) {
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 });
  }

  let photo;
  try {
    photo = await getOwnedPhoto(db, studioId, photoId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (photo.status === "ready") return NextResponse.json({ status: "ready" });

  try {
    const original = await getObjectBuffer(photo.originalKey);
    const processed = await processImage(original);
    const dir = photo.originalKey.split("/").slice(0, -1).join("/");
    const thumbKey = `${dir}/thumb.jpg`;
    const webKey = `${dir}/web.jpg`;
    await Promise.all([
      putObjectBuffer(thumbKey, processed.thumb, "image/jpeg"),
      putObjectBuffer(webKey, processed.web, "image/jpeg"),
    ]);
    await completeProcessing(db, studioId, photoId, {
      width: processed.width,
      height: processed.height,
      takenAt: processed.takenAt,
      thumbKey,
      webKey,
      sizeDerivativesBytes: processed.thumb.length + processed.web.length,
    });
    return NextResponse.json({ status: "ready" });
  } catch {
    await markPhotoError(db, studioId, photoId);
    return NextResponse.json({ status: "error" }, { status: 422 });
  }
}
```

- [ ] **Step 3: Verificar build y suite**

Run: `npm run build && npm test`
Expected: build OK (rutas `/api/...` listadas), tests todos PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api
git commit -m "feat: add upload presign and photo processing endpoints"
```

---

### Task 5: Uploader con drag & drop y cola de concurrencia

**Files:**
- Create: `src/app/admin/galleries/[id]/photo-uploader.tsx`
- Modify: `messages/es.json`, `messages/en.json` (claves nuevas bajo `galleryDetail.upload`)

**Interfaces:**
- Consumes: los dos endpoints de Task 4.
- Produces (Task 6 lo monta en la página): `<PhotoUploader galleryId sections labels />` donde `sections: { id: string; name: string }[]` y `labels: { hint: string; select: string; target: string; noSection: string; done: string; error: string; processing: string; uploading: string }`.

- [ ] **Step 1: Mensajes** — agregar dentro del objeto `galleryDetail` existente en `messages/es.json`:

```json
"upload": {
  "hint": "Arrastra fotos aquí o",
  "select": "elige archivos",
  "target": "Subir a",
  "noSection": "Sin sección",
  "uploading": "Subiendo…",
  "processing": "Procesando…",
  "done": "Lista",
  "error": "Error"
}
```

Y en `messages/en.json`:

```json
"upload": {
  "hint": "Drag photos here or",
  "select": "choose files",
  "target": "Upload to",
  "noSection": "No section",
  "uploading": "Uploading…",
  "processing": "Processing…",
  "done": "Ready",
  "error": "Error"
}
```

- [ ] **Step 2: Componente** — `src/app/admin/galleries/[id]/photo-uploader.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Labels = {
  hint: string; select: string; target: string; noSection: string;
  uploading: string; processing: string; done: string; error: string;
};
type ItemStatus = "pending" | "uploading" | "processing" | "done" | "error";
type Item = { name: string; status: ItemStatus };

export function PhotoUploader({
  galleryId, sections, labels,
}: {
  galleryId: string;
  sections: { id: string; name: string }[];
  labels: Labels;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [sectionId, setSectionId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function uploadOne(file: File, index: number) {
    const set = (status: ItemStatus) =>
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, status } : it)));
    try {
      set("uploading");
      const res = await fetch(`/api/galleries/${galleryId}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type,
          sectionId: sectionId || null,
        }),
      });
      if (!res.ok) throw new Error();
      const { photoId, uploadUrl } = (await res.json()) as { photoId: string; uploadUrl: string };

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error();

      set("processing");
      const done = await fetch(`/api/photos/${photoId}/complete`, { method: "POST" });
      if (!done.ok) throw new Error();
      set("done");
    } catch {
      set("error");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    const list = Array.from(files);
    setItems(list.map((f) => ({ name: f.name, status: "pending" })));
    setBusy(true);
    let next = 0;
    const CONCURRENCY = 3;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
        while (next < list.length) {
          const i = next++;
          await uploadOne(list[i], i);
        }
      }),
    );
    setBusy(false);
    router.refresh();
  }

  const statusLabel: Record<ItemStatus, string> = {
    pending: "…", uploading: labels.uploading, processing: labels.processing,
    done: labels.done, error: labels.error,
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        {labels.target}
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          disabled={busy}
        >
          <option value="">{labels.noSection}</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
        className="rounded border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500"
      >
        {labels.hint}{" "}
        <button type="button" onClick={() => inputRef.current?.click()} className="text-neutral-900 underline" disabled={busy}>
          {labels.select}
        </button>
        <input
          ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
          className="hidden" onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {items.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-neutral-600">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span className="truncate">{it.name}</span>
              <span className={it.status === "error" ? "text-red-600" : ""}>{statusLabel[it.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build** (el componente aún no está montado, debe compilar)

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/galleries/[id]/photo-uploader.tsx messages
git commit -m "feat: add photo uploader with drag-and-drop and concurrency queue"
```

---

### Task 6: Gestor de fotos (grid, selección múltiple, acciones en lote)

**Files:**
- Create: `src/app/admin/galleries/[id]/photo-manager.tsx`
- Modify: `src/app/admin/galleries/[id]/actions.ts` (agregar 4 actions de fotos)
- Modify: `src/app/admin/galleries/[id]/page.tsx` (montar uploader + manager)
- Modify: `messages/es.json`, `messages/en.json` (claves `galleryDetail.photos`)

**Interfaces:**
- Consumes: dominio de fotos (Task 3), `presignDownload` y `deleteObjects` (Task 1), `PhotoUploader` (Task 5), `listSections` (fase 1).
- Produces:
  - Server actions: `movePhotosAction(input: { galleryId: string; photoIds: string[]; sectionId: string | null })`, `setPublishedAction(input: { galleryId: string; photoIds: string[]; published: boolean })`, `deletePhotosAction(input: { galleryId: string; photoIds: string[] })`, `setCoverAction(input: { galleryId: string; photoId: string })`.
  - Tipo `PhotoView = { id: string; filename: string; sectionId: string | null; published: boolean; status: "processing" | "ready" | "error"; thumbUrl: string | null; webUrl: string | null }` exportado desde `photo-manager.tsx`.

- [ ] **Step 1: Mensajes** — agregar dentro de `galleryDetail` en `messages/es.json`:

```json
"photos": {
  "title": "Fotos",
  "empty": "Aún no hay fotos. Sube las primeras arriba.",
  "noSection": "Sin sección",
  "selected": "{count} seleccionadas",
  "moveTo": "Mover a…",
  "move": "Mover",
  "publish": "Publicar",
  "hide": "Ocultar",
  "delete": "Eliminar",
  "deleteConfirm": "¿Eliminar {count} foto(s)? Esta acción no se puede deshacer.",
  "setCover": "Usar de portada",
  "hiddenBadge": "oculta",
  "processingBadge": "procesando",
  "errorBadge": "error",
  "clear": "Quitar selección"
}
```

Y su equivalente en `messages/en.json`:

```json
"photos": {
  "title": "Photos",
  "empty": "No photos yet. Upload the first ones above.",
  "noSection": "No section",
  "selected": "{count} selected",
  "moveTo": "Move to…",
  "move": "Move",
  "publish": "Publish",
  "hide": "Hide",
  "delete": "Delete",
  "deleteConfirm": "Delete {count} photo(s)? This action cannot be undone.",
  "setCover": "Set as cover",
  "hiddenBadge": "hidden",
  "processingBadge": "processing",
  "errorBadge": "error",
  "clear": "Clear selection"
}
```

- [ ] **Step 2: Server actions** — agregar al final de `src/app/admin/galleries/[id]/actions.ts`:

```ts
import {
  movePhotos, setPhotosPublished, deletePhotos, setCoverPhoto,
} from "@/server/photos";
import { deleteObjects } from "@/server/storage";

const photoIds = z.array(z.string().uuid()).min(1).max(500);
const photoBatch = z.object({ galleryId: z.string().uuid(), photoIds });

export async function movePhotosAction(input: { galleryId: string; photoIds: string[]; sectionId: string | null }) {
  const studio = await requireStudio();
  const data = photoBatch.extend({ sectionId: z.string().uuid().nullable() }).parse(input);
  await movePhotos(db, studio.id, data.galleryId, data.photoIds, data.sectionId);
  revalidatePath(`/admin/galleries/${data.galleryId}`);
}

export async function setPublishedAction(input: { galleryId: string; photoIds: string[]; published: boolean }) {
  const studio = await requireStudio();
  const data = photoBatch.extend({ published: z.boolean() }).parse(input);
  await setPhotosPublished(db, studio.id, data.galleryId, data.photoIds, data.published);
  revalidatePath(`/admin/galleries/${data.galleryId}`);
}

export async function deletePhotosAction(input: { galleryId: string; photoIds: string[] }) {
  const studio = await requireStudio();
  const data = photoBatch.parse(input);
  const keys = await deletePhotos(db, studio.id, data.galleryId, data.photoIds);
  await deleteObjects(keys);
  revalidatePath(`/admin/galleries/${data.galleryId}`);
}

export async function setCoverAction(input: { galleryId: string; photoId: string }) {
  const studio = await requireStudio();
  const data = z.object({ galleryId: z.string().uuid(), photoId: z.string().uuid() }).parse(input);
  await setCoverPhoto(db, studio.id, data.galleryId, data.photoId);
  revalidatePath(`/admin/galleries/${data.galleryId}`);
}
```

(Los imports se agregan a los existentes del archivo; `z`, `db`, `requireStudio`, `revalidatePath` ya están importados.)

- [ ] **Step 3: Componente cliente** — `src/app/admin/galleries/[id]/photo-manager.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  movePhotosAction, setPublishedAction, deletePhotosAction, setCoverAction,
} from "./actions";

export type PhotoView = {
  id: string;
  filename: string;
  sectionId: string | null;
  published: boolean;
  status: "processing" | "ready" | "error";
  thumbUrl: string | null;
  webUrl: string | null;
};

type Labels = {
  empty: string; noSection: string; selected: string; moveTo: string; move: string;
  publish: string; hide: string; delete: string; deleteConfirm: string;
  setCover: string; hiddenBadge: string; processingBadge: string; errorBadge: string; clear: string;
};

type Rect = { x: number; y: number; w: number; h: number };

export function PhotoManager({
  galleryId, photos, sections, coverPhotoId, labels,
}: {
  galleryId: string;
  photos: PhotoView[];
  sections: { id: string; name: string }[];
  coverPhotoId: string | null;
  labels: Labels;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<PhotoView | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [band, setBand] = useState<Rect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const router = useRouter();

  const groups = useMemo(() => {
    const bySection = new Map<string | null, PhotoView[]>();
    for (const p of photos) {
      const key = p.sectionId ?? null;
      bySection.set(key, [...(bySection.get(key) ?? []), p]);
    }
    const ordered: { id: string | null; name: string; photos: PhotoView[] }[] = [];
    if (bySection.has(null)) ordered.push({ id: null, name: labels.noSection, photos: bySection.get(null)! });
    for (const s of sections) {
      if (bySection.has(s.id)) ordered.push({ id: s.id, name: s.name, photos: bySection.get(s.id)! });
    }
    return ordered;
  }, [photos, sections, labels.noSection]);

  function toggle(id: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (prev.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selección por arrastre (rubber band) sobre el fondo del contenedor
  function onPointerDown(e: React.PointerEvent) {
    if (e.target !== containerRef.current || e.button !== 0) return;
    const bounds = containerRef.current.getBoundingClientRect();
    dragOrigin.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    containerRef.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragOrigin.current || !containerRef.current) return;
    const bounds = containerRef.current.getBoundingClientRect();
    const cur = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    const rect: Rect = {
      x: Math.min(dragOrigin.current.x, cur.x),
      y: Math.min(dragOrigin.current.y, cur.y),
      w: Math.abs(dragOrigin.current.x - cur.x),
      h: Math.abs(dragOrigin.current.y - cur.y),
    };
    setBand(rect);
    const next = new Set<string>();
    for (const [id, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      const item = { x: r.left - bounds.left, y: r.top - bounds.top, w: r.width, h: r.height };
      const overlaps = item.x < rect.x + rect.w && item.x + item.w > rect.x &&
        item.y < rect.y + rect.h && item.y + item.h > rect.y;
      if (overlaps) next.add(id);
    }
    setSelected(next);
  }
  function onPointerUp() {
    dragOrigin.current = null;
    setBand(null);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    try {
      await action();
      setSelected(new Set());
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const ids = [...selected];
  const single = ids.length === 1 ? ids[0] : null;

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border bg-white p-2 text-sm shadow-sm">
          <span className="font-medium">{labels.selected.replace("{count}", String(selected.size))}</span>
          <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="rounded border px-2 py-1">
            <option value="">{labels.noSection}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => movePhotosAction({ galleryId, photoIds: ids, sectionId: moveTarget || null }))}>
            {labels.move}
          </button>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => setPublishedAction({ galleryId, photoIds: ids, published: true }))}>
            {labels.publish}
          </button>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => setPublishedAction({ galleryId, photoIds: ids, published: false }))}>
            {labels.hide}
          </button>
          {single && (
            <button disabled={pending} className="rounded border px-2 py-1"
              onClick={() => run(() => setCoverAction({ galleryId, photoId: single }))}>
              {labels.setCover}
            </button>
          )}
          <button disabled={pending} className="rounded border px-2 py-1 text-red-600"
            onClick={() => {
              if (confirm(labels.deleteConfirm.replace("{count}", String(selected.size)))) {
                void run(() => deletePhotosAction({ galleryId, photoIds: ids }));
              }
            }}>
            {labels.delete}
          </button>
          <button disabled={pending} className="ml-auto px-2 py-1 text-neutral-500"
            onClick={() => setSelected(new Set())}>
            {labels.clear}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative select-none space-y-6"
      >
        {band && (
          <div className="pointer-events-none absolute z-20 border border-blue-400 bg-blue-200/20"
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
        )}
        {photos.length === 0 && <p className="text-sm text-neutral-500">{labels.empty}</p>}
        {groups.map((group) => (
          <section key={group.id ?? "none"}>
            <h3 className="mb-2 text-sm font-medium text-neutral-600">{group.name}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {group.photos.map((p) => (
                <figure
                  key={p.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(p.id, el);
                    else itemRefs.current.delete(p.id);
                  }}
                  onClick={(e) => toggle(p.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                  onDoubleClick={() => p.webUrl && setLightbox(p)}
                  className={`relative cursor-pointer overflow-hidden rounded border bg-neutral-100 ${
                    selected.has(p.id) ? "ring-2 ring-blue-500" : ""
                  }`}
                >
                  {p.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbUrl} alt={p.filename} className="aspect-square w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs text-neutral-400">
                      {p.status === "error" ? labels.errorBadge : labels.processingBadge}
                    </div>
                  )}
                  <figcaption className="truncate px-1 py-0.5 text-[10px] text-neutral-500">{p.filename}</figcaption>
                  <div className="absolute left-1 top-1 flex gap-1">
                    {coverPhotoId === p.id && <span className="rounded bg-amber-400 px-1 text-[10px]">★</span>}
                    {!p.published && (
                      <span className="rounded bg-neutral-800/80 px-1 text-[10px] text-white">{labels.hiddenBadge}</span>
                    )}
                    {p.status === "error" && (
                      <span className="rounded bg-red-600 px-1 text-[10px] text-white">{labels.errorBadge}</span>
                    )}
                  </div>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.webUrl!} alt={lightbox.filename} className="max-h-full max-w-full object-contain" />
          <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80">{lightbox.filename}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Montar en la página** — en `src/app/admin/galleries/[id]/page.tsx`:

Agregar imports:

```tsx
import { listGalleryPhotos } from "@/server/photos";
import { presignDownload } from "@/server/storage";
import { PhotoUploader } from "./photo-uploader";
import { PhotoManager, type PhotoView } from "./photo-manager";
```

Después de `const sectionList = await listSections(db, studio.id, id);` agregar:

```tsx
  const photoRows = await listGalleryPhotos(db, studio.id, id);
  const photoViews: PhotoView[] = await Promise.all(
    photoRows.map(async (p) => ({
      id: p.id,
      filename: p.filename,
      sectionId: p.sectionId,
      published: p.published,
      status: p.status,
      thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : null,
      webUrl: p.webKey ? await presignDownload(p.webKey) : null,
    })),
  );
  const tp = await getTranslations("galleryDetail.photos");
  const tu = await getTranslations("galleryDetail.upload");
```

Y antes del cierre del `<div className="space-y-10">` (después de la `<section>` de secciones) agregar:

```tsx
      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{tp("title")}</h2>
        <div className="mb-6">
          <PhotoUploader
            galleryId={gallery.id}
            sections={sectionList.map((s) => ({ id: s.id, name: s.name }))}
            labels={{
              hint: tu("hint"), select: tu("select"), target: tu("target"), noSection: tu("noSection"),
              uploading: tu("uploading"), processing: tu("processing"), done: tu("done"), error: tu("error"),
            }}
          />
        </div>
        <PhotoManager
          galleryId={gallery.id}
          photos={photoViews}
          sections={sectionList.map((s) => ({ id: s.id, name: s.name }))}
          coverPhotoId={gallery.coverPhotoId}
          labels={{
            empty: tp("empty"), noSection: tp("noSection"), selected: tp("selected"),
            moveTo: tp("moveTo"), move: tp("move"), publish: tp("publish"), hide: tp("hide"),
            delete: tp("delete"), deleteConfirm: tp("deleteConfirm"), setCover: tp("setCover"),
            hiddenBadge: tp("hiddenBadge"), processingBadge: tp("processingBadge"),
            errorBadge: tp("errorBadge"), clear: tp("clear"),
          }}
        />
      </section>
```

- [ ] **Step 5: Verificar build y suite**

Run: `npm run build && npm test`
Expected: todo OK/PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/galleries/[id] messages
git commit -m "feat: add photo manager grid with multi-select, batch actions and lightbox"
```

---

### Task 7: Indicador de almacenamiento en la lista de galerías

**Files:**
- Create: `src/lib/format.ts`
- Modify: `src/app/admin/galleries/page.tsx`
- Modify: `messages/es.json`, `messages/en.json`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Consumes: `storageTotals` (Task 3).
- Produces: `formatBytes(bytes: number): string` — `0 B`, `1.5 KB`, `23.4 MB`, `1.2 GB` (1 decimal salvo bytes).

- [ ] **Step 1: Test failing** — `tests/lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it("formats human-readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(23.4 * 1024 * 1024)).toBe("23.4 MB");
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe("1.3 GB");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** — `src/lib/format.ts`:

```ts
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
  const value = bytes / 2 ** (10 * i);
  return `${i === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Mensajes y página** — agregar en `messages/es.json` dentro de `galleries`:

```json
"storageUsed": "Almacenamiento: {size}"
```

En `messages/en.json` dentro de `galleries`:

```json
"storageUsed": "Storage: {size}"
```

En `src/app/admin/galleries/page.tsx`: agregar imports

```tsx
import { storageTotals } from "@/server/photos";
import { formatBytes } from "@/lib/format";
```

Después de `const items = await listGalleries(...)` agregar:

```tsx
  const totals = await storageTotals(db, studio.id);
```

Reemplazar el `<h1>` por un header con el total siempre visible:

```tsx
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <span className="text-sm text-neutral-500">
          {t("storageUsed", { size: formatBytes(totals.totalBytes) })}
        </span>
      </div>
```

Y en el `<p className="text-xs text-neutral-500">` de cada fila, agregar el desglose por galería al final de la línea existente:

```tsx
              <p className="text-xs text-neutral-500">
                {t(`status.${g.status}`)} · {t("created")} {g.createdAt.toISOString().slice(0, 10)}
                {" · "}{formatBytes(totals.perGallery[g.id] ?? 0)}
              </p>
```

Nota: `getTranslations` de next-intl soporta interpolación `{size}` con `t("storageUsed", { size })` — la clave usa sintaxis ICU estándar.

- [ ] **Step 6: Verificar build y suite, commit**

```bash
npm run build && npm test
git add src/lib/format.ts tests/lib/format.test.ts src/app/admin/galleries/page.tsx messages
git commit -m "feat: show storage usage totals on gallery list"
```

---

### Task 8: Verificación final de la fase

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: fase 2 verificada y documentada.

- [ ] **Step 1: Suite completa + build + lint**

```bash
npm test && npm run build && npx eslint src tests
```

Expected: todo PASS/OK sin warnings.

- [ ] **Step 2: README** — agregar a `README.md`, después de la sección "## Desarrollo", la sección:

```markdown
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
```

- [ ] **Step 3: Verificación manual (requiere credenciales R2 reales en `.env.local`)**

`npm run dev` → abrir una galería → subir 2-3 fotos JPEG (arrastrar y por selector) → verificar: aparecen procesando y luego con miniatura; seleccionar con clic/cmd-clic/arrastre; mover a una sección; ocultar/publicar; usar de portada (estrella); doble clic abre lightbox; eliminar (con confirmación) las quita; el indicador de almacenamiento en `/admin/galleries` refleja los bytes. Si no hay credenciales R2 en el entorno de ejecución, documentarlo en el reporte y basarse en build + tests.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add R2 setup and CORS instructions"
```

---

## Self-Review (ya aplicado)

- **Cobertura spec fase 2:** subida directa a R2 con presign ✓; pipeline thumb/web con EXIF y orientación ✓; gestor: selección múltiple con clic/modificador y rubber band ✓, mover entre secciones ✓, publicar/ocultar ✓, eliminar en lote (DB + R2) ✓, portada por foto ✓, lightbox ✓, nombre de archivo visible ✓, estado procesando/error ✓; "Sin sección" como bloque inicial ✓; indicador de almacenamiento total + por galería ✓; orden por captura/nombre/manual ✓. Diferido explícito: watermark (F4), vista cliente (F3), badges likes/comentarios (F3), reordenamiento manual por arrastre (F5 según spec, "orden manual" ya respeta `position`).
- **Placeholders:** ninguno.
- **Consistencia de tipos:** firmas de `photos.ts` coinciden con las usadas en routes/actions/página; `PhotoView` definido en `photo-manager.tsx` e importado como type en la página; claves i18n usadas = claves definidas.
