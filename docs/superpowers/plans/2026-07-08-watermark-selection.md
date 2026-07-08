# Selección de marca de agua por galería — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las ≤3 marcas del estudio son ALTERNATIVAS elegibles, no se componen: cada galería selecciona UNA marca (o ninguna) y esa es la que se renderiza.

**Architecture:** Nueva columna `galleries.watermark_id` (FK nullable → watermarks, SET NULL). El gate `hasWatermarks` de delivery conserva su firma pero se computa como `!!gallery.watermarkId`. La invalidación de claves `-wm` se acota: mutar una marca solo afecta a las galerías que la seleccionaron; cambiar la selección de una galería limpia solo esa galería. El preview de Configuración muestra UNA marca a la vez (picker de slot).

**Tech Stack:** Next.js 16 App Router, Drizzle + Neon (PGlite en tests), sharp, next-intl.

## Global Constraints

- Tenant-scoping estricto: `watermarkId` asignado a una galería debe pertenecer al MISMO estudio (validar en dominio → `Error("INVALID_WATERMARK")`); studioId/galleryId siempre de sesión/DB, nunca de input del cliente.
- Invalidación SIEMPRE transaccional con la mutación que la causa.
- Fail-closed de delivery intacto: foto sin variante `-wm` requerida → excluida (sin cambios en viewKeys/downloadKey/clientViewPhotos).
- Migración con `sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'` — NUNCA imprimir `.env.local` ni sus variables.
- i18n: paridad de claves es/en.
- Gate por tarea: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` (cero warnings).

---

### Task 1: Columna de selección + invalidación acotada (dominio + migración 0006)

**Files:**
- Modify: `src/db/schema.ts` (galleries), `src/server/watermarks.ts`, `src/server/galleries.ts`
- Create: `drizzle/0006_*.sql` (generada + data UPDATE al final)
- Test: `tests/server/watermarks.test.ts` (reescribir tests de invalidación), `tests/server/galleries.test.ts` (selección)

**Interfaces:**
- Produces: `galleries.watermarkId: string | null` en el tipo `Gallery`; `updateGallerySettings` acepta `watermarkId?: string | null`; `saveWatermark`/`deleteWatermark` conservan firmas.

- [ ] **Step 1: Schema** — en `src/db/schema.ts`, dentro de `galleries` después de `watermarkMode`:

```ts
  // marca del estudio seleccionada para esta galería (null = sin marca)
  watermarkId: uuid("watermark_id").references((): AnyPgColumn => watermarks.id, { onDelete: "set null" }),
```

(`AnyPgColumn` ya está importado; `watermarks` se define más abajo en el archivo — la forward reference sigue el patrón de `coverPhotoId`.)

- [ ] **Step 2: Migración** — `npx drizzle-kit generate --name gallery_watermark_selection`; al SQL generado (ALTER TABLE + FK) APPEND al final:

```sql
--> statement-breakpoint
UPDATE "galleries" g SET "watermark_id" = w."id"
FROM "watermarks" w
WHERE w."studio_id" = g."studio_id"
  AND w."slot" = (SELECT min(w2."slot") FROM "watermarks" w2 WHERE w2."studio_id" = g."studio_id");
```

(Comportamiento previo: todas las marcas aplicaban a todo; el default más cercano es que cada galería quede con la marca de slot más bajo del estudio.) Aplicar a Neon: `sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'`.

- [ ] **Step 3: Tests RED — invalidación acotada** — en `tests/server/watermarks.test.ts` reemplazar los dos tests de invalidación (`clears photo wm keys...` e `isolates photo wm key invalidation...`) por estos (mismo estilo/helpers del archivo; `pickWatermark` aún no existe → RED):

```ts
import { updateGallerySettings } from "@/server/galleries";
import { galleries } from "@/db/schema";

const WM_KEYS = { thumbWmKey: "t-wm", webWmKey: "w-wm", highWmKey: "h-wm" };

async function seedGalleryWithPhoto(db: Db, studioId: string, title: string) {
  const gallery = await createGallery(db, studioId, { title });
  const [photo] = await db.insert(photos).values({
    galleryId: gallery.id, filename: "a.jpg", originalKey: `studios/${studioId}/${gallery.id}/x/original.jpg`,
    status: "ready", ...WM_KEYS,
  }).returning();
  return { gallery, photo };
}

it("re-saving a mark clears wm keys only in galleries that selected it", async () => {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const { watermark: m0 } = await saveWatermark(db, studio.id, mark({ slot: 0 }));
  const { watermark: m1 } = await saveWatermark(db, studio.id, mark({ slot: 1, text: "otra" }));
  const a = await seedGalleryWithPhoto(db, studio.id, "usa m0");
  const b = await seedGalleryWithPhoto(db, studio.id, "usa m1");
  await updateGallerySettings(db, studio.id, a.gallery.id, { watermarkId: m0.id });
  await updateGallerySettings(db, studio.id, b.gallery.id, { watermarkId: m1.id });
  // reponer claves (la selección las limpió)
  await db.update(photos).set(WM_KEYS);

  await saveWatermark(db, studio.id, mark({ slot: 0, text: "editada" }));

  const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
  const [pb] = await db.select().from(photos).where(eq(photos.id, b.photo.id));
  expect(pa.webWmKey).toBeNull();
  expect(pb.webWmKey).toBe("w-wm");
});

it("creating a brand-new mark clears nothing", async () => {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const a = await seedGalleryWithPhoto(db, studio.id, "g");
  await saveWatermark(db, studio.id, mark({ slot: 2 }));
  const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
  expect(pa.webWmKey).toBe("w-wm");
});

it("deleting a mark clears selectors' wm keys and nulls their selection", async () => {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const { watermark: m0 } = await saveWatermark(db, studio.id, mark({ slot: 0 }));
  const a = await seedGalleryWithPhoto(db, studio.id, "usa m0");
  await updateGallerySettings(db, studio.id, a.gallery.id, { watermarkId: m0.id });
  await db.update(photos).set(WM_KEYS);

  await deleteWatermark(db, studio.id, 0);

  const [ga] = await db.select().from(galleries).where(eq(galleries.id, a.gallery.id));
  const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
  expect(ga.watermarkId).toBeNull();
  expect(pa.webWmKey).toBeNull();
});
```

(`mark()` = el helper/objeto de input válido que el archivo ya usa para construir WatermarkInput; reutilizarlo o crearlo si tiene otro nombre. El test intruder de estudios existente se adapta igual: estudio B con galería que seleccionó su propia marca → intacta.)

- [ ] **Step 4: Tests RED — selección en galleries** — en `tests/server/galleries.test.ts` añadir:

```ts
it("rejects selecting a watermark from another studio", async () => {
  const db = await createTestDb();
  const s1 = await seedStudio(db);
  const s2 = await seedStudio(db, { auth0Sub: "auth0|otro", email: "otro@x.com" });
  const { watermark } = await saveWatermark(db, s2.id, /* input válido tipo text */);
  const g = await createGallery(db, s1.id, { title: "mía" });
  await expect(updateGallerySettings(db, s1.id, g.id, { watermarkId: watermark.id }))
    .rejects.toThrow("INVALID_WATERMARK");
});

it("changing the selection clears the gallery's wm keys; same value does not", async () => {
  // A→B limpia; B→B no limpia (verificar con claves repuestas entre pasos, patrón del test viejo de watermarkText)
});
```

(Escribir el segundo test completo con el mismo patrón seed de fotos del Step 3; usar los seeds de `seedStudio` con overrides si el helper los soporta — revisar `tests/helpers/db.ts` y ajustar la creación del segundo estudio a lo que el helper permita.)

- [ ] **Step 5: watermarks.ts GREEN** — reemplazar `clearStudioWatermarkKeys` por invalidación acotada:

```ts
async function clearWatermarkKeysFor(db: Db, watermarkId: string): Promise<void> {
  await db.update(photos)
    .set({ thumbWmKey: null, webWmKey: null, highWmKey: null })
    .where(inArray(
      photos.galleryId,
      db.select({ id: galleries.id }).from(galleries).where(eq(galleries.watermarkId, watermarkId)),
    ));
}
```

En `saveWatermark`: `await clearStudioWatermarkKeys(tx, studioId)` → `if (existing) await clearWatermarkKeysFor(tx, existing.id);` (crear marca nueva no afecta a nadie). En `deleteWatermark`: antes del delete, resolver la fila (`select` por studio+slot, NOT_FOUND si no existe), luego `await clearWatermarkKeysFor(tx, row.id);` y `await tx.update(galleries).set({ watermarkId: null }).where(eq(galleries.watermarkId, row.id));`, luego el delete.

- [ ] **Step 6: galleries.ts GREEN** — `updateGallerySchema` += `watermarkId: z.string().uuid().nullable().optional()`. En `updateGallerySettings`, envolver el update en `db.transaction` cuando `data.watermarkId !== undefined`:

```ts
import { watermarks } from "@/db/schema"; // añadir al import existente

  return db.transaction(async (tx) => {
    if (data.watermarkId !== undefined) {
      const [current] = await tx.select({ watermarkId: galleries.watermarkId }).from(galleries)
        .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
      if (!current) throw new Error("NOT_FOUND");
      if (data.watermarkId !== null) {
        const [wm] = await tx.select({ id: watermarks.id }).from(watermarks)
          .where(and(eq(watermarks.id, data.watermarkId), eq(watermarks.studioId, studioId)));
        if (!wm) throw new Error("INVALID_WATERMARK");
      }
      if (current.watermarkId !== data.watermarkId) {
        await tx.update(photos)
          .set({ thumbWmKey: null, webWmKey: null, highWmKey: null })
          .where(eq(photos.galleryId, galleryId));
      }
    }
    const [gallery] = await tx.update(galleries).set(values)/* …resto igual… */;
    if (!gallery) throw new Error("NOT_FOUND");
    return gallery;
  });
```

(Mantener el código existente de password/values; la transacción envuelve todo el update siempre — es inocua cuando watermarkId no viene.)

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: per-gallery watermark selection with scoped invalidation"
```

---

### Task 2: Pipeline, consumidores, UI de selección y preview de una marca

**Files:**
- Modify: `src/server/processing.ts`, `src/app/g/[slug]/page.tsx`, `src/app/g/[slug]/actions.ts`, `src/app/admin/galleries/[id]/page.tsx`, `src/app/admin/galleries/[id]/actions.ts`, `src/app/admin/settings/watermark-section.tsx`, `messages/es.json`, `messages/en.json`, `README.md`, `docs/superpowers/specs/2026-07-08-watermarks-v2-design.md`

**Interfaces:**
- Consumes: `Gallery.watermarkId` (T1), `listWatermarks`, `applyWatermarks`/`WatermarkSpec`, `getObjectBuffer`.

- [ ] **Step 1: processing.ts** — reemplazar el bloque `listWatermarks`+loop+logoCache por la marca seleccionada:

```ts
import { and, eq } from "drizzle-orm";
import { galleries, watermarks } from "@/db/schema";

  const specs: WatermarkSpec[] = [];
  if (gallery.watermarkId) {
    const [mark] = await db.select().from(watermarks)
      .where(and(eq(watermarks.id, gallery.watermarkId), eq(watermarks.studioId, gallery.studioId)));
    if (mark) {
      specs.push({
        type: mark.type, text: mark.text,
        imageBuffer: mark.type === "image" && mark.imageKey ? await getObjectBuffer(mark.imageKey) : null,
        opacityPct: mark.opacityPct, sizePct: mark.sizePct, placement: mark.placement,
      });
    }
  }
  const set = await makeDerivatives(original, { watermarks: specs });
```

(Quitar el import de `listWatermarks` y el `Map` logoCache — con una sola marca no hay nada que dedupe.)

- [ ] **Step 2: Consumidores del gate** — en los 4 sitios, `hasWatermarks` pasa a derivarse de la galería (quitar `listWatermarks` donde quede sin uso):
  - `src/app/g/[slug]/page.tsx:44` → `const hasWatermarks = !!data.gallery.watermarkId;`
  - `src/app/g/[slug]/actions.ts:129` y `:178` → `const hasWatermarks = !!gallery.watermarkId;`
  - `src/app/admin/galleries/[id]/page.tsx:45` → `const hasWatermarks = !!gallery.watermarkId;` (la heurística de la línea 49 no cambia). OJO: este archivo SÍ sigue importando `listWatermarks` — lo usa el Step 3 para el select.

- [ ] **Step 3: Select de marca en el detalle de galería** — en `src/app/admin/galleries/[id]/page.tsx`, cargar `const studioMarks = await listWatermarks(db, studio.id);` y junto al select de `watermarkMode` (después del label existente con el hint), añadir:

```tsx
          <label className="flex flex-col gap-1">
            {t("watermark")}
            <select name="watermarkId" defaultValue={gallery.watermarkId ?? ""} className={input}>
              <option value="">{t("watermarkNone")}</option>
              {studioMarks.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.slot + 1}. ${m.type === "text" ? m.text : "PNG"} · ${t(`placements.${m.placement}`)}`}
                </option>
              ))}
            </select>
          </label>
```

En `src/app/admin/galleries/[id]/actions.ts`: `settingsForm` += `watermarkId: z.string().uuid().nullable()`, y en el parse: `watermarkId: String(formData.get("watermarkId") ?? "") || null`.

- [ ] **Step 4: Preview de UNA marca** — `src/app/admin/settings/watermark-section.tsx` pasa a mantener el slot previsualizado (las marcas son alternativas — superponerlas en el preview miente):

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
  previewLabels: { preview: string; previewLoading: string; previewError: string; previewPick: string };
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  const [previewSlot, setPreviewSlot] = useState<number | null>(initial[0]?.slot ?? null);
  const active = slots.find((s) => s.slot === previewSlot) ?? slots[0];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <WatermarkEditor initial={initial} labels={labels} onChange={setSlots} />
      <div className="space-y-2">
        {slots.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-600">{previewLabels.previewPick}</span>
            {slots.map((s) => (
              <button
                key={s.slot} type="button" onClick={() => setPreviewSlot(s.slot)}
                className={`rounded border px-2 py-0.5 ${active?.slot === s.slot ? "bg-neutral-900 text-white" : ""}`}
              >
                {s.slot + 1}
              </button>
            ))}
          </div>
        )}
        <WatermarkPreview slots={active ? [active] : []} labels={previewLabels} />
      </div>
    </div>
  );
}
```

(`WatermarkPreview` no cambia: ya acepta `slots` y su tipo de labels es estructural — añadir `previewPick` al tipo del prop en `watermark-section.tsx` basta; verificar que el page pasa la nueva label.)

- [ ] **Step 5: i18n** — añadir con paridad es/en:
  - `galleryDetail.watermark`: es "Marca de agua" / en "Watermark"
  - `galleryDetail.watermarkNone`: es "Sin marca" / en "No watermark"
  - `galleryDetail.placements.tl|tc|tr|ml|center|mr|bl|bc|br|tile`: es "arriba izq.|arriba centro|arriba der.|centro izq.|centro|centro der.|abajo izq.|abajo centro|abajo der.|mosaico" / en "top left|top center|top right|middle left|center|middle right|bottom left|bottom center|bottom right|tile"
  - `settings.watermarks.previewPick`: es "Previsualizar marca" / en "Preview mark"
  - Ajustar `settings.watermarks.intro` a: es "Configura hasta 3 marcas de agua; cada galería elige cuál usar (o ninguna)." / en "Set up to 3 watermarks; each gallery picks which one to use (or none)."
  - Ajustar la nota de guardado (`settings.watermarks.savedNote` o la clave existente del aviso) a: es "Las galerías que usan esta marca necesitarán regenerar sus fotos — verás el banner en cada una." / en "Galleries using this mark will need to regenerate their photos — you'll see the banner on each one."

- [ ] **Step 6: Docs** — README sección "Marca de agua y descargas", reemplazar el primer bullet por:

```markdown
- Las marcas de agua se configuran en **Configuración** (`/admin/settings`): hasta 3 marcas
  (texto o PNG con opacidad, tamaño y posición) como catálogo del estudio; **cada galería
  elige cuál usar** (o ninguna) en su configuración.
```

Y en `docs/superpowers/specs/2026-07-08-watermarks-v2-design.md` añadir al final:

```markdown
## Addendum (2026-07-08): selección por galería

Corrección de producto: las ≤3 marcas NO se componen — son alternativas. `galleries.watermark_id`
(FK nullable → watermarks, SET NULL) selecciona la marca de la galería; el gate de delivery pasa a
`!!gallery.watermarkId`. Invalidación acotada: mutar una marca limpia claves `-wm` solo de las
galerías que la seleccionaron; cambiar la selección limpia solo esa galería; crear una marca nueva
no limpia nada. El preview de Configuración muestra una marca a la vez (picker de slot).
Migración 0006: cada galería queda con la marca de slot más bajo de su estudio (comportamiento
previo más cercano).
```

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: galleries pick one studio watermark; single-mark preview"
```

---

## Self-Review (aplicado)

- **Cobertura:** selección por galería (T1 schema+dominio, T2 UI), invalidación acotada (T1), pipeline una marca (T2), gate consumidores (T2), preview una marca (T2), migración con default slot mínimo (T1), docs (T2). El editor de Configuración no cambia (sigue editando el catálogo).
- **Tipos:** `watermarkId: string | null` en Gallery; `updateGallerySettings` patch opcional nullable; firmas de saveWatermark/deleteWatermark intactas; `WatermarkPreview` recibe `slots` filtrado sin cambio de firma.
- **Placeholders:** los dos tests marcados "escribir completo con el patrón X" nombran el patrón exacto y el archivo fuente del patrón — el implementador los completa con código real, no TBD de comportamiento.
