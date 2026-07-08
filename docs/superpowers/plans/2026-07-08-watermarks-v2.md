# PhonoManager Marcas de agua v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set global de hasta 3 marcas de agua por estudio (texto o PNG, con opacidad/tamaño/posición propias) configurado en `/admin/settings` con preview del pipeline real, reemplazando el texto único por galería.

**Architecture:** Tabla `watermarks` por estudio + dominio con invalidación transaccional de variantes. El renderer convierte cada marca en un PNG overlay (texto→SVG rasterizado; logo→alfa multiplicado) y compone con `gravity` (grid 3×3, margen 2%) o `tile:true` (mosaico rotado −30°). El gate de delivery pasa de `gallery.watermarkText` a `hasWatermarks` (estudio tiene ≥1 marca). Migración final retira las columnas viejas de `galleries` convirtiendo el texto existente en una marca de mosaico.

**Tech Stack:** Lo existente (sharp, drizzle, jose ya instalados). Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-07-08-watermarks-v2-design.md`

## Global Constraints

- `watermarks`: máx 3 por estudio (slots 0..2, unique (studioId, slot)); `type` text|image; `text` 1..100 (requerido si text); `imageKey` requerido si image y DEBE empezar con `studios/{studioId}/watermarks/` (validado en dominio); `opacityPct` int 5..100; `sizePct` int 5..50 (% del ANCHO de la foto); `placement` ∈ {tl,tc,tr,ml,center,mr,bl,bc,br,tile}.
- TODA mutación del set (save/delete) anula `thumb_wm_key/web_wm_key/high_wm_key` de TODAS las fotos del estudio EN LA MISMA transacción.
- Render: posiciones del grid con gravity + margen 2% del ancho; `tile` = overlay rotado −30° con gap transparente, `tile:true` de sharp; overlays nunca mayores que la imagen base (recortar a `fit:inside` si excede). Variantes `-wm` se generan sii el estudio tiene ≥1 marca. Claves fijas `{dir}/…-wm.jpg` sin cambios.
- Gate delivery: `effectiveWatermarkMode(photo, section, gallery: { watermarkMode; hasWatermarks })` — sin marcas → SIEMPRE "none". Fail-closed intacto (sin variante requerida → foto excluida / NOT_AVAILABLE).
- Logos: PNG only, máx 5 MB, subida con presign (mismo flujo de fotos); al reemplazar/eliminar slot se borran los objetos R2 huérfanos.
- Preview: `POST /api/watermarks/preview` aplica `applyWatermarks` REAL sobre `public/watermark-sample.jpg` (committeada, ~1600px); requireStudio; imageKeys solo del prefijo del propio estudio; respuesta image/jpeg no-store; cliente con debounce ~500 ms.
- Migración final: convierte el `watermark_text` de la galería más reciente por estudio en marca `text/tile/35/15` slot 0 (solo si el estudio no tiene marcas), luego DROP de `watermark_text` y `watermark_image_key`.
- i18n es/en paridad; TS strict; TDD en dominio y renderer; gate por task: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` sin warnings.
- Multi-tenant: todo el dominio filtra por studioId con tests intruder.

---

### Task 1: Tabla `watermarks` + dominio CRUD con invalidación

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0004_*.sql` (generada), `src/server/watermarks.ts`
- Test: `tests/server/watermarks.test.ts`

**Interfaces:**
- Produces (Tasks 3/4/5 consumen — firmas exactas):
  - Schema: tabla `watermarks` + enums; tipo `Watermark` exportado; `PLACEMENTS` const y `type Placement`.
  - `listWatermarks(db: Db, studioId: string): Promise<Watermark[]>` (orden por slot).
  - `saveWatermark(db: Db, studioId: string, input: WatermarkInput): Promise<{ watermark: Watermark; replacedImageKey: string | null }>` — upsert por (studioId, slot); `replacedImageKey` = imageKey anterior si era distinto (para que el caller borre el objeto R2).
  - `deleteWatermark(db: Db, studioId: string, slot: number): Promise<{ removedImageKey: string | null }>` — `Error("NOT_FOUND")` si el slot no existe.
  - `type WatermarkInput = { slot: number; type: "text" | "image"; text: string | null; imageKey: string | null; opacityPct: number; sizePct: number; placement: Placement }`.
  - Ambos mutadores invalidan las claves `-wm` de todas las fotos del estudio dentro de `db.transaction`.

- [ ] **Step 1: Schema** — en `src/db/schema.ts`, junto a los demás enums y después de la tabla `apiKeys`:

```ts
export const watermarkTypeEnum = pgEnum("watermark_type", ["text", "image"]);
export const watermarkPlacementEnum = pgEnum("watermark_placement", [
  "tl", "tc", "tr", "ml", "center", "mr", "bl", "bc", "br", "tile",
]);

export const watermarks = pgTable("watermarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  slot: integer("slot").notNull(),
  type: watermarkTypeEnum("type").notNull(),
  text: text("text"),
  imageKey: text("image_key"),
  opacityPct: integer("opacity_pct").notNull(),
  sizePct: integer("size_pct").notNull(),
  placement: watermarkPlacementEnum("placement").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("watermarks_studio_slot_idx").on(t.studioId, t.slot)]);

export type Watermark = typeof watermarks.$inferSelect;
```

```bash
npm run db:generate
sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'
```

Expected: `drizzle/0004_*.sql` con CREATE TYPE ×2 + CREATE TABLE + índice único; aplicada a Neon.

- [ ] **Step 2: Tests failing** — `tests/server/watermarks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery } from "@/server/galleries";
import { photos } from "@/db/schema";
import { listWatermarks, saveWatermark, deleteWatermark } from "@/server/watermarks";

const textInput = (slot = 0) => ({
  slot, type: "text" as const, text: "© Isaac", imageKey: null,
  opacityPct: 35, sizePct: 15, placement: "tile" as const,
});

describe("watermarks domain", () => {
  it("saves, lists ordered by slot, and upserts in place", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await saveWatermark(db, studio.id, { ...textInput(1), placement: "br" });
    await saveWatermark(db, studio.id, textInput(0));
    const list = await listWatermarks(db, studio.id);
    expect(list.map((w) => w.slot)).toEqual([0, 1]);

    const { watermark } = await saveWatermark(db, studio.id, { ...textInput(0), text: "© Nuevo", opacityPct: 50 });
    expect(watermark.text).toBe("© Nuevo");
    expect(await listWatermarks(db, studio.id)).toHaveLength(2); // upsert, no duplica
  });

  it("validates ranges, slot bounds and type coherence", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await expect(saveWatermark(db, studio.id, { ...textInput(3) })).rejects.toThrow(); // slot 0..2
    await expect(saveWatermark(db, studio.id, { ...textInput(0), opacityPct: 4 })).rejects.toThrow();
    await expect(saveWatermark(db, studio.id, { ...textInput(0), sizePct: 51 })).rejects.toThrow();
    await expect(saveWatermark(db, studio.id, { ...textInput(0), text: null })).rejects.toThrow(); // text requiere text
    await expect(saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: null,
      opacityPct: 50, sizePct: 20, placement: "br",
    })).rejects.toThrow(); // image requiere imageKey
  });

  it("enforces the studio prefix on image keys and reports replaced keys", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const goodKey = `studios/${studio.id}/watermarks/a.png`;
    await expect(saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: "studios/OTRO/watermarks/x.png",
      opacityPct: 50, sizePct: 20, placement: "br",
    })).rejects.toThrow("INVALID_IMAGE_KEY");

    const first = await saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: goodKey,
      opacityPct: 50, sizePct: 20, placement: "br",
    });
    expect(first.replacedImageKey).toBeNull();

    const second = await saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: `studios/${studio.id}/watermarks/b.png`,
      opacityPct: 50, sizePct: 20, placement: "br",
    });
    expect(second.replacedImageKey).toBe(goodKey);
  });

  it("invalidates all studio wm keys on save and delete", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda" });
    const [p] = await db.insert(photos).values({
      galleryId: g.id, filename: "a.jpg", originalKey: "k/orig-a.jpg",
      thumbWmKey: "k/thumb-wm.jpg", webWmKey: "k/web-wm.jpg", highWmKey: "k/high-wm.jpg",
    }).returning();

    await saveWatermark(db, studio.id, textInput(0));
    let [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();
    expect(after.thumbWmKey).toBeNull();
    expect(after.highWmKey).toBeNull();

    await db.update(photos).set({ webWmKey: "k/web-wm.jpg" }).where(eq(photos.id, p.id));
    await deleteWatermark(db, studio.id, 0);
    [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();
    await expect(deleteWatermark(db, studio.id, 0)).rejects.toThrow("NOT_FOUND");
  });

  it("is tenant-scoped", async () => {
    const db = await createTestDb();
    const a = await seedStudio(db, "auth0|wm-a");
    const b = await seedStudio(db, "auth0|wm-b");
    await saveWatermark(db, a.id, textInput(0));
    expect(await listWatermarks(db, b.id)).toHaveLength(0);
    await expect(deleteWatermark(db, b.id, 0)).rejects.toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 3: RED** — `npx vitest run tests/server/watermarks.test.ts` → FAIL módulo inexistente.

- [ ] **Step 4: Implementar** — `src/server/watermarks.ts`:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { watermarks, photos, galleries, type Watermark } from "@/db/schema";

export const PLACEMENTS = ["tl", "tc", "tr", "ml", "center", "mr", "bl", "bc", "br", "tile"] as const;
export type Placement = (typeof PLACEMENTS)[number];

const inputSchema = z.object({
  slot: z.number().int().min(0).max(2),
  type: z.enum(["text", "image"]),
  text: z.string().trim().min(1).max(100).nullable(),
  imageKey: z.string().min(1).nullable(),
  opacityPct: z.number().int().min(5).max(100),
  sizePct: z.number().int().min(5).max(50),
  placement: z.enum(PLACEMENTS),
}).refine((w) => (w.type === "text" ? !!w.text : !!w.imageKey), {
  message: "text requiere texto; image requiere imageKey",
});
export type WatermarkInput = z.infer<typeof inputSchema>;

export async function listWatermarks(db: Db, studioId: string): Promise<Watermark[]> {
  return db.select().from(watermarks)
    .where(eq(watermarks.studioId, studioId))
    .orderBy(asc(watermarks.slot));
}

async function clearStudioWatermarkKeys(db: Db, studioId: string): Promise<void> {
  await db.update(photos)
    .set({ thumbWmKey: null, webWmKey: null, highWmKey: null })
    .where(inArray(
      photos.galleryId,
      db.select({ id: galleries.id }).from(galleries).where(eq(galleries.studioId, studioId)),
    ));
}

export async function saveWatermark(
  db: Db, studioId: string, input: WatermarkInput,
): Promise<{ watermark: Watermark; replacedImageKey: string | null }> {
  const data = inputSchema.parse(input);
  if (data.type === "image" && !data.imageKey!.startsWith(`studios/${studioId}/watermarks/`)) {
    throw new Error("INVALID_IMAGE_KEY");
  }
  const values = {
    studioId,
    slot: data.slot,
    type: data.type,
    text: data.type === "text" ? data.text : null,
    imageKey: data.type === "image" ? data.imageKey : null,
    opacityPct: data.opacityPct,
    sizePct: data.sizePct,
    placement: data.placement,
  };
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(watermarks)
      .where(and(eq(watermarks.studioId, studioId), eq(watermarks.slot, data.slot)));
    const [watermark] = await tx.insert(watermarks).values(values)
      .onConflictDoUpdate({ target: [watermarks.studioId, watermarks.slot], set: values })
      .returning();
    await clearStudioWatermarkKeys(tx, studioId);
    const replacedImageKey =
      existing?.imageKey && existing.imageKey !== watermark.imageKey ? existing.imageKey : null;
    return { watermark, replacedImageKey };
  });
}

export async function deleteWatermark(
  db: Db, studioId: string, slot: number,
): Promise<{ removedImageKey: string | null }> {
  const parsedSlot = z.number().int().min(0).max(2).parse(slot);
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(watermarks)
      .where(and(eq(watermarks.studioId, studioId), eq(watermarks.slot, parsedSlot)))
      .returning();
    if (deleted.length === 0) throw new Error("NOT_FOUND");
    await clearStudioWatermarkKeys(tx, studioId);
    return { removedImageKey: deleted[0].imageKey };
  });
}
```

- [ ] **Step 5: GREEN + gate + commit**

```bash
npx vitest run tests/server/watermarks.test.ts && npm test && npx tsc --noEmit
git add -A && git commit -m "feat: add studio watermark set domain with transactional invalidation"
```

---

### Task 2: Renderer de overlays (`applyWatermarks` + `makeDerivatives` v2)

**Files:**
- Modify: `src/server/images.ts` (reescritura de la parte de marcas; `processImage` LEGACY se ELIMINA — ya nada lo usa)
- Test: `tests/server/images.test.ts` (reescritura de los tests de marca)

**Interfaces:**
- Produces (Tasks 3/5 consumen):
  - `type WatermarkPlacement = "tl"|"tc"|"tr"|"ml"|"center"|"mr"|"bl"|"bc"|"br"|"tile"`.
  - `type WatermarkSpec = { type: "text" | "image"; text?: string | null; imageBuffer?: Buffer | null; opacityPct: number; sizePct: number; placement: WatermarkPlacement }`.
  - `applyWatermarks(image: Buffer, specs: WatermarkSpec[]): Promise<Buffer>` — compone las ≤3 marcas; lanza `INVALID_IMAGE` con buffer no-imagen.
  - `makeDerivatives(original: Buffer, opts: { watermarks: WatermarkSpec[] }): Promise<DerivativeSet>` — `-wm` no-null sii `opts.watermarks.length > 0`; resto igual (thumb/web/high, EXIF, orientación, INVALID_IMAGE).
  - Se ELIMINAN: `applyWatermark(image, text)`, `processImage`, `ProcessedImage`.

- [ ] **Step 1: Reescribir tests de marca** — en `tests/server/images.test.ts`, ELIMINAR los tests de `processImage` y los de `applyWatermark`/texto antiguos, conservar `makeJpeg`, y dejar:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { makeDerivatives, applyWatermarks, type WatermarkSpec } from "@/server/images";

async function makeJpeg(width: number, height: number, color = { r: 0, g: 0, b: 0 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

async function makePngLogo(size = 200): Promise<Buffer> {
  // cuadrado blanco opaco con transparencia alrededor
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
}

const textSpec = (over: Partial<WatermarkSpec> = {}): WatermarkSpec => ({
  type: "text", text: "© Isaac", imageBuffer: null,
  opacityPct: 60, sizePct: 25, placement: "br", ...over,
});

const quadMeans = async (img: Buffer, w: number, h: number) => {
  const q = (left: number, top: number) =>
    sharp(img).extract({ left, top, width: w / 2, height: h / 2 }).stats();
  const [tl, tr, bl, br] = await Promise.all([q(0, 0), q(w / 2, 0), q(0, h / 2), q(w / 2, h / 2)]);
  return { tl: tl.channels[0].mean, tr: tr.channels[0].mean, bl: bl.channels[0].mean, br: br.channels[0].mean };
};

describe("applyWatermarks", () => {
  it("places a text mark in the requested corner and not in the opposite one", async () => {
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [textSpec({ placement: "br" })]);
    const m = await quadMeans(marked, 1200, 800);
    expect(m.br).toBeGreaterThan(1);
    expect(m.br).toBeGreaterThan(m.tl * 5 + 0.5);
  });

  it("tiles across all quadrants with placement tile", async () => {
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [textSpec({ placement: "tile", opacityPct: 40 })]);
    const m = await quadMeans(marked, 1200, 800);
    for (const v of Object.values(m)) expect(v).toBeGreaterThan(0.5);
  });

  it("higher opacity produces brighter marks", async () => {
    const lo = await applyWatermarks(await makeJpeg(800, 600), [textSpec({ opacityPct: 10, placement: "center" })]);
    const hi = await applyWatermarks(await makeJpeg(800, 600), [textSpec({ opacityPct: 90, placement: "center" })]);
    expect((await sharp(hi).stats()).channels[0].mean)
      .toBeGreaterThan((await sharp(lo).stats()).channels[0].mean * 2);
  });

  it("composes image marks with size and opacity", async () => {
    const logo = await makePngLogo();
    const spec: WatermarkSpec = {
      type: "image", text: null, imageBuffer: logo,
      opacityPct: 50, sizePct: 20, placement: "tl",
    };
    const marked = await applyWatermarks(await makeJpeg(1000, 700), [spec]);
    const m = await quadMeans(marked, 1000, 700);
    expect(m.tl).toBeGreaterThan(m.br * 5 + 0.5);
    // 50% de opacidad sobre negro: el cuadrante no llega al blanco puro
    expect(m.tl).toBeLessThan(200);
  });

  it("applies up to three marks at once", async () => {
    const logo = await makePngLogo();
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [
      textSpec({ placement: "tl" }),
      textSpec({ placement: "br", text: "www.isaac.mx" }),
      { type: "image", text: null, imageBuffer: logo, opacityPct: 40, sizePct: 15, placement: "center" },
    ]);
    const m = await quadMeans(marked, 1200, 800);
    expect(m.tl).toBeGreaterThan(1);
    expect(m.br).toBeGreaterThan(1);
  });

  it("rejects non-image buffers", async () => {
    await expect(applyWatermarks(Buffer.from("nope"), [textSpec()])).rejects.toThrow("INVALID_IMAGE");
  });
});

describe("makeDerivatives", () => {
  it("produces thumb/web/high and wm variants only with specs", async () => {
    const withWm = await makeDerivatives(await makeJpeg(5000, 3000, { r: 180, g: 40, b: 40 }), {
      watermarks: [textSpec({ placement: "tile" })],
    });
    expect(Math.max((await sharp(withWm.high).metadata()).width!, (await sharp(withWm.high).metadata()).height!)).toBe(4096);
    expect(withWm.webWm).not.toBeNull();
    expect(Buffer.compare(withWm.web, withWm.webWm!)).not.toBe(0);

    const clean = await makeDerivatives(await makeJpeg(800, 600), { watermarks: [] });
    expect(clean.thumbWm).toBeNull();
    expect(clean.webWm).toBeNull();
    expect(clean.highWm).toBeNull();
  });

  it("keeps EXIF orientation and capture-date behavior", async () => {
    const rotated = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await makeDerivatives(rotated, { watermarks: [] });
    expect(out.width).toBe(600);
    expect(out.height).toBe(800);

    const withDate = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withExif({ IFD0: { DateTime: "2026:05:01 10:00:00" } }).toBuffer();
    expect((await makeDerivatives(withDate, { watermarks: [] })).takenAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/server/images.test.ts` → FAIL (API nueva inexistente).

- [ ] **Step 3: Implementar** — reescribir la sección de marcas de `src/server/images.ts` (conservar `extractTakenAt`, constantes, `DerivativeSet`; eliminar `processImage`, `ProcessedImage`, `applyWatermark`, `watermarkSvg` viejos):

```ts
export type WatermarkPlacement =
  | "tl" | "tc" | "tr" | "ml" | "center" | "mr" | "bl" | "bc" | "br" | "tile";

export type WatermarkSpec = {
  type: "text" | "image";
  text?: string | null;
  imageBuffer?: Buffer | null;
  opacityPct: number;
  sizePct: number;
  placement: WatermarkPlacement;
};

const GRAVITY: Record<Exclude<WatermarkPlacement, "tile">, string> = {
  tl: "northwest", tc: "north", tr: "northeast",
  ml: "west", center: "centre", mr: "east",
  bl: "southwest", bc: "south", br: "southeast",
};

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function textSvg(text: string, targetW: number, opacityPct: number): Buffer {
  const len = Math.max(text.length, 1);
  const fontSize = Math.max(12, Math.floor(targetW / (0.6 * len)));
  const width = Math.ceil(0.6 * fontSize * len) + fontSize;
  const height = Math.ceil(fontSize * 1.6);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${fontSize / 2}" y="${fontSize * 1.15}" font-family="Helvetica, Arial, sans-serif" ` +
      `font-size="${fontSize}" fill="white" fill-opacity="${opacityPct / 100}">${escapeXml(text)}</text></svg>`,
  );
}

// multiplica el canal alfa de un PNG por opacityPct/100
async function withOpacity(png: Buffer, opacityPct: number): Promise<Buffer> {
  if (opacityPct >= 100) return sharp(png).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const factor = opacityPct / 100;
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * factor);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// garantiza que el overlay cabe dentro de la base (sharp exige overlay ≤ base)
async function fitWithin(png: Buffer, maxW: number, maxH: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  if ((meta.width ?? 0) <= maxW && (meta.height ?? 0) <= maxH) return png;
  return sharp(png).resize(maxW, maxH, { fit: "inside" }).png().toBuffer();
}

async function overlayFor(
  spec: WatermarkSpec, photoW: number, photoH: number,
): Promise<{ input: Buffer; gravity?: string; tile?: boolean }> {
  const targetW = Math.max(16, Math.round((photoW * spec.sizePct) / 100));

  let png: Buffer;
  if (spec.type === "text") {
    png = await sharp(textSvg(spec.text ?? "", targetW, spec.opacityPct)).png().toBuffer();
  } else {
    const resized = await sharp(spec.imageBuffer!).resize({ width: targetW }).png().toBuffer();
    png = await withOpacity(resized, spec.opacityPct);
  }

  if (spec.placement === "tile") {
    const rotated = await sharp(png)
      .rotate(-30, { background: TRANSPARENT })
      .png().toBuffer();
    const meta = await sharp(rotated).metadata();
    const gapX = Math.round((meta.width ?? targetW) * 0.6);
    const gapY = Math.round((meta.height ?? targetW) * 0.8);
    const padded = await sharp(rotated)
      .extend({ top: gapY, bottom: 0, left: gapX, right: 0, background: TRANSPARENT })
      .png().toBuffer();
    return { input: await fitWithin(padded, photoW, photoH), tile: true };
  }

  const margin = Math.max(4, Math.round(photoW * 0.02));
  const padded = await sharp(png)
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: TRANSPARENT })
    .png().toBuffer();
  return { input: await fitWithin(padded, photoW, photoH), gravity: GRAVITY[spec.placement] };
}

export async function applyWatermarks(image: Buffer, specs: WatermarkSpec[]): Promise<Buffer> {
  let meta: Metadata;
  try {
    meta = await sharp(image).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");
  if (specs.length === 0) return image;

  const overlays = [];
  for (const spec of specs) overlays.push(await overlayFor(spec, meta.width, meta.height));
  return sharp(image).composite(overlays).jpeg({ quality: 85 }).toBuffer();
}
```

Y `makeDerivatives` cambia su firma y bloque de marcas:

```ts
export async function makeDerivatives(
  original: Buffer, opts: { watermarks: WatermarkSpec[] },
): Promise<DerivativeSet> {
  // ... (metadata + INVALID_IMAGE + resize thumb/web/high idénticos a hoy) ...

  let thumbWm: Buffer | null = null;
  let webWm: Buffer | null = null;
  let highWm: Buffer | null = null;
  if (opts.watermarks.length > 0) {
    [thumbWm, webWm, highWm] = await Promise.all([
      applyWatermarks(thumb, opts.watermarks),
      applyWatermarks(web, opts.watermarks),
      applyWatermarks(high, opts.watermarks),
    ]);
  }
  // ... (return idéntico) ...
}
```

Nota: `src/server/processing.ts` deja de compilar en esta task (llama a `makeDerivatives` con `{ watermarkText }`). Para mantener el gate verde, en ESTA task hacer el cambio mínimo en `processing.ts`: reemplazar la carga del texto por `const specs: WatermarkSpec[] = [];` con un comentario `// Task 3 conecta las marcas del estudio` y `makeDerivatives(original, { watermarks: specs })` — las variantes wm dejan de generarse temporalmente (una task), sin romper nada más. El chequeo `FILE_TOO_LARGE` y el resto de processing quedan intactos.

- [ ] **Step 4: GREEN + gate + commit**

```bash
npx vitest run tests/server/images.test.ts && npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: rewrite watermark renderer as per-mark overlays (text/image, opacity, size, placement)"
```

---

### Task 3: Cutover — processing con marcas del estudio + gate `hasWatermarks`

**Files:**
- Modify: `src/server/processing.ts`, `src/server/delivery.ts`, `src/server/galleries.ts` (quitar invalidación por cambio de texto), `src/app/g/[slug]/page.tsx`, `src/app/g/[slug]/actions.ts`, `src/app/admin/galleries/[id]/page.tsx`
- Test: `tests/server/delivery.test.ts` (gate), `tests/server/galleries.test.ts` (quitar test de invalidación por texto)

**Interfaces:**
- Consumes: `listWatermarks` (T1), `applyWatermarks`/`WatermarkSpec` (T2), `getObjectBuffer`.
- Produces:
  - `effectiveWatermarkMode(photo, section, gallery: { watermarkMode: WatermarkMode; hasWatermarks: boolean }): WatermarkMode` — reemplaza `watermarkText` por `hasWatermarks` en el tipo del tercer parámetro. `clientViewPhotos(photos, sections, gallery: { watermarkMode: WatermarkMode; hasWatermarks: boolean })` idem.
  - `processPhoto` genera variantes `-wm` sii `listWatermarks(db, gallery.studioId).length > 0`, construyendo los specs (logos descargados de R2 una vez por invocación con un `Map<string, Buffer>`).

- [ ] **Step 1: Tests del gate (RED primero)** — en `tests/server/delivery.test.ts`, reemplazar todas las construcciones `gal()` que usaban `watermarkText` por `hasWatermarks`:

```ts
const gal = (over = {}) => ({ watermarkMode: "view" as const, hasWatermarks: true, ...over });
// y el caso "is none without watermark text..." pasa a:
  it("is none when the studio has no watermarks regardless of settings", () => {
    expect(effectiveWatermarkMode({ watermarkOverride: true }, { watermarkMode: "both" }, gal({ hasWatermarks: false }))).toBe("none");
  });
// clientViewPhotos: tercer argumento { watermarkMode: "none", hasWatermarks: true }
```

Run → FAIL (tipos actuales usan watermarkText).

- [ ] **Step 2: delivery.ts** — cambiar el tipo del parámetro gallery en `effectiveWatermarkMode` y `clientViewPhotos` a `{ watermarkMode: WatermarkMode; hasWatermarks: boolean }` y la primera línea del gate a `if (!gallery.hasWatermarks) return "none";`. GREEN de delivery.

- [ ] **Step 3: processing.ts** — reemplazar el stub de la Task 2:

```ts
import { listWatermarks } from "./watermarks";
import { applyWatermarks, makeDerivatives, type WatermarkSpec } from "./images"; // ajustar imports reales

  const marks = await listWatermarks(db, gallery.studioId);
  const logoCache = new Map<string, Buffer>();
  const specs: WatermarkSpec[] = [];
  for (const mark of marks) {
    let imageBuffer: Buffer | null = null;
    if (mark.type === "image" && mark.imageKey) {
      if (!logoCache.has(mark.imageKey)) logoCache.set(mark.imageKey, await getObjectBuffer(mark.imageKey));
      imageBuffer = logoCache.get(mark.imageKey)!;
    }
    specs.push({
      type: mark.type, text: mark.text, imageBuffer,
      opacityPct: mark.opacityPct, sizePct: mark.sizePct,
      placement: mark.placement,
    });
  }
  const set = await makeDerivatives(original, { watermarks: specs });
```

(el resto de processPhoto — claves fijas, limpieza de `-wm` obsoletas con `!set.thumbWm`, tamaños, completeProcessing — no cambia).

- [ ] **Step 4: Consumidores** —
  - `src/app/g/[slug]/page.tsx`: `const hasWatermarks = (await listWatermarks(db, data.gallery.studioId)).length > 0;` y pasar `{ watermarkMode: data.gallery.watermarkMode, hasWatermarks }` a `clientViewPhotos` (import de `listWatermarks`).
  - `src/app/g/[slug]/actions.ts` (`downloadPhotoAction` y `zipRequestAction`): calcular `hasWatermarks` igual (tras obtener gallery) y pasar `{ watermarkMode: gallery.watermarkMode, hasWatermarks }` a `effectiveWatermarkMode` en TODOS los call sites.
  - `src/app/admin/galleries/[id]/page.tsx`: `const hasWatermarks = (await listWatermarks(db, studio.id)).length > 0;` y la heurística pasa a `(p.status === "ready" && (hasWatermarks ? !p.webWmKey : !!p.webWmKey))`.
- [ ] **Step 5: galleries.ts** — ELIMINAR el bloque de invalidación por cambio de `watermarkText` en `updateGallerySettings` (la transacción con `db.update(photos)...`) — la invalidación vive ahora en el dominio de watermarks (T1) — y eliminar el test "clears watermark variant keys when the watermark text changes" de `tests/server/galleries.test.ts`. El CAMPO `watermarkText` sigue aceptándose (se retira en T6).

- [ ] **Step 6: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: cut watermark pipeline and delivery gate over to the studio watermark set"
```

---

### Task 4: Página `/admin/settings` — editor de slots + subida de logos

**Files:**
- Create: `src/app/api/watermarks/upload-url/route.ts`, `src/app/admin/settings/page.tsx`, `src/app/admin/settings/actions.ts`, `src/app/admin/settings/watermark-editor.tsx`
- Modify: `src/app/admin/layout.tsx` (enlace), `messages/es.json`, `messages/en.json`
- Test: no unit nuevos (UI + actions delgadas sobre dominio testeado); gates.

**Interfaces:**
- Consumes: dominio T1, `presignUpload(key, contentType, expiresIn?, contentLength?)`, `deleteObjects`.
- Produces:
  - `POST /api/watermarks/upload-url` body `{ filename, size, contentType }` → `{ uploadUrl, key }` (png only, ≤5MB, key `studios/{studioId}/watermarks/{uuid}.png`) | 400 | 401.
  - Actions: `saveWatermarkAction(input: WatermarkInput): Promise<void>` (borra `replacedImageKey` de R2), `deleteWatermarkAction(input: { slot: number }): Promise<void>` (borra `removedImageKey`).
  - `<WatermarkEditor initial={Watermark[]} labels={...} />` cliente (T5 le añade el preview).

- [ ] **Step 1: Route de subida** — `src/app/api/watermarks/upload-url/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireStudio } from "@/server/auth";
import { presignUpload } from "@/server/storage";

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  contentType: z.literal("image/png"),
});

export async function POST(request: Request) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const key = `studios/${studioId}/watermarks/${randomUUID()}.png`;
  const uploadUrl = await presignUpload(key, "image/png", 600, parsed.data.size);
  return NextResponse.json({ uploadUrl, key });
}
```

- [ ] **Step 2: Actions** — `src/app/admin/settings/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { saveWatermark, deleteWatermark, PLACEMENTS, type WatermarkInput } from "@/server/watermarks";
import { deleteObjects } from "@/server/storage";

const saveInput = z.object({
  slot: z.number().int().min(0).max(2),
  type: z.enum(["text", "image"]),
  text: z.string().trim().min(1).max(100).nullable(),
  imageKey: z.string().min(1).nullable(),
  opacityPct: z.number().int().min(5).max(100),
  sizePct: z.number().int().min(5).max(50),
  placement: z.enum(PLACEMENTS),
});

export async function saveWatermarkAction(input: WatermarkInput): Promise<void> {
  const studio = await requireStudio();
  const data = saveInput.parse(input);
  const { replacedImageKey } = await saveWatermark(db, studio.id, data);
  if (replacedImageKey) await deleteObjects([replacedImageKey]);
  revalidatePath("/admin/settings");
}

export async function deleteWatermarkAction(input: { slot: number }): Promise<void> {
  const studio = await requireStudio();
  const { slot } = z.object({ slot: z.number().int().min(0).max(2) }).parse(input);
  const { removedImageKey } = await deleteWatermark(db, studio.id, slot);
  if (removedImageKey) await deleteObjects([removedImageKey]);
  revalidatePath("/admin/settings");
}
```

- [ ] **Step 3: Mensajes** — namespace raíz `settings` en `messages/es.json`:

```json
{
  "settings": {
    "title": "Configuración",
    "watermarks": {
      "title": "Marcas de agua",
      "intro": "Hasta 3 marcas que se aplican a todas tus galerías con marca activa.",
      "regenNote": "Al guardar cambios, las fotos existentes necesitarán actualizarse — verás el banner \"Actualizar fotos\" en cada galería.",
      "add": "+ Agregar marca",
      "slot": "Marca {n}",
      "typeText": "Texto",
      "typeImage": "Imagen (PNG)",
      "textPlaceholder": "© Tu estudio",
      "uploadPng": "Subir PNG",
      "uploading": "Subiendo…",
      "replacePng": "Reemplazar PNG",
      "invalidPng": "Debe ser un PNG de máximo 5 MB.",
      "opacity": "Opacidad",
      "size": "Tamaño",
      "position": "Posición",
      "tile": "Mosaico",
      "save": "Guardar marca",
      "delete": "Eliminar",
      "saved": "Guardada.",
      "incomplete": "Completa el texto o sube un PNG antes de guardar.",
      "error": "No se pudo guardar. Inténtalo de nuevo.",
      "preview": "Vista previa",
      "previewLoading": "Generando vista previa…",
      "previewError": "No se pudo generar la vista previa."
    }
  }
}
```

Equivalente en `messages/en.json` ("Settings", "Watermarks", "Up to 3 marks applied to every gallery with watermarking enabled.", "After saving, existing photos will need updating — you'll see the \"Update photos\" banner in each gallery.", "+ Add mark", "Mark {n}", "Text", "Image (PNG)", "© Your studio", "Upload PNG", "Uploading…", "Replace PNG", "Must be a PNG up to 5 MB.", "Opacity", "Size", "Position", "Tiled", "Save mark", "Delete", "Saved.", "Fill the text or upload a PNG before saving.", "Could not save. Try again.", "Preview", "Generating preview…", "Preview could not be generated."). Y en `adminLayout` (ambos): `"settings": "Configuración"` / `"settings": "Settings"`.

- [ ] **Step 4: Header** — en `src/app/admin/layout.tsx`, junto al enlace de logout:

```tsx
        <nav className="flex items-center gap-4 text-sm">
          <a href="/admin/settings" className="text-neutral-500 hover:text-neutral-900">{t("settings")}</a>
          <a href="/auth/logout" className="text-neutral-500 hover:text-neutral-900">{t("logout")}</a>
        </nav>
```

- [ ] **Step 5: Editor** — `src/app/admin/settings/watermark-editor.tsx` (componente cliente):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWatermarkAction, deleteWatermarkAction } from "./actions";

export type SlotState = {
  slot: number;
  type: "text" | "image";
  text: string;
  imageKey: string | null;
  opacityPct: number;
  sizePct: number;
  placement: string;
  saved: boolean;
};

export type EditorLabels = {
  intro: string; regenNote: string; add: string; slot: string;
  typeText: string; typeImage: string; textPlaceholder: string;
  uploadPng: string; uploading: string; replacePng: string; invalidPng: string;
  opacity: string; size: string; position: string; tile: string;
  save: string; delete: string; saved: string; incomplete: string; error: string;
};

const GRID: string[][] = [["tl", "tc", "tr"], ["ml", "center", "mr"], ["bl", "bc", "br"]];

function newSlot(slot: number): SlotState {
  return { slot, type: "text", text: "", imageKey: null, opacityPct: 40, sizePct: 20, placement: "br", saved: false };
}

export function WatermarkEditor({
  initial, labels, onChange,
}: {
  initial: SlotState[];
  labels: EditorLabels;
  onChange?: (slots: SlotState[]) => void; // el preview (Task 5) se cuelga de aquí
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<number, string>>({});
  const router = useRouter();

  function update(slot: number, patch: Partial<SlotState>) {
    setSlots((prev) => {
      const next = prev.map((s) => (s.slot === slot ? { ...s, ...patch, saved: false } : s));
      onChange?.(next);
      return next;
    });
  }

  async function uploadPng(slot: number, file: File) {
    if (file.type !== "image/png" || file.size > 5 * 1024 * 1024) {
      setStatus((p) => ({ ...p, [slot]: labels.invalidPng }));
      return;
    }
    setBusy(true);
    setStatus((p) => ({ ...p, [slot]: labels.uploading }));
    try {
      const res = await fetch("/api/watermarks/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, contentType: "image/png" }),
      });
      if (!res.ok) throw new Error();
      const { uploadUrl, key } = (await res.json()) as { uploadUrl: string; key: string };
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: file });
      if (!put.ok) throw new Error();
      update(slot, { imageKey: key });
      setStatus((p) => ({ ...p, [slot]: "" }));
    } catch {
      setStatus((p) => ({ ...p, [slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  async function save(state: SlotState) {
    const valid = state.type === "text" ? state.text.trim().length > 0 : !!state.imageKey;
    if (!valid) {
      setStatus((p) => ({ ...p, [state.slot]: labels.incomplete }));
      return;
    }
    setBusy(true);
    try {
      await saveWatermarkAction({
        slot: state.slot,
        type: state.type,
        text: state.type === "text" ? state.text.trim() : null,
        imageKey: state.type === "image" ? state.imageKey : null,
        opacityPct: state.opacityPct,
        sizePct: state.sizePct,
        placement: state.placement as never,
      });
      update(state.slot, { saved: true });
      setStatus((p) => ({ ...p, [state.slot]: labels.saved }));
      router.refresh();
    } catch {
      setStatus((p) => ({ ...p, [state.slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slot: number) {
    setBusy(true);
    try {
      const target = slots.find((s) => s.slot === slot);
      if (target?.saved !== false || initial.some((s) => s.slot === slot)) {
        await deleteWatermarkAction({ slot });
      }
      setSlots((prev) => {
        const next = prev.filter((s) => s.slot !== slot);
        onChange?.(next);
        return next;
      });
      router.refresh();
    } catch {
      setStatus((p) => ({ ...p, [slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  function addSlot() {
    const used = new Set(slots.map((s) => s.slot));
    const free = [0, 1, 2].find((n) => !used.has(n));
    if (free === undefined) return;
    setSlots((prev) => {
      const next = [...prev, newSlot(free)].sort((a, b) => a.slot - b.slot);
      onChange?.(next);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{labels.intro}</p>
      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">{labels.regenNote}</p>

      {slots.map((s) => (
        <div key={s.slot} className="space-y-3 rounded border bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{labels.slot.replace("{n}", String(s.slot + 1))}</h3>
            <button onClick={() => void remove(s.slot)} disabled={busy} className="text-red-600 hover:underline">
              {labels.delete}
            </button>
          </div>

          <div className="flex gap-3">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={s.type === "text"} onChange={() => update(s.slot, { type: "text" })} />
              {labels.typeText}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={s.type === "image"} onChange={() => update(s.slot, { type: "image" })} />
              {labels.typeImage}
            </label>
          </div>

          {s.type === "text" ? (
            <input
              value={s.text} onChange={(e) => update(s.slot, { text: e.target.value })}
              maxLength={100} placeholder={labels.textPlaceholder}
              className="w-full rounded border px-3 py-1.5"
            />
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5">
              {s.imageKey ? labels.replacePng : labels.uploadPng}
              <input
                type="file" accept="image/png" className="hidden" disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadPng(s.slot, f);
                }}
              />
              {s.imageKey && <span className="text-xs text-green-700">✓</span>}
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              {labels.opacity}: {s.opacityPct}%
              <input type="range" min={5} max={100} value={s.opacityPct}
                onChange={(e) => update(s.slot, { opacityPct: Number(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              {labels.size}: {s.sizePct}%
              <input type="range" min={5} max={50} value={s.sizePct}
                onChange={(e) => update(s.slot, { sizePct: Number(e.target.value) })} />
            </label>
          </div>

          <div className="flex items-center gap-4">
            <span>{labels.position}:</span>
            <div className="grid grid-cols-3 gap-1">
              {GRID.flat().map((pos) => (
                <button
                  key={pos}
                  onClick={() => update(s.slot, { placement: pos })}
                  className={`h-6 w-6 rounded border ${s.placement === pos ? "bg-neutral-900" : "bg-neutral-100 hover:bg-neutral-300"}`}
                  aria-label={pos}
                />
              ))}
            </div>
            <button
              onClick={() => update(s.slot, { placement: "tile" })}
              className={`rounded border px-2 py-1 text-xs ${s.placement === "tile" ? "bg-neutral-900 text-white" : ""}`}
            >
              {labels.tile}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => void save(s)} disabled={busy}
              className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">
              {labels.save}
            </button>
            {status[s.slot] && <span className="text-xs text-neutral-600">{status[s.slot]}</span>}
          </div>
        </div>
      ))}

      {slots.length < 3 && (
        <button onClick={addSlot} disabled={busy} className="rounded border px-3 py-1.5 text-sm">
          {labels.add}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Página** — `src/app/admin/settings/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { listWatermarks } from "@/server/watermarks";
import { WatermarkEditor, type SlotState } from "./watermark-editor";

export default async function SettingsPage() {
  const studio = await requireStudio();
  const t = await getTranslations("settings");
  const tw = await getTranslations("settings.watermarks");
  const marks = await listWatermarks(db, studio.id);

  const initial: SlotState[] = marks.map((w) => ({
    slot: w.slot,
    type: w.type,
    text: w.text ?? "",
    imageKey: w.imageKey,
    opacityPct: w.opacityPct,
    sizePct: w.sizePct,
    placement: w.placement,
    saved: true,
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <section>
        <h2 className="mb-4 font-medium">{tw("title")}</h2>
        <WatermarkEditor
          initial={initial}
          labels={{
            intro: tw("intro"), regenNote: tw("regenNote"), add: tw("add"),
            slot: tw.raw("slot") as string, typeText: tw("typeText"), typeImage: tw("typeImage"),
            textPlaceholder: tw("textPlaceholder"), uploadPng: tw("uploadPng"), uploading: tw("uploading"),
            replacePng: tw("replacePng"), invalidPng: tw("invalidPng"),
            opacity: tw("opacity"), size: tw("size"), position: tw("position"), tile: tw("tile"),
            save: tw("save"), delete: tw("delete"), saved: tw("saved"),
            incomplete: tw("incomplete"), error: tw("error"),
          }}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add studio settings page with watermark slot editor and PNG upload"
```

---

### Task 5: Preview con el pipeline real

**Files:**
- Create: `public/watermark-sample.jpg` (generada y committeada), `src/app/api/watermarks/preview/route.ts`, `src/app/admin/settings/watermark-preview.tsx`
- Modify: `src/app/admin/settings/page.tsx` (layout con preview), `src/app/admin/settings/watermark-editor.tsx` (sin cambios de API — ya expone onChange)

**Interfaces:**
- Consumes: `applyWatermarks`/`WatermarkSpec` (T2), `getObjectBuffer`, `requireStudio`, `PLACEMENTS`.
- Produces: `POST /api/watermarks/preview` body `{ specs: [{ type, text, imageKey, opacityPct, sizePct, placement }] }` (≤3) → `image/jpeg` | 400 | 401; `<WatermarkPreview labels />` que recibe slots vía contexto de página.

- [ ] **Step 1: Imagen de muestra** — generar UNA vez con un script temporal en el scratchpad de la sesión y commitear el resultado:

```bash
node - <<'EOF'
const sharp = require("/Users/isaaclopez/phonomanager/node_modules/sharp");
const svg = `<svg width="1600" height="1067" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2b3a55"/><stop offset="0.5" stop-color="#7a6a83"/><stop offset="1" stop-color="#c98d5f"/>
  </linearGradient></defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <circle cx="1250" cy="300" r="180" fill="#f2d16b" opacity="0.9"/>
  <path d="M0 800 Q 400 650 800 800 T 1600 780 V 1067 H 0 Z" fill="#1e2a3a" opacity="0.8"/>
  <path d="M0 900 Q 500 780 1000 900 T 1600 880 V 1067 H 0 Z" fill="#141d29"/>
</svg>`;
sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile("/Users/isaaclopez/phonomanager/public/watermark-sample.jpg")
  .then((i) => console.log("sample ok", i.size, "bytes"));
EOF
```

Expected: `public/watermark-sample.jpg` (~50-120 KB).

- [ ] **Step 2: Endpoint** — `src/app/api/watermarks/preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireStudio } from "@/server/auth";
import { getObjectBuffer } from "@/server/storage";
import { applyWatermarks, type WatermarkSpec } from "@/server/images";
import { PLACEMENTS } from "@/server/watermarks";

export const maxDuration = 30;

const bodySchema = z.object({
  specs: z.array(z.object({
    type: z.enum(["text", "image"]),
    text: z.string().trim().max(100).nullable(),
    imageKey: z.string().nullable(),
    opacityPct: z.number().int().min(5).max(100),
    sizePct: z.number().int().min(5).max(50),
    placement: z.enum(PLACEMENTS),
  })).max(3),
});

export async function POST(request: Request) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const specs: WatermarkSpec[] = [];
  for (const s of parsed.data.specs) {
    if (s.type === "text") {
      if (!s.text) continue; // slot incompleto: se omite del preview
      specs.push({ type: "text", text: s.text, imageBuffer: null, opacityPct: s.opacityPct, sizePct: s.sizePct, placement: s.placement });
    } else {
      if (!s.imageKey) continue;
      if (!s.imageKey.startsWith(`studios/${studioId}/watermarks/`)) {
        return NextResponse.json({ error: "invalid_image_key" }, { status: 400 });
      }
      const imageBuffer = await getObjectBuffer(s.imageKey).catch(() => null);
      if (!imageBuffer) return NextResponse.json({ error: "image_not_found" }, { status: 400 });
      specs.push({ type: "image", text: null, imageBuffer, opacityPct: s.opacityPct, sizePct: s.sizePct, placement: s.placement });
    }
  }

  const sample = await readFile(path.join(process.cwd(), "public", "watermark-sample.jpg"));
  const rendered = await applyWatermarks(sample, specs);
  return new NextResponse(new Uint8Array(rendered), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 3: Componente de preview** — `src/app/admin/settings/watermark-preview.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { SlotState } from "./watermark-editor";

export function WatermarkPreview({
  slots, labels,
}: {
  slots: SlotState[];
  labels: { preview: string; previewLoading: string; previewError: string };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setState("loading");
        try {
          const res = await fetch("/api/watermarks/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              specs: slots.map((s) => ({
                type: s.type,
                text: s.type === "text" ? s.text.trim() || null : null,
                imageKey: s.type === "image" ? s.imageKey : null,
                opacityPct: s.opacityPct,
                sizePct: s.sizePct,
                placement: s.placement,
              })),
            }),
          });
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          setState("idle");
        } catch {
          setState("error");
        }
      })();
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slots]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{labels.preview}</h3>
      <div className="relative overflow-hidden rounded border bg-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt={labels.preview} className="w-full" />}
        {!url && <div className="aspect-[3/2] w-full" />}
        {state === "loading" && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            {labels.previewLoading}
          </span>
        )}
      </div>
      {state === "error" && <p className="text-xs text-red-600">{labels.previewError}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Integrar en la página** — la página necesita compartir el estado de slots entre editor y preview: crear un pequeño wrapper cliente `src/app/admin/settings/watermark-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { WatermarkEditor, type SlotState, type EditorLabels } from "./watermark-editor";
import { WatermarkPreview } from "./watermark-preview";

export function WatermarkSection({
  initial, labels, previewLabels,
}: {
  initial: SlotState[];
  labels: EditorLabels;
  previewLabels: { preview: string; previewLoading: string; previewError: string };
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <WatermarkEditor initial={initial} labels={labels} onChange={setSlots} />
      <WatermarkPreview slots={slots} labels={previewLabels} />
    </div>
  );
}
```

y en `page.tsx` montar `<WatermarkSection initial={initial} labels={{...}} previewLabels={{ preview: tw("preview"), previewLoading: tw("previewLoading"), previewError: tw("previewError") }} />` en lugar del editor directo.

- [ ] **Step 5: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: add real-pipeline watermark preview over a bundled sample image"
```

---

### Task 6: Migración final — retirar `watermark_text`/`watermark_image_key` de galleries

**Files:**
- Modify: `src/db/schema.ts` (quitar 2 columnas), `src/server/galleries.ts` (quitar watermarkText del Zod), `src/app/admin/galleries/[id]/actions.ts` (quitar watermarkText del settingsForm), `src/app/admin/galleries/[id]/page.tsx` (quitar input; agregar nota-enlace), `messages/es.json`, `messages/en.json`
- Create: `drizzle/0005_*.sql` (generada y EDITADA a mano con la migración de datos)
- Test: barrido de tests que referencien `watermarkText` (galleries/photos/client-access/delivery ya migrados en T3; verificar restos)

- [ ] **Step 1: Quitar columnas del schema** — en `src/db/schema.ts`, eliminar `watermarkText` y `watermarkImageKey` de `galleries`. Luego:

```bash
npm run db:generate
```

Expected: `drizzle/0005_*.sql` con los dos `ALTER TABLE "galleries" DROP COLUMN ...`.

- [ ] **Step 2: Editar la migración** — PREPENDER a `drizzle/0005_*.sql` la migración de datos (antes de los DROP):

```sql
INSERT INTO "watermarks" ("studio_id","slot","type","text","opacity_pct","size_pct","placement")
SELECT DISTINCT ON (g."studio_id") g."studio_id", 0, 'text', g."watermark_text", 35, 15, 'tile'
FROM "galleries" g
WHERE g."watermark_text" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "watermarks" w WHERE w."studio_id" = g."studio_id")
ORDER BY g."studio_id", g."updated_at" DESC;--> statement-breakpoint
```

- [ ] **Step 3: Código** — quitar `watermarkText` de `updateGallerySchema` (galleries.ts) y del `settingsForm`/parse de `updateGalleryAction`; en el detalle de galería quitar el `<label>` del texto y junto al select de `watermarkMode` agregar:

```tsx
          <p className="col-span-2 -mt-2 text-xs text-neutral-500">
            {t("watermarkHint")}{" "}
            <Link href="/admin/settings" className="underline">{tActivity("title") /* NO — usar clave propia */}</Link>
          </p>
```

CORRECCIÓN: usar una clave propia — agregar a `galleryDetail` (es): `"watermarkHint": "Las marcas se configuran en"`, `"watermarkHintLink": "Configuración →"`; (en): `"watermarkHint": "Watermarks are configured in"`, `"watermarkHintLink": "Settings →"`; y el JSX correcto:

```tsx
          <p className="col-span-2 -mt-2 text-xs text-neutral-500">
            {t("watermarkHint")}{" "}
            <Link href="/admin/settings" className="underline">{t("watermarkHintLink")}</Link>
          </p>
```

- [ ] **Step 4: Barrido de tests** — `grep -rn "watermarkText" src tests` debe devolver CERO resultados (delivery/galleries ya migraron en T3; limpiar cualquier resto). Ajustar los tests que fallen por el campo eliminado.

- [ ] **Step 5: Aplicar migración + gate + commit**

```bash
sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
grep -rn "watermarkText" src tests || echo "LIMPIO"
git add -A && git commit -m "feat: migrate gallery watermark text into studio set and drop legacy columns"
```

---

### Task 7: Verificación final + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Gate completo**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
cd workers/zip && npx tsc --noEmit && cd ../..
```

- [ ] **Step 2: README** — reemplazar el primer bullet de "## Marca de agua y descargas" por:

```markdown
- Las marcas de agua se configuran en **Configuración** (`/admin/settings`): hasta 3 marcas
  simultáneas, cada una texto o PNG con su opacidad, tamaño (% del ancho) y posición
  (esquinas/bordes/centro o mosaico), con vista previa del render real.
- La galería/sección/foto siguen decidiendo CUÁNDO aplica (modo vista/descarga/ambas).
- Cualquier cambio en el set requiere regenerar: usa el banner "Actualizar fotos" en cada galería.
```

- [ ] **Step 3: Verificación manual** (humano; documentar lo pendiente): en Configuración crear 3 marcas (texto esquina + logo PNG centro + texto mosaico), ver el preview reaccionar a sliders, guardar → banner en galerías → regenerar → vista cliente muestra las 3 marcas; eliminar una marca → banner de nuevo; galería vieja con texto migrado conserva su marca.

- [ ] **Step 4: Commit**

```bash
git add README.md && git commit -m "docs: document studio watermark settings"
```

---

## Self-Review (ya aplicado)

- **Cobertura spec:** tabla + dominio con invalidación transaccional ✓ (T1); renderer texto/imagen con opacidad/tamaño/9 posiciones+mosaico, overlays seguros ✓ (T2); gate hasWatermarks + processPhoto con set del estudio + heurística de banner ✓ (T3); página /admin/settings con slots, subida PNG presignada con prefijo forzado, borrado de huérfanos ✓ (T4); preview real con muestra committeada ✓ (T5); migración de datos + drop + limpieza de UI/Zod ✓ (T6); README ✓ (T7). Fail-closed, claves fijas y regeneración reutilizados sin cambios.
- **Placeholders:** la única corrección marcada (clave i18n del hint) tiene su versión correcta al lado; sin TBD.
- **Consistencia de tipos:** `WatermarkInput`/`Watermark`/`PLACEMENTS` (T1) = usos en T4/T5; `WatermarkSpec`/`applyWatermarks` (T2) = usos en T3/T5; `hasWatermarks` en delivery (T3) = call sites enumerados; `SlotState`/`EditorLabels` (T4) = T5.
