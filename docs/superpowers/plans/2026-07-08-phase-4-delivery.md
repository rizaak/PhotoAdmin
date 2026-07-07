# PhonoManager Fase 4 (Entrega: marca de agua + descargas + ZIP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La galería del cliente sirve variantes con marca de agua según la herencia galería→sección→foto, y permite descargar fotos sueltas por resolución habilitada y ZIPs (galería/sección/favoritas) transmitidos por un Cloudflare Worker desde R2.

**Architecture:** El pipeline genera 6 variantes fijas por foto (`thumb/web/high` + `-wm` con texto). Un módulo puro `delivery.ts` resuelve el modo efectivo de marca, permisos de descarga y qué clave R2 corresponde a cada contexto (vista/descarga/resolución) — todo testeable sin red. `processing.ts` unifica procesar y re-procesar (regeneración de marcas y retry de errores). El ZIP vive en un Worker mínimo (`workers/zip`) que valida un JWT firmado por la app, lee un manifest JSON de R2 y streamea un ZIP (modo store, zip64) sin límites de tamaño.

**Tech Stack:** Lo existente + Cloudflare Worker (wrangler, binding R2, `jose` para verificar el token).

**Spec:** `docs/superpowers/specs/2026-07-05-photo-gallery-delivery-design.md`

**Decisiones/desviaciones aprobadas:**
- Marca de agua de **texto** (patrón diagonal repetido semitransparente). Marca con imagen/logo → futuro.
- Sin `gallery.watermarkText`, el modo efectivo es `none` aunque el select diga otra cosa (no hay asset que aplicar).
- Si una foto REQUIERE marca en vista y su variante `-wm` aún no existe (subida antes de configurar el texto, regeneración en curso), la foto se **excluye** de la vista del cliente — jamás se sirve la limpia.
- La resolución **original** se deshabilita cuando la marca aplica a la descarga (el original no se puede marcar sin procesarlo; web/alta sirven sus variantes `-wm`).
- Regenerar = re-procesar la foto completa desde el original (mismas claves fijas → sobreescribe en R2; si el texto se quitó, borra los objetos `-wm`). El mismo endpoint sirve para reintentar fotos en `error`.
- ZIP: si `ZIP_WORKER_URL`/`ZIP_SIGNING_SECRET` faltan, la acción devuelve error tipado y la UI muestra "descarga ZIP no disponible" — el resto de la fase funciona sin el worker desplegado.

## Global Constraints

- Claves de variantes FIJAS por foto (dir = carpeta del original): `thumb.jpg, web.jpg, high.jpg, thumb-wm.jpg, web-wm.jpg, high-wm.jpg`. `high` = 4096px `fit:inside` sin agrandar, jpeg q90. Variantes `-wm` solo si `gallery.watermarkText` no es null.
- Modo efectivo de marca: `photo.watermarkOverride === false → "none"`; `=== true → "both"`; si null → `section.watermarkMode ?? gallery.watermarkMode`; y si `gallery.watermarkText` es null → SIEMPRE `"none"`. Descarga efectiva: `section.downloadEnabled ?? gallery.downloadEnabled`.
- La clave que recibe el cliente se decide EN EL SERVIDOR con estas funciones puras; la variante limpia jamás llega al navegador cuando el modo exige marca (vista: excluir foto si falta variante; descarga: `null` = no disponible).
- Eventos: `download_photo` y `download_zip` en cada descarga exitosa (con photoId en el primero; metadata `{scope, resolution, count}` en el zip).
- Toda action del cliente re-verifica sesión (`requireClientSession`) y toma galleryId del token; Zod en inputs; URLs SIEMPRE prefirmadas (descarga de foto con `Content-Disposition: attachment`).
- Worker: valida JWT HS256 (`ZIP_SIGNING_SECRET`, exp ≤ 15 min, payload `{ m: manifestKey }`), solo lee de R2, ZIP modo store (JPEG ya comprimido) con zip64 en el directorio central (archivos >4GB totales OK; cada entrada ≤100MB garantizado por F2).
- i18n es/en con paridad; TS strict; gate por task: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` sin warnings. El worker se excluye del tsconfig/eslint de la app (paquete propio en `workers/zip`).
- Envs nuevas (`.env.example`): `ZIP_WORKER_URL` (URL del worker desplegado), `ZIP_SIGNING_SECRET` (hex 32; compartido app↔worker).
- Migraciones drizzle; multi-tenant y TDD como en fases previas.

---

### Task 1: Migración `thumb_wm_key` + envs + descarga con attachment

**Files:**
- Modify: `src/db/schema.ts` (columna en photos), `.env.example`, `src/server/storage.ts`
- Create: `drizzle/0003_*.sql` (generada)
- Test: `tests/server/storage.test.ts` (ampliar)

**Interfaces:**
- Produces: `photos.thumbWmKey: string | null` en schema; `presignDownload(key: string, expiresIn?: number, downloadFilename?: string): Promise<string>` — con `downloadFilename` agrega `ResponseContentDisposition: attachment; filename="..."` (comillas y caracteres no ASCII/`"` del filename saneados a `_`).

- [ ] **Step 1: Schema** — en `src/db/schema.ts`, en la tabla `photos`, después de `thumbKey`:

```ts
  thumbWmKey: text("thumb_wm_key"),
```

```bash
npm run db:generate
sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'
```

Expected: `drizzle/0003_*.sql` con `ALTER TABLE "photos" ADD COLUMN "thumb_wm_key" text;`, aplicada a Neon.

- [ ] **Step 2: Test failing del attachment** — agregar a `tests/server/storage.test.ts`:

```ts
  it("adds attachment content-disposition when a download filename is given", async () => {
    const { presignDownload } = await import("@/server/storage");
    const url = await presignDownload("k/web.jpg", 900, 'bo"da á.jpg');
    const params = new URL(url).searchParams;
    const disposition = params.get("response-content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain('filename="bo_da _.jpg"');
    const plain = await presignDownload("k/web.jpg");
    expect(new URL(plain).searchParams.get("response-content-disposition")).toBeNull();
  });
```

- [ ] **Step 3: RED** — `npx vitest run tests/server/storage.test.ts` → FAIL.

- [ ] **Step 4: Implementar** — en `src/server/storage.ts`:

```ts
export async function presignDownload(
  key: string, expiresIn = 900, downloadFilename?: string,
): Promise<string> {
  const clamped = Math.min(expiresIn, 900);
  const safeName = downloadFilename?.replace(/[^\x20-\x7e]|"/g, "_");
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(safeName ? { ResponseContentDisposition: `attachment; filename="${safeName}"` } : {}),
    }),
    { expiresIn: clamped },
  );
}
```

- [ ] **Step 5: GREEN + envs** — `npx vitest run tests/server/storage.test.ts` → PASS. Agregar a `.env.example`:

```bash
# ZIP worker (Cloudflare). Generar el secret con: openssl rand -hex 32
ZIP_WORKER_URL=
ZIP_SIGNING_SECRET=use-openssl-rand-hex-32
```

- [ ] **Step 6: Gate + commit**

```bash
npm test && npx tsc --noEmit
git add -A && git commit -m "feat: add thumb watermark column, attachment downloads, zip envs"
```

---

### Task 2: Marca de agua de texto + variante alta en `images.ts`

**Files:**
- Modify: `src/server/images.ts`
- Test: `tests/server/images.test.ts` (ampliar)

**Interfaces:**
- Consumes: `processImage` existente (se conserva para compat).
- Produces:
  - `applyWatermark(image: Buffer, text: string): Promise<Buffer>` — patrón diagonal repetido, blanco 35% opacidad, jpeg q85.
  - `makeDerivatives(original: Buffer, opts: { watermarkText: string | null }): Promise<DerivativeSet>` con `DerivativeSet = { width: number; height: number; takenAt: Date | null; thumb: Buffer; web: Buffer; high: Buffer; thumbWm: Buffer | null; webWm: Buffer | null; highWm: Buffer | null }` — `-wm` null cuando `watermarkText` es null; lanza `Error("INVALID_IMAGE")` como `processImage`.

- [ ] **Step 1: Tests failing** — agregar a `tests/server/images.test.ts`:

```ts
import { makeDerivatives, applyWatermark } from "@/server/images";

describe("makeDerivatives", () => {
  it("produces thumb/web/high and watermarked variants when text given", async () => {
    const out = await makeDerivatives(await makeJpeg(5000, 3000), { watermarkText: "© Isaac" });
    const high = await sharp(out.high).metadata();
    expect(Math.max(high.width!, high.height!)).toBe(4096);
    expect(out.thumbWm).not.toBeNull();
    expect(out.webWm).not.toBeNull();
    expect(out.highWm).not.toBeNull();
    // la variante marcada difiere de la limpia
    expect(Buffer.compare(out.web, out.webWm!)).not.toBe(0);
    expect(out.width).toBe(5000);
  });

  it("skips watermark variants without text", async () => {
    const out = await makeDerivatives(await makeJpeg(800, 600), { watermarkText: null });
    expect(out.thumbWm).toBeNull();
    expect(out.webWm).toBeNull();
    expect(out.highWm).toBeNull();
  });

  it("escapes XML-sensitive characters in the watermark text", async () => {
    const marked = await applyWatermark(await makeJpeg(400, 300), `<Isaac & "Fotos">`);
    expect((await sharp(marked).metadata()).width).toBe(400);
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/images.test.ts` → FAIL (exports inexistentes).

- [ ] **Step 3: Implementar** — agregar a `src/server/images.ts`:

```ts
const HIGH_SIZE = 4096;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function watermarkSvg(width: number, height: number, text: string): Buffer {
  const fontSize = Math.max(14, Math.round(Math.max(width, height) / 24));
  const tileW = fontSize * (text.length + 6);
  const tileH = fontSize * 6;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">` +
      `<text x="0" y="${fontSize * 3}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" ` +
      `fill="white" fill-opacity="0.35">${escapeXml(text)}</text>` +
      `</pattern></defs><rect width="100%" height="100%" fill="url(#wm)"/></svg>`,
  );
}

export async function applyWatermark(image: Buffer, text: string): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");
  return sharp(image)
    .composite([{ input: watermarkSvg(meta.width, meta.height, text) }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

export type DerivativeSet = {
  width: number;
  height: number;
  takenAt: Date | null;
  thumb: Buffer;
  web: Buffer;
  high: Buffer;
  thumbWm: Buffer | null;
  webWm: Buffer | null;
  highWm: Buffer | null;
};

export async function makeDerivatives(
  original: Buffer, opts: { watermarkText: string | null },
): Promise<DerivativeSet> {
  let meta: Metadata;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");

  const base = sharp(original).rotate();
  const resize = (px: number, quality: number) =>
    base.clone().resize(px, px, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();

  const [thumb, web, high] = await Promise.all([resize(THUMB_SIZE, 80), resize(WEB_SIZE, 85), resize(HIGH_SIZE, 90)]);

  let thumbWm: Buffer | null = null;
  let webWm: Buffer | null = null;
  let highWm: Buffer | null = null;
  if (opts.watermarkText) {
    [thumbWm, webWm, highWm] = await Promise.all([
      applyWatermark(thumb, opts.watermarkText),
      applyWatermark(web, opts.watermarkText),
      applyWatermark(high, opts.watermarkText),
    ]);
  }

  const swapped = (meta.orientation ?? 1) >= 5;
  return {
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    takenAt: extractTakenAt(meta.exif),
    thumb, web, high, thumbWm, webWm, highWm,
  };
}
```

- [ ] **Step 4: GREEN + gate + commit**

```bash
npx vitest run tests/server/images.test.ts && npm test && npx tsc --noEmit
git add src/server/images.ts tests/server/images.test.ts
git commit -m "feat: add text watermark rendering and high-res derivative"
```

---

### Task 3: Dominio puro de entrega (`delivery.ts`)

**Files:**
- Create: `src/server/delivery.ts`
- Test: `tests/server/delivery.test.ts`

**Interfaces:**
- Consumes: tipos `Photo`, `Section`, `Gallery` de `@/db/schema` (solo lectura de campos; las funciones aceptan subconjuntos estructurales para testear con objetos literales).
- Produces (Tasks 7/8/9 consumen — firmas exactas):
  - `type WatermarkMode = "none" | "view" | "download" | "both"` y `type Resolution = "web" | "high" | "original"`.
  - `effectiveWatermarkMode(photo: { watermarkOverride: boolean | null }, section: { watermarkMode: WatermarkMode | null } | null, gallery: { watermarkMode: WatermarkMode; watermarkText: string | null }): WatermarkMode`
  - `effectiveDownloadEnabled(section: { downloadEnabled: boolean | null } | null, gallery: { downloadEnabled: boolean }): boolean`
  - `enabledResolutions(gallery: { resWebEnabled: boolean; resHighEnabled: boolean; resOriginalEnabled: boolean }): Resolution[]`
  - `type PhotoKeys = { thumbKey: string | null; webKey: string | null; highKey: string | null; thumbWmKey: string | null; webWmKey: string | null; highWmKey: string | null; originalKey: string }`
  - `viewKeys(photo: PhotoKeys, mode: WatermarkMode): { thumbKey: string; webKey: string } | null` — con marca en vista (`view|both`) usa `-wm`; devuelve `null` si falta alguna clave requerida (foto se excluye).
  - `downloadKey(photo: PhotoKeys, mode: WatermarkMode, resolution: Resolution): string | null` — con marca en descarga (`download|both`): web→webWm, high→highWm, original→null; sin marca: web→webKey, high→highKey, original→originalKey; null si la clave no existe.

- [ ] **Step 1: Tests failing** — `tests/server/delivery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  effectiveWatermarkMode, effectiveDownloadEnabled, enabledResolutions, viewKeys, downloadKey,
} from "@/server/delivery";

const keys = {
  originalKey: "o", thumbKey: "t", webKey: "w", highKey: "h",
  thumbWmKey: "twm", webWmKey: "wwm", highWmKey: "hwm",
};
const gal = (over = {}) => ({ watermarkMode: "view" as const, watermarkText: "©", ...over });

describe("effectiveWatermarkMode", () => {
  it("resolves photo > section > gallery inheritance", () => {
    expect(effectiveWatermarkMode({ watermarkOverride: null }, null, gal())).toBe("view");
    expect(effectiveWatermarkMode({ watermarkOverride: null }, { watermarkMode: "download" }, gal())).toBe("download");
    expect(effectiveWatermarkMode({ watermarkOverride: null }, { watermarkMode: null }, gal())).toBe("view");
    expect(effectiveWatermarkMode({ watermarkOverride: true }, { watermarkMode: null }, gal({ watermarkMode: "none" }))).toBe("both");
    expect(effectiveWatermarkMode({ watermarkOverride: false }, { watermarkMode: "both" }, gal())).toBe("none");
  });
  it("is none without watermark text regardless of settings", () => {
    expect(effectiveWatermarkMode({ watermarkOverride: true }, { watermarkMode: "both" }, gal({ watermarkText: null }))).toBe("none");
  });
});

describe("effectiveDownloadEnabled / enabledResolutions", () => {
  it("section override wins over gallery", () => {
    expect(effectiveDownloadEnabled({ downloadEnabled: false }, { downloadEnabled: true })).toBe(false);
    expect(effectiveDownloadEnabled({ downloadEnabled: null }, { downloadEnabled: true })).toBe(true);
    expect(effectiveDownloadEnabled(null, { downloadEnabled: false })).toBe(false);
  });
  it("lists enabled resolutions in order web/high/original", () => {
    expect(enabledResolutions({ resWebEnabled: true, resHighEnabled: false, resOriginalEnabled: true }))
      .toEqual(["web", "original"]);
  });
});

describe("viewKeys", () => {
  it("serves clean keys without view watermark and wm keys with it", () => {
    expect(viewKeys(keys, "none")).toEqual({ thumbKey: "t", webKey: "w" });
    expect(viewKeys(keys, "download")).toEqual({ thumbKey: "t", webKey: "w" });
    expect(viewKeys(keys, "view")).toEqual({ thumbKey: "twm", webKey: "wwm" });
    expect(viewKeys(keys, "both")).toEqual({ thumbKey: "twm", webKey: "wwm" });
  });
  it("returns null (exclude photo) when a required key is missing", () => {
    expect(viewKeys({ ...keys, webWmKey: null }, "view")).toBeNull();
    expect(viewKeys({ ...keys, thumbKey: null }, "none")).toBeNull();
  });
});

describe("downloadKey", () => {
  it("maps resolutions to clean keys without download watermark", () => {
    expect(downloadKey(keys, "view", "web")).toBe("w");
    expect(downloadKey(keys, "none", "high")).toBe("h");
    expect(downloadKey(keys, "none", "original")).toBe("o");
  });
  it("maps to wm keys and disables original with download watermark", () => {
    expect(downloadKey(keys, "download", "web")).toBe("wwm");
    expect(downloadKey(keys, "both", "high")).toBe("hwm");
    expect(downloadKey(keys, "both", "original")).toBeNull();
  });
  it("returns null when the variant key is missing", () => {
    expect(downloadKey({ ...keys, highKey: null }, "none", "high")).toBeNull();
    expect(downloadKey({ ...keys, webWmKey: null }, "download", "web")).toBeNull();
  });
});
```

- [ ] **Step 2: RED** → módulo inexistente.

- [ ] **Step 3: Implementar** — `src/server/delivery.ts`:

```ts
export type WatermarkMode = "none" | "view" | "download" | "both";
export type Resolution = "web" | "high" | "original";

export function effectiveWatermarkMode(
  photo: { watermarkOverride: boolean | null },
  section: { watermarkMode: WatermarkMode | null } | null,
  gallery: { watermarkMode: WatermarkMode; watermarkText: string | null },
): WatermarkMode {
  if (!gallery.watermarkText) return "none";
  if (photo.watermarkOverride === false) return "none";
  if (photo.watermarkOverride === true) return "both";
  return section?.watermarkMode ?? gallery.watermarkMode;
}

export function effectiveDownloadEnabled(
  section: { downloadEnabled: boolean | null } | null,
  gallery: { downloadEnabled: boolean },
): boolean {
  return section?.downloadEnabled ?? gallery.downloadEnabled;
}

export function enabledResolutions(
  gallery: { resWebEnabled: boolean; resHighEnabled: boolean; resOriginalEnabled: boolean },
): Resolution[] {
  const out: Resolution[] = [];
  if (gallery.resWebEnabled) out.push("web");
  if (gallery.resHighEnabled) out.push("high");
  if (gallery.resOriginalEnabled) out.push("original");
  return out;
}

export type PhotoKeys = {
  originalKey: string;
  thumbKey: string | null;
  webKey: string | null;
  highKey: string | null;
  thumbWmKey: string | null;
  webWmKey: string | null;
  highWmKey: string | null;
};

const wmOnView = (m: WatermarkMode) => m === "view" || m === "both";
const wmOnDownload = (m: WatermarkMode) => m === "download" || m === "both";

export function viewKeys(
  photo: PhotoKeys, mode: WatermarkMode,
): { thumbKey: string; webKey: string } | null {
  const thumb = wmOnView(mode) ? photo.thumbWmKey : photo.thumbKey;
  const web = wmOnView(mode) ? photo.webWmKey : photo.webKey;
  if (!thumb || !web) return null;
  return { thumbKey: thumb, webKey: web };
}

export function downloadKey(
  photo: PhotoKeys, mode: WatermarkMode, resolution: Resolution,
): string | null {
  if (wmOnDownload(mode)) {
    if (resolution === "web") return photo.webWmKey;
    if (resolution === "high") return photo.highWmKey;
    return null; // el original no se puede marcar
  }
  if (resolution === "web") return photo.webKey;
  if (resolution === "high") return photo.highKey;
  return photo.originalKey;
}
```

- [ ] **Step 4: GREEN + gate + commit**

```bash
npx vitest run tests/server/delivery.test.ts && npm test && npx tsc --noEmit
git add src/server/delivery.ts tests/server/delivery.test.ts
git commit -m "feat: add pure delivery domain (watermark inheritance, download keys)"
```

---

### Task 4: `processing.ts` unificado + ruta complete con variantes

**Files:**
- Create: `src/server/processing.ts`
- Modify: `src/server/photos.ts` (completeProcessing ampliado), `src/app/api/photos/[photoId]/complete/route.ts`
- Test: `tests/server/photos.test.ts` (ampliar)

**Interfaces:**
- Consumes: `makeDerivatives` (T2), storage (get/put/deleteObjects), `getOwnedPhoto`/`markPhotoError`, `galleries` schema.
- Produces:
  - `completeProcessing(db, studioId, photoId, result)` — `result` gana campos opcionales `highKey?: string | null; thumbWmKey?: string | null; webWmKey?: string | null; highWmKey?: string | null` (default null, se persisten).
  - `processPhoto(db: Db, studioId: string, photoId: string): Promise<"ready">` en `@/server/processing` — descarga el original, genera TODAS las variantes según `gallery.watermarkText`, sube con claves fijas (`{dir}/thumb.jpg`, `web.jpg`, `high.jpg`, `thumb-wm.jpg`, `web-wm.jpg`, `high-wm.jpg`), borra objetos `-wm` viejos si ya no aplican, y llama a completeProcessing con claves y `sizeDerivativesBytes` = suma fresca de todos los buffers. Lanza en fallo (el caller marca error).

- [ ] **Step 1: Test failing** — en `tests/server/photos.test.ts`, ampliar el test "completes processing and marks errors": pasar también `highKey: "k/high.jpg", thumbWmKey: "k/thumb-wm.jpg", webWmKey: "k/web-wm.jpg", highWmKey: "k/high-wm.jpg"` en un nuevo caso y assertar que los 4 se persisten y que omitirlos deja null:

```ts
    const p3 = await registerUpload(db, studio.id, gallery.id, upload("c.jpg"));
    const full = await completeProcessing(db, studio.id, p3.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w",
      highKey: "h", thumbWmKey: "twm", webWmKey: "wwm", highWmKey: "hwm",
      sizeDerivativesBytes: 9, sizeOriginalBytes: 1000,
    });
    expect(full.highKey).toBe("h");
    expect(full.thumbWmKey).toBe("twm");
    expect(full.webWmKey).toBe("wwm");
    expect(full.highWmKey).toBe("hwm");
    expect(done.highKey).toBeNull(); // el caso previo, sin los campos nuevos
```

- [ ] **Step 2: RED** → campos inexistentes en el tipo.

- [ ] **Step 3: completeProcessing** — en `src/server/photos.ts`:

```ts
export async function completeProcessing(
  db: Db, studioId: string, photoId: string,
  result: {
    width: number; height: number; takenAt: Date | null;
    thumbKey: string; webKey: string;
    highKey?: string | null; thumbWmKey?: string | null; webWmKey?: string | null; highWmKey?: string | null;
    sizeDerivativesBytes: number; sizeOriginalBytes: number;
  },
): Promise<Photo> {
  await getOwnedPhoto(db, studioId, photoId);
  const [photo] = await db.update(photos).set({
    status: "ready",
    width: result.width,
    height: result.height,
    takenAt: result.takenAt,
    thumbKey: result.thumbKey,
    webKey: result.webKey,
    highKey: result.highKey ?? null,
    thumbWmKey: result.thumbWmKey ?? null,
    webWmKey: result.webWmKey ?? null,
    highWmKey: result.highWmKey ?? null,
    sizeDerivativesBytes: result.sizeDerivativesBytes,
    sizeOriginalBytes: result.sizeOriginalBytes,
  }).where(eq(photos.id, photoId)).returning();
  return photo;
}
```

- [ ] **Step 4: processing.ts** — `src/server/processing.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { galleries } from "@/db/schema";
import { getOwnedPhoto, completeProcessing } from "./photos";
import { makeDerivatives } from "./images";
import { getObjectBuffer, putObjectBuffer, deleteObjects } from "./storage";

export async function processPhoto(db: Db, studioId: string, photoId: string): Promise<"ready"> {
  const photo = await getOwnedPhoto(db, studioId, photoId);
  const [gallery] = await db.select().from(galleries).where(eq(galleries.id, photo.galleryId));
  if (!gallery) throw new Error("NOT_FOUND");

  const original = await getObjectBuffer(photo.originalKey);
  const set = await makeDerivatives(original, { watermarkText: gallery.watermarkText });

  const dir = photo.originalKey.split("/").slice(0, -1).join("/");
  const keys = {
    thumbKey: `${dir}/thumb.jpg`,
    webKey: `${dir}/web.jpg`,
    highKey: `${dir}/high.jpg`,
    thumbWmKey: set.thumbWm ? `${dir}/thumb-wm.jpg` : null,
    webWmKey: set.webWm ? `${dir}/web-wm.jpg` : null,
    highWmKey: set.highWm ? `${dir}/high-wm.jpg` : null,
  };

  const puts = [
    putObjectBuffer(keys.thumbKey, set.thumb, "image/jpeg"),
    putObjectBuffer(keys.webKey, set.web, "image/jpeg"),
    putObjectBuffer(keys.highKey, set.high, "image/jpeg"),
  ];
  if (set.thumbWm) puts.push(putObjectBuffer(keys.thumbWmKey!, set.thumbWm, "image/jpeg"));
  if (set.webWm) puts.push(putObjectBuffer(keys.webWmKey!, set.webWm, "image/jpeg"));
  if (set.highWm) puts.push(putObjectBuffer(keys.highWmKey!, set.highWm, "image/jpeg"));
  await Promise.all(puts);

  // si la marca se quitó, borrar variantes -wm que existían antes
  const stale = [photo.thumbWmKey, photo.webWmKey, photo.highWmKey]
    .filter((k): k is string => !!k && !set.thumbWm);
  if (stale.length > 0) await deleteObjects(stale);

  const sizeDerivativesBytes =
    set.thumb.length + set.web.length + set.high.length +
    (set.thumbWm?.length ?? 0) + (set.webWm?.length ?? 0) + (set.highWm?.length ?? 0);

  await completeProcessing(db, studioId, photoId, {
    width: set.width,
    height: set.height,
    takenAt: set.takenAt,
    ...keys,
    sizeDerivativesBytes,
    sizeOriginalBytes: original.length,
  });
  return "ready";
}
```

- [ ] **Step 5: Ruta complete delgada** — reemplazar el cuerpo del try de procesamiento en `src/app/api/photos/[photoId]/complete/route.ts` (conservar auth/validación/idempotencia/catches actuales):

```ts
  try {
    if (photo.status !== "ready") {
      const { processPhoto } = await import("@/server/processing");
      await processPhoto(db, studioId, photoId);
    }
    return NextResponse.json({ status: "ready" });
  } catch (e) {
    console.error("photo processing failed", photoId, e);
    // ... (catch existente: markPhotoError guardado + 422)
```

Nota: eliminar de la ruta los imports que queden sin uso (`getObjectBuffer`, `putObjectBuffer`, `processImage`, `MAX_UPLOAD_BYTES` si ya no se usan) — el guard de tamaño se muda a `processPhoto`? NO: mantener el guard `original.length > MAX_UPLOAD_BYTES` DENTRO de `processPhoto` (importar `MAX_UPLOAD_BYTES` de `./photos` y lanzar `Error("FILE_TOO_LARGE")` tras `getObjectBuffer`). El import dinámico `await import` es para evitar cargar sharp en el módulo de la ruta en build; si el bundler no se queja, un import estático también es aceptable.

- [ ] **Step 6: GREEN + gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: unified photo processing with watermark and high variants"
```

---

### Task 5: Endpoint de re-proceso + UI de regeneración con progreso

**Files:**
- Create: `src/app/api/photos/[photoId]/reprocess/route.ts`
- Create: `src/app/admin/galleries/[id]/reprocess-photos.tsx`
- Modify: `src/app/admin/galleries/[id]/page.tsx`, `messages/es.json`, `messages/en.json`

**Interfaces:**
- Consumes: `processPhoto` (T4), `requireStudio`, `getOwnedPhoto`.
- Produces: `POST /api/photos/{photoId}/reprocess` → 200 `{status:"ready"}` | 401 | 404 | 422 (mismos contratos que complete pero SIN el short-circuit de ready — siempre re-procesa). Componente `<ReprocessPhotos galleryId photoIds labels />` que procesa en serie con barra de progreso y `router.refresh()` al terminar.

- [ ] **Step 1: Ruta** — `src/app/api/photos/[photoId]/reprocess/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getOwnedPhoto, markPhotoError } from "@/server/photos";
import { processPhoto } from "@/server/processing";

export const maxDuration = 60;

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
  try {
    await getOwnedPhoto(db, studioId, photoId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    await processPhoto(db, studioId, photoId);
    return NextResponse.json({ status: "ready" });
  } catch (e) {
    console.error("photo reprocess failed", photoId, e);
    try {
      await markPhotoError(db, studioId, photoId);
    } catch (err) {
      console.error("markPhotoError failed", photoId, err);
    }
    return NextResponse.json({ status: "error" }, { status: 422 });
  }
}
```

- [ ] **Step 2: Mensajes** — dentro de `galleryDetail` en `messages/es.json`:

```json
"reprocess": {
  "pending": "{count} fotos pendientes de actualizar (marca de agua o errores)",
  "run": "Actualizar fotos",
  "running": "Procesando {done} de {total}…",
  "done": "Fotos actualizadas.",
  "failed": "{count} fotos fallaron; reintenta."
}
```

en `messages/en.json`:

```json
"reprocess": {
  "pending": "{count} photos pending update (watermark or errors)",
  "run": "Update photos",
  "running": "Processing {done} of {total}…",
  "done": "Photos updated.",
  "failed": "{count} photos failed; retry."
}
```

- [ ] **Step 3: Componente** — `src/app/admin/galleries/[id]/reprocess-photos.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Labels = { pending: string; run: string; running: string; done: string; failed: string };

export function ReprocessPhotos({
  photoIds, labels,
}: {
  photoIds: string[];
  labels: Labels;
}) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const router = useRouter();

  if (photoIds.length === 0) return null;

  async function run() {
    setState("running");
    let ok = 0;
    let bad = 0;
    for (const id of photoIds) {
      const res = await fetch(`/api/photos/${id}/reprocess`, { method: "POST" }).catch(() => null);
      if (res?.ok) ok++; else bad++;
      setDone(ok + bad);
      setFailed(bad);
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      {state === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <span>{labels.pending.replace("{count}", String(photoIds.length))}</span>
          <button onClick={() => void run()} className="rounded bg-neutral-900 px-3 py-1.5 text-white">
            {labels.run}
          </button>
        </div>
      )}
      {state === "running" && (
        <div>
          <p>{labels.running.replace("{done}", String(done)).replace("{total}", String(photoIds.length))}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-200">
            <div className="h-full bg-neutral-900 transition-all" style={{ width: `${(done / photoIds.length) * 100}%` }} />
          </div>
        </div>
      )}
      {state === "done" && (
        <p>{failed > 0 ? labels.failed.replace("{count}", String(failed)) : labels.done}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Montar en el detalle** — en `src/app/admin/galleries/[id]/page.tsx`, tras cargar `photoRows`, calcular pendientes y montar el banner arriba de la sección de fotos:

```tsx
  const pendingReprocess = photoRows
    .filter((p) =>
      p.status === "error" ||
      (p.status === "ready" && (gallery.watermarkText ? !p.webWmKey : !!p.webWmKey)) ||
      (p.status === "ready" && !p.highKey),
    )
    .map((p) => p.id);
  const tr = await getTranslations("galleryDetail.reprocess");
```

y en el JSX, dentro de la `<section>` de fotos, antes del uploader:

```tsx
        <div className="mb-4">
          <ReprocessPhotos
            photoIds={pendingReprocess}
            labels={{
              pending: tr.raw("pending") as string, run: tr("run"),
              running: tr.raw("running") as string, done: tr("done"),
              failed: tr.raw("failed") as string,
            }}
          />
        </div>
```

(import `ReprocessPhotos` de `./reprocess-photos`.)

- [ ] **Step 5: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add photo reprocess endpoint and batch regeneration UI"
```

---

### Task 6: Overrides — texto de marca, secciones y fotos

**Files:**
- Modify: `src/server/sections.ts`, `src/server/photos.ts`, `src/server/galleries.ts` (watermarkText en updateGallerySettings — verificar que ya está en el schema Zod; si no, agregar), `src/app/admin/galleries/[id]/page.tsx`, `src/app/admin/galleries/[id]/actions.ts`, `src/app/admin/galleries/[id]/photo-manager.tsx`, `messages/es.json`, `messages/en.json`
- Test: `tests/server/sections.test.ts`, `tests/server/photos.test.ts` (ampliar)

**Interfaces:**
- Produces:
  - `setSectionOverrides(db: Db, studioId: string, sectionId: string, overrides: { watermarkMode: WatermarkMode | null; downloadEnabled: boolean | null }): Promise<Section>` en sections.ts (tenant-scoped vía assertSectionOwnership).
  - `setPhotosWatermarkOverride(db: Db, studioId: string, galleryId: string, photoIds: string[], override: boolean | null): Promise<void>` en photos.ts (assertPhotosInGallery).
  - Actions: `setSectionOverridesAction(formData)` y `setWatermarkOverrideAction(input: { galleryId: string; photoIds: string[]; override: boolean | null })`.

- [ ] **Step 1: Tests failing (dominio)** — en `tests/server/sections.test.ts`:

```ts
  it("sets and clears delivery overrides tenant-scoped", async () => {
    const { db, studio, gallery } = await setup();
    const s = await createSection(db, studio.id, gallery.id, "Selección");
    const updated = await setSectionOverrides(db, studio.id, s.id, { watermarkMode: "both", downloadEnabled: false });
    expect(updated.watermarkMode).toBe("both");
    expect(updated.downloadEnabled).toBe(false);
    const cleared = await setSectionOverrides(db, studio.id, s.id, { watermarkMode: null, downloadEnabled: null });
    expect(cleared.watermarkMode).toBeNull();
    expect(cleared.downloadEnabled).toBeNull();
    const intruder = await seedStudio(db, "auth0|intruso2");
    await expect(setSectionOverrides(db, intruder.id, s.id, { watermarkMode: null, downloadEnabled: null }))
      .rejects.toThrow("NOT_FOUND");
  });
```

En `tests/server/photos.test.ts`:

```ts
  it("sets watermark override per photo batch", async () => {
    const { db, studio, gallery } = await setup();
    const p = await registerUpload(db, studio.id, gallery.id, upload());
    await setPhotosWatermarkOverride(db, studio.id, gallery.id, [p.id], true);
    expect((await getOwnedPhoto(db, studio.id, p.id)).watermarkOverride).toBe(true);
    await setPhotosWatermarkOverride(db, studio.id, gallery.id, [p.id], null);
    expect((await getOwnedPhoto(db, studio.id, p.id)).watermarkOverride).toBeNull();
    const intruder = await seedStudio(db, "auth0|intruso3");
    await expect(setPhotosWatermarkOverride(db, intruder.id, gallery.id, [p.id], false)).rejects.toThrow("NOT_FOUND");
  });
```

- [ ] **Step 2: RED**, luego implementar:

`src/server/sections.ts`:

```ts
const overridesSchema = z.object({
  watermarkMode: z.enum(["none", "view", "download", "both"]).nullable(),
  downloadEnabled: z.boolean().nullable(),
});

export async function setSectionOverrides(
  db: Db, studioId: string, sectionId: string,
  overrides: { watermarkMode: "none" | "view" | "download" | "both" | null; downloadEnabled: boolean | null },
): Promise<Section> {
  const data = overridesSchema.parse(overrides);
  await assertSectionOwnership(db, studioId, sectionId);
  const [section] = await db.update(sections)
    .set({ watermarkMode: data.watermarkMode, downloadEnabled: data.downloadEnabled })
    .where(eq(sections.id, sectionId))
    .returning();
  return section;
}
```

`src/server/photos.ts`:

```ts
export async function setPhotosWatermarkOverride(
  db: Db, studioId: string, galleryId: string, photoIds: string[], override: boolean | null,
): Promise<void> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  await db.update(photos).set({ watermarkOverride: override })
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)));
}
```

En `src/server/galleries.ts`, verificar que `updateGallerySchema` ya incluye `watermarkText: z.string().max(100).nullable().optional()` (fase 1 lo definió); si falta, agregarlo.

- [ ] **Step 3: GREEN dominio** — `npx vitest run tests/server/sections.test.ts tests/server/photos.test.ts`.

- [ ] **Step 4: Mensajes** — dentro de `galleryDetail` (es):

```json
"watermarkText": "Texto de la marca de agua (vacío = sin marca)",
"overrides": {
  "inherit": "Heredar",
  "watermark": "Marca",
  "download": "Descarga",
  "yes": "Sí",
  "no": "No",
  "apply": "Aplicar"
}
```

y dentro de `galleryDetail.photos` (es):

```json
"wmApply": "Marca: aplicar",
"wmRemove": "Marca: quitar",
"wmInherit": "Marca: heredar"
```

Equivalentes en (en): "Watermark text (empty = no watermark)"; overrides {"inherit":"Inherit","watermark":"Watermark","download":"Download","yes":"Yes","no":"No","apply":"Apply"}; photos {"wmApply":"Watermark: apply","wmRemove":"Watermark: remove","wmInherit":"Watermark: inherit"}.

- [ ] **Step 5: UI settings + secciones** — en `src/app/admin/galleries/[id]/page.tsx`:
  - En el form de configuración, junto al select de watermarkMode, agregar:

```tsx
          <label className="flex flex-col gap-1">
            {t("watermarkText")}
            <input name="watermarkText" defaultValue={gallery.watermarkText ?? ""} maxLength={100} className={input} />
          </label>
```

  y en `updateGalleryAction` (`[id]/actions.ts`) incluir en el objeto del settingsForm: `watermarkText: z.string().max(100).nullable()` con parse `watermarkText: String(formData.get("watermarkText") ?? "").trim() || null`.
  - En cada fila de sección, tras los botones existentes, un form de overrides:

```tsx
              <form action={setSectionOverridesAction} className="flex items-center gap-1 text-xs">
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <select name="watermarkMode" defaultValue={s.watermarkMode ?? ""} className="rounded border px-1 py-0.5" title={t("overrides.watermark")}>
                  <option value="">{t("overrides.inherit")}</option>
                  <option value="none">{t("watermarks.none")}</option>
                  <option value="view">{t("watermarks.view")}</option>
                  <option value="download">{t("watermarks.download")}</option>
                  <option value="both">{t("watermarks.both")}</option>
                </select>
                <select name="downloadEnabled" defaultValue={s.downloadEnabled === null ? "" : String(s.downloadEnabled)} className="rounded border px-1 py-0.5" title={t("overrides.download")}>
                  <option value="">{t("overrides.inherit")}</option>
                  <option value="true">{t("overrides.yes")}</option>
                  <option value="false">{t("overrides.no")}</option>
                </select>
                <button className="text-neutral-600 hover:underline">{t("overrides.apply")}</button>
              </form>
```

  (el `<li>` de sección debe llevar `key={`${s.id}-${s.watermarkMode}-${s.downloadEnabled}`}` además del name para remontar tras guardar — mantener el patrón del fix de formularios.)
  - Action en `[id]/actions.ts`:

```ts
export async function setSectionOverridesAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  const sectionId = id.parse(formData.get("sectionId"));
  const wm = String(formData.get("watermarkMode") ?? "");
  const dl = String(formData.get("downloadEnabled") ?? "");
  await setSectionOverrides(db, studio.id, sectionId, {
    watermarkMode: wm === "" ? null : (wm as "none" | "view" | "download" | "both"),
    downloadEnabled: dl === "" ? null : dl === "true",
  });
  revalidatePath(`/admin/galleries/${galleryId}`);
}
```

  (la validación fuerte del enum la hace `setSectionOverrides` con Zod.)

- [ ] **Step 6: Batch de fotos** — action en `[id]/actions.ts`:

```ts
export async function setWatermarkOverrideAction(input: { galleryId: string; photoIds: string[]; override: boolean | null }) {
  const studio = await requireStudio();
  const data = photoBatch.extend({ override: z.boolean().nullable() }).parse(input);
  await setPhotosWatermarkOverride(db, studio.id, data.galleryId, data.photoIds, data.override);
  revalidatePath(`/admin/galleries/${data.galleryId}`);
}
```

En `photo-manager.tsx`: agregar a Labels `wmApply/wmRemove/wmInherit: string`, tres botones en la barra de selección (mismo patrón que publish/hide) llamando `setWatermarkOverrideAction({ galleryId, photoIds: ids, override: true|false|null })` vía `run(...)`, y wire de labels desde la página.

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add watermark text and per-section/per-photo delivery overrides"
```

---

### Task 7: Vista del cliente con marca de agua

**Files:**
- Modify: `src/app/g/[slug]/page.tsx`
- Test: `tests/server/delivery.test.ts` (ampliar con el helper de composición)
- Modify: `src/server/delivery.ts` (agregar helper)

**Interfaces:**
- Consumes: `effectiveWatermarkMode`, `viewKeys` (T3); `getClientGalleryData` (F3 — ya devuelve gallery, sections visibles con overrides, photos).
- Produces: `clientViewPhotos(photos: (PhotoKeys & { id: string; sectionId: string | null; watermarkOverride: boolean | null })[], sections: { id: string; watermarkMode: WatermarkMode | null }[], gallery: { watermarkMode: WatermarkMode; watermarkText: string | null }): { id: string; sectionId: string | null; thumbKey: string; webKey: string }[]` — resuelve modo por foto y EXCLUYE las que `viewKeys` devuelve null.

- [ ] **Step 1: Test failing** — agregar a `tests/server/delivery.test.ts`:

```ts
import { clientViewPhotos } from "@/server/delivery";

describe("clientViewPhotos", () => {
  const base = { ...keys, watermarkOverride: null as boolean | null };
  const sections = [{ id: "s1", watermarkMode: null }, { id: "s2", watermarkMode: "view" as const }];

  it("serves clean or wm keys per photo and excludes photos missing required variants", () => {
    const photos = [
      { ...base, id: "a", sectionId: null },              // hereda galería (none)
      { ...base, id: "b", sectionId: "s2" },              // sección exige view → wm
      { ...base, id: "c", sectionId: "s2", webWmKey: null }, // falta variante → excluida
    ];
    const out = clientViewPhotos(photos, sections, { watermarkMode: "none", watermarkText: "©" });
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0].webKey).toBe("w");
    expect(out[1].webKey).toBe("wwm");
  });
});
```

- [ ] **Step 2: RED**, implementar en `src/server/delivery.ts`:

```ts
export function clientViewPhotos<
  P extends PhotoKeys & { id: string; sectionId: string | null; watermarkOverride: boolean | null },
>(
  photos: P[],
  sections: { id: string; watermarkMode: WatermarkMode | null }[],
  gallery: { watermarkMode: WatermarkMode; watermarkText: string | null },
): { id: string; sectionId: string | null; thumbKey: string; webKey: string }[] {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const out: { id: string; sectionId: string | null; thumbKey: string; webKey: string }[] = [];
  for (const photo of photos) {
    const section = photo.sectionId ? sectionById.get(photo.sectionId) ?? null : null;
    const mode = effectiveWatermarkMode(photo, section, gallery);
    const view = viewKeys(photo, mode);
    if (!view) continue;
    out.push({ id: photo.id, sectionId: photo.sectionId, ...view });
  }
  return out;
}
```

- [ ] **Step 3: Página** — en `src/app/g/[slug]/page.tsx`, reemplazar el mapeo actual de `photoViews` para usar el helper:

```tsx
  const viewList = clientViewPhotos(data.photos, data.sections, data.gallery);
  const byId = new Map(data.photos.map((p) => [p.id, p]));
  const photoViews = await Promise.all(
    viewList.map(async (v) => {
      const p = byId.get(v.id)!;
      return {
        id: p.id,
        filename: p.filename,
        sectionId: v.sectionId,
        thumbUrl: await presignDownload(v.thumbKey),
        webUrl: await presignDownload(v.webKey),
        liked: data.likedPhotoIds.includes(p.id),
        comment: data.commentsByPhoto[p.id]?.[0] ?? null,
      };
    }),
  );
```

(la portada: si la foto de portada quedó excluida, `cover` cae a null — mantener la lógica actual pero buscando la portada dentro de `viewList` y usando su `webKey`.)

- [ ] **Step 4: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: serve watermarked variants in client gallery view"
```

---

### Task 8: Descarga de foto individual (cliente)

**Files:**
- Modify: `src/app/g/[slug]/actions.ts`, `src/app/g/[slug]/page.tsx`, `src/app/g/[slug]/client-gallery.tsx`, `messages/es.json`, `messages/en.json`

**Interfaces:**
- Consumes: `requireClientSession`, delivery (T3), `presignDownload(key, 900, filename)` (T1), schema (`sections`).
- Produces: `downloadPhotoAction(input: { slug: string; photoId: string; resolution: "web" | "high" | "original" }): Promise<{ url: string }>` — valida sesión, foto visible/published/ready, descarga efectiva habilitada, resolución habilitada, clave disponible (si no → `Error("NOT_AVAILABLE")`); registra evento `download_photo`; nombre de archivo = `photo.filename` (para original) o `nombre-sin-ext + "-web.jpg"/"-alta.jpg"`.

- [ ] **Step 1: Action** — agregar a `src/app/g/[slug]/actions.ts`:

```ts
import { sections, activityEvents } from "@/db/schema"; // sumar a los imports existentes
import {
  effectiveWatermarkMode, effectiveDownloadEnabled, enabledResolutions, downloadKey,
} from "@/server/delivery";
import { presignDownload } from "@/server/storage";

const downloadInput = z.object({
  slug: z.string().min(1),
  photoId: z.string().uuid(),
  resolution: z.enum(["web", "high", "original"]),
});

export async function downloadPhotoAction(
  input: { slug: string; photoId: string; resolution: "web" | "high" | "original" },
): Promise<{ url: string }> {
  const data = downloadInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);

  const [photo] = await db.select().from(photos)
    .where(and(eq(photos.id, data.photoId), eq(photos.galleryId, gallery.id)));
  if (!photo || !photo.published || photo.status !== "ready") throw new Error("NOT_FOUND");

  let section = null;
  if (photo.sectionId) {
    [section] = await db.select().from(sections).where(eq(sections.id, photo.sectionId));
    if (!section || !section.visible) throw new Error("NOT_FOUND");
  }
  if (!effectiveDownloadEnabled(section, gallery)) throw new Error("NOT_AVAILABLE");
  if (!enabledResolutions(gallery).includes(data.resolution)) throw new Error("NOT_AVAILABLE");

  const mode = effectiveWatermarkMode(photo, section, gallery);
  const key = downloadKey(photo, mode, data.resolution);
  if (!key) throw new Error("NOT_AVAILABLE");

  const stem = photo.filename.replace(/\.[^.]+$/, "");
  const filename = data.resolution === "original" ? photo.filename
    : data.resolution === "web" ? `${stem}-web.jpg` : `${stem}-alta.jpg`;
  const url = await presignDownload(key, 900, filename);

  await db.insert(activityEvents).values({
    galleryId: gallery.id, clientId, photoId: photo.id, type: "download_photo",
    metadata: { resolution: data.resolution },
  });
  return { url };
}
```

(imports: `and`, `eq` ya están o se agregan; `photos` ya está.)

- [ ] **Step 2: Datos para la UI** — en `src/app/g/[slug]/page.tsx`, calcular permisos por foto y pasarlos:
  - `const resolutions = effectiveDl ? enabledResolutions(data.gallery) : []` NO basta (la descarga es por sección). Computar por foto: para cada `photoView`, `canDownload = effectiveDownloadEnabled(section, gallery) && availableResolutions.length > 0` donde `availableResolutions = enabledResolutions(gallery).filter((r) => downloadKey(photo, mode, r) !== null)`. Pasar en cada ClientPhoto: `downloads: Resolution[]` (vacío = sin botón). Y a nivel galería: `zipEnabled: boolean` (existe alguna foto descargable) — para la Task 9.
- [ ] **Step 3: UI** — en `client-gallery.tsx`:
  - ClientPhoto gana `downloads: ("web" | "high" | "original")[]`.
  - Labels ganan: `download: string; resolutions: { web: string; high: string; original: string }`.
  - En el panel del lightbox, si `openPhoto.downloads.length > 0`:

```tsx
            <div className="flex items-center gap-2">
              <select value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}
                className="rounded border px-2 py-1.5 text-sm">
                {openPhoto.downloads.map((r) => (
                  <option key={r} value={r}>{labels.resolutions[r]}</option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => void onDownload(openPhoto)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                ⬇ {labels.download}
              </button>
            </div>
```

  con estado `const [resolution, setResolution] = useState<"web" | "high" | "original">(...)` inicializado al abrir el lightbox con `photo.downloads[0] ?? "web"`, y:

```tsx
  async function onDownload(photo: ClientPhoto) {
    try {
      const { url } = await downloadPhotoAction({ slug, photoId: photo.id, resolution });
      window.location.assign(url);
    } catch {
      alert(labels.actionError);
    }
  }
```

- [ ] **Step 4: Mensajes** — dentro de `clientGallery` (es): `"download": "Descargar"`, `"resolutions": { "web": "Web", "high": "Alta resolución", "original": "Original" }`; (en): "Download", { "Web", "High resolution", "Original" }.

- [ ] **Step 5: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add per-photo client downloads with resolution selection"
```

---

### Task 9: ZIP — manifest + action + Cloudflare Worker + UI

**Files:**
- Create: `src/server/zip.ts`
- Create: `workers/zip/wrangler.toml`, `workers/zip/package.json`, `workers/zip/tsconfig.json`, `workers/zip/src/index.ts`
- Modify: `src/app/g/[slug]/actions.ts`, `src/app/g/[slug]/page.tsx`, `src/app/g/[slug]/client-gallery.tsx`, `messages/es.json`, `messages/en.json`, `.gitignore` (si hace falta excluir `workers/zip/node_modules`)
- Test: `tests/server/zip.test.ts`

**Interfaces:**
- Produces:
  - `buildZipManifest(input: { zipName: string; entries: { key: string; name: string }[] }): { zipName: string; files: { key: string; name: string }[] }` — puro; dedupe de nombres (`a.jpg`, `a (1).jpg`, …); lanza `Error("NOTHING_TO_DOWNLOAD")` si entries vacío.
  - `signZipToken(manifestKey: string): Promise<string>` — JWT HS256 con `ZIP_SIGNING_SECRET`, payload `{ m: manifestKey }`, exp 15 min (jose, mismo patrón que client-session; lanza si falta el secret).
  - `zipRequestAction(input: { slug: string; scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }; resolution: Resolution }): Promise<{ url: string }>` — arma la lista (fotos published/ready de secciones visibles; favoritas = likes del cliente), aplica descarga efectiva y `downloadKey` por foto (omite nulls), sube manifest a `studios/{studioId}/galleries/{galleryId}/zips/{uuid}.json`, firma token, evento `download_zip` con metadata, devuelve `${ZIP_WORKER_URL}/?token=…`. `Error("ZIP_NOT_CONFIGURED")` sin envs; `Error("NOTHING_TO_DOWNLOAD")` si no queda nada.
  - Worker `workers/zip`: `GET /?token=…` → 200 ZIP streaming | 401 token inválido | 404 manifest inexistente.

- [ ] **Step 1: Tests failing (puro)** — `tests/server/zip.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ZIP_SIGNING_SECRET = "b".repeat(64);
});

describe("buildZipManifest", () => {
  it("dedupes duplicate names with numeric suffixes", async () => {
    const { buildZipManifest } = await import("@/server/zip");
    const m = buildZipManifest({
      zipName: "boda.zip",
      entries: [
        { key: "k1", name: "IMG_1.jpg" },
        { key: "k2", name: "IMG_1.jpg" },
        { key: "k3", name: "IMG_1.jpg" },
      ],
    });
    expect(m.files.map((f) => f.name)).toEqual(["IMG_1.jpg", "IMG_1 (1).jpg", "IMG_1 (2).jpg"]);
  });
  it("rejects empty manifests", async () => {
    const { buildZipManifest } = await import("@/server/zip");
    expect(() => buildZipManifest({ zipName: "x.zip", entries: [] })).toThrow("NOTHING_TO_DOWNLOAD");
  });
});

describe("signZipToken", () => {
  it("signs a verifiable token carrying the manifest key", async () => {
    const { signZipToken } = await import("@/server/zip");
    const { jwtVerify } = await import("jose");
    const token = await signZipToken("studios/a/zips/m.json");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.ZIP_SIGNING_SECRET));
    expect(payload.m).toBe("studios/a/zips/m.json");
  });
});
```

- [ ] **Step 2: RED**, implementar `src/server/zip.ts`:

```ts
import { SignJWT } from "jose";

export function buildZipManifest(input: {
  zipName: string;
  entries: { key: string; name: string }[];
}): { zipName: string; files: { key: string; name: string }[] } {
  if (input.entries.length === 0) throw new Error("NOTHING_TO_DOWNLOAD");
  const used = new Map<string, number>();
  const files = input.entries.map((e) => {
    const count = used.get(e.name) ?? 0;
    used.set(e.name, count + 1);
    if (count === 0) return { key: e.key, name: e.name };
    const stem = e.name.replace(/\.[^.]+$/, "");
    const ext = e.name.slice(stem.length);
    return { key: e.key, name: `${stem} (${count})${ext}` };
  });
  return { zipName: input.zipName, files };
}

export async function signZipToken(manifestKey: string): Promise<string> {
  const secret = process.env.ZIP_SIGNING_SECRET;
  if (!secret) throw new Error("ZIP_NOT_CONFIGURED");
  return new SignJWT({ m: manifestKey })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}
```

- [ ] **Step 3: Action** — agregar a `src/app/g/[slug]/actions.ts`:

```ts
import { randomUUID } from "node:crypto";
import { likes } from "@/db/schema";
import { buildZipManifest, signZipToken } from "@/server/zip";
import { putObjectBuffer } from "@/server/storage";
import { getClientGalleryData } from "@/server/client-access";

const zipInput = z.object({
  slug: z.string().min(1),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("gallery") }),
    z.object({ type: z.literal("favorites") }),
    z.object({ type: z.literal("section"), sectionId: z.string().uuid() }),
  ]),
  resolution: z.enum(["web", "high", "original"]),
});

export async function zipRequestAction(
  input: { slug: string; scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }; resolution: "web" | "high" | "original" },
): Promise<{ url: string }> {
  const data = zipInput.parse(input);
  const workerUrl = process.env.ZIP_WORKER_URL;
  if (!workerUrl || !process.env.ZIP_SIGNING_SECRET) throw new Error("ZIP_NOT_CONFIGURED");

  const { gallery, clientId } = await requireClientSession(data.slug);
  if (!checkRateLimit(`zip:${clientId}`, 10, 60_000)) throw new Error("RATE_LIMITED");

  const galleryData = await getClientGalleryData(db, gallery.id, clientId);
  if (!enabledResolutions(gallery).includes(data.resolution)) throw new Error("NOT_AVAILABLE");

  const sectionById = new Map(galleryData.sections.map((s) => [s.id, s]));
  let candidates = galleryData.photos;
  if (data.scope.type === "section") {
    candidates = candidates.filter((p) => p.sectionId === (data.scope as { sectionId: string }).sectionId);
  } else if (data.scope.type === "favorites") {
    const liked = new Set(galleryData.likedPhotoIds);
    candidates = candidates.filter((p) => liked.has(p.id));
  }

  const entries: { key: string; name: string }[] = [];
  for (const photo of candidates) {
    const section = photo.sectionId ? sectionById.get(photo.sectionId) ?? null : null;
    if (!effectiveDownloadEnabled(section, gallery)) continue;
    const mode = effectiveWatermarkMode(photo, section, gallery);
    const key = downloadKey(photo, mode, data.resolution);
    if (!key) continue;
    const stem = photo.filename.replace(/\.[^.]+$/, "");
    entries.push({
      key,
      name: data.resolution === "original" ? photo.filename
        : data.resolution === "web" ? `${stem}-web.jpg` : `${stem}-alta.jpg`,
    });
  }

  const manifest = buildZipManifest({
    zipName: `${gallery.title.replace(/[^\w. -]+/g, "_")}.zip`,
    entries,
  });
  const manifestKey = `studios/${gallery.studioId}/galleries/${gallery.id}/zips/${randomUUID()}.json`;
  await putObjectBuffer(manifestKey, Buffer.from(JSON.stringify(manifest)), "application/json");
  const token = await signZipToken(manifestKey);

  await db.insert(activityEvents).values({
    galleryId: gallery.id, clientId, type: "download_zip",
    metadata: { scope: data.scope.type, resolution: data.resolution, count: manifest.files.length },
  });
  return { url: `${workerUrl.replace(/\/$/, "")}/?token=${token}` };
}
```

(imports adicionales: `checkRateLimit` ya importado; `enabledResolutions`, `effectiveDownloadEnabled`, `effectiveWatermarkMode`, `downloadKey` ya importados en Task 8.)

- [ ] **Step 4: Worker** — `workers/zip/wrangler.toml`:

```toml
name = "phonomanager-zip"
main = "src/index.ts"
compatibility_date = "2026-06-01"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "phonomanager"
```

`workers/zip/package.json`:

```json
{
  "name": "phonomanager-zip-worker",
  "private": true,
  "scripts": { "deploy": "wrangler deploy", "dev": "wrangler dev" },
  "dependencies": { "jose": "^6.0.0" },
  "devDependencies": { "wrangler": "^4.0.0", "@cloudflare/workers-types": "^4.0.0", "typescript": "^5.0.0" }
}
```

`workers/zip/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src"]
}
```

`workers/zip/src/index.ts` (completo):

```ts
import { jwtVerify } from "jose";

export interface Env {
  BUCKET: R2Bucket;
  ZIP_SIGNING_SECRET: string;
}

type ManifestFile = { key: string; name: string };
type Manifest = { zipName: string; files: ManifestFile[] };

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

// ---------- little-endian ----------
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function bytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const FLAGS = 0x0808; // bit 3 (data descriptor) + bit 11 (UTF-8)
const DOS_TIME = 0;
const DOS_DATE = 0x5821; // 2024-01-01, valor fijo inofensivo

type CentralEntry = { nameBytes: Uint8Array; crc: number; size: number; offset: number };

async function streamZip(env: Env, manifest: Manifest, writer: WritableStreamDefaultWriter<Uint8Array>) {
  const encoder = new TextEncoder();
  const central: CentralEntry[] = [];
  let offset = 0;

  const write = async (chunk: Uint8Array) => {
    await writer.write(chunk);
    offset += chunk.length;
  };

  for (const file of manifest.files) {
    const object = await env.BUCKET.get(file.key);
    if (!object) continue; // objeto borrado entre firma y descarga: se omite
    const nameBytes = encoder.encode(file.name);
    const entryOffset = offset;

    await write(bytes(
      u32(0x04034b50), u16(20), u16(FLAGS), u16(0), // método store
      u16(DOS_TIME), u16(DOS_DATE), u32(0), u32(0), u32(0), // crc/sizes en descriptor
      u16(nameBytes.length), u16(0), nameBytes,
    ));

    let crc = 0xffffffff;
    let size = 0;
    const reader = object.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32Update(crc, value);
      size += value.length;
      await write(value);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    // data descriptor (32 bits: cada entrada ≤100MB)
    await write(bytes(u32(0x08074b50), u32(crc), u32(size), u32(size)));
    central.push({ nameBytes, crc, size, offset: entryOffset });
  }

  const cdStart = offset;
  for (const e of central) {
    // zip64 extra: usize, csize, offset (los 3 campos de 8 bytes)
    const extra = bytes(u16(0x0001), u16(24), u64(e.size), u64(e.size), u64(e.offset));
    await write(bytes(
      u32(0x02014b50), u16(45), u16(45), u16(FLAGS), u16(0),
      u16(DOS_TIME), u16(DOS_DATE), u32(e.crc),
      u32(0xffffffff), u32(0xffffffff), // sizes → zip64
      u16(e.nameBytes.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0),
      u32(0xffffffff), // offset → zip64
      e.nameBytes, extra,
    ));
  }
  const cdSize = offset - cdStart;

  const eocd64Offset = offset;
  await write(bytes(
    u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
    u64(central.length), u64(central.length), u64(cdSize), u64(cdStart),
  ));
  await write(bytes(u32(0x07064b50), u32(0), u64(eocd64Offset), u32(1)));
  await write(bytes(
    u32(0x06054b50), u16(0), u16(0),
    u16(Math.min(central.length, 0xffff)), u16(Math.min(central.length, 0xffff)),
    u32(0xffffffff), u32(0xffffffff), u16(0),
  ));
  await writer.close();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new Response("missing token", { status: 401 });

    let manifestKey: string;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.ZIP_SIGNING_SECRET));
      if (typeof payload.m !== "string") throw new Error("bad payload");
      manifestKey = payload.m;
    } catch {
      return new Response("invalid token", { status: 401 });
    }

    const manifestObject = await env.BUCKET.get(manifestKey);
    if (!manifestObject) return new Response("manifest not found", { status: 404 });
    const manifest = (await manifestObject.json()) as Manifest;

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    ctx.waitUntil(
      streamZip(env, manifest, writable.getWriter()).catch((e) => {
        console.error("zip stream failed", e);
      }),
    );

    const safeName = manifest.zipName.replace(/[^\x20-\x7e]|"/g, "_");
    return new Response(readable, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  },
};
```

- [ ] **Step 5: UI** — `client-gallery.tsx`:
  - Props nuevas: `zip: { enabled: boolean; resolutions: ("web" | "high" | "original")[] }`, y en Labels: `downloadGallery: string; downloadFavorites: string; downloadSection: string; zipError: string; zipUnavailable: string`.
  - Barra bajo el header (solo si `zip.enabled && zip.resolutions.length > 0`): select de resolución (estado compartido con el del lightbox o uno propio `zipResolution`) + botones "Descargar galería" y "Mis favoritas"; junto a cada `<h2>` de sección un botón pequeño "⬇" con `title={labels.downloadSection}`.
  - Handler:

```tsx
  async function onZip(scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }) {
    try {
      const { url } = await zipRequestAction({ slug, scope, resolution: zipResolution });
      window.location.assign(url);
    } catch (e) {
      const msg = e instanceof Error && e.message.includes("ZIP_NOT_CONFIGURED")
        ? labels.zipUnavailable : labels.zipError;
      alert(msg);
    }
  }
```

  Nota: los mensajes de error de server actions llegan con prefijos de Next en producción — usar `.includes` como arriba y aceptar que en prod caiga al mensaje genérico `zipError` si Next enmascara el mensaje (comportamiento documentado; el fotógrafo sabrá por README que sin worker no hay ZIP).
  - Page: computar `zip = { enabled: photoViews.some((p) => p.downloads.length > 0), resolutions: enabledResolutions(data.gallery) }` y pasar labels nuevos.
- [ ] **Step 6: Mensajes** — `clientGallery` (es): `"downloadGallery": "Descargar galería"`, `"downloadFavorites": "Descargar mis favoritas"`, `"downloadSection": "Descargar esta sección"`, `"zipError": "No hay fotos disponibles para descargar."`, `"zipUnavailable": "La descarga en ZIP no está disponible por ahora."` — equivalentes en inglés.

- [ ] **Step 7: Worker typecheck** (sin desplegar):

```bash
cd workers/zip && npm install && npx tsc --noEmit && cd ../..
```

Expected: sin errores. (No hay tests automatizados del worker: la verificación real es post-deploy en Task 10.)

- [ ] **Step 8: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add zip downloads via Cloudflare Worker with signed manifests"
```

---

### Task 10: Verificación final + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Gate completo**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
cd workers/zip && npx tsc --noEmit && cd ../..
```

- [ ] **Step 2: README** — agregar sección tras "## Acceso de clientes":

```markdown
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
```

- [ ] **Step 3: Verificación manual** (humano + runner donde aplique): subir foto a una galería con texto de marca → variantes `-wm` creadas; cambiar texto → banner de regeneración → progreso → vista cliente muestra marca según modo; overrides de sección/foto; descargar foto suelta en cada resolución; con worker desplegado: ZIP de galería/sección/favoritas. Documentar en el reporte qué quedó pendiente de humano.

- [ ] **Step 4: Commit**

```bash
git add README.md && git commit -m "docs: document watermark, downloads and zip worker deploy"
```

---

## Self-Review (ya aplicado)

- **Cobertura spec F4:** marca de agua configurable con herencia 3 niveles y overrides UI ✓; regeneración en background (lotes cliente-driven con progreso) ✓ + retry de errores ✓; vista cliente con variante correcta decidida server-side y exclusión segura ✓; descargas por foto con resoluciones habilitadas y Content-Disposition ✓; eventos download_photo/download_zip ✓; ZIP galería/sección/favoritas vía Worker streaming R2 con token firmado y manifest en R2 ✓; rate limit en zip ✓. Diferido explícito: marca con imagen/logo; watermark en las descargas del ADMIN (el fotógrafo descarga desde su gestor F2 sin marca — es el dueño); revocación de sesión por cambio de contraseña (ledger F3).
- **Placeholders:** ninguno.
- **Consistencia de tipos:** `Resolution`/`WatermarkMode`/`PhotoKeys` definidos en T3 y usados idénticos en T7/T8/T9; `completeProcessing` extendido en T4 coincide con `processPhoto`; claves fijas de variantes idénticas en T4 (constraints) y globales.
