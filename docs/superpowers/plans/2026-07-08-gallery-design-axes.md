# Diseño por ejes + secciones obligatorias + preview/compartir — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir las plantillas fijas por 4 ejes de diseño por galería (portada/tipografía/paleta/cuadrícula) con imagen de portada propia + foco; hacer las secciones obligatorias; pestañas + favoritas en el cliente; modo preview con banda y copiar enlace en el admin.

**Architecture:** `templates.ts` se convierte en `design-options.ts` (tokens por eje); los componentes del cliente reciben `design = { coverStyle, fontSet, palette, gridStyle }`. Migración 0008 única (columnas de diseño + mapeo + drops de cover_template/theme + backfill de fotos huérfanas a sección "Fotos" + section_id NOT NULL). El preview reusa la MISMA ClientGallery con `previewMode`.

**Tech Stack:** Next.js 16 App Router, Drizzle/Neon (PGlite tests), motion, next/font, next-intl, R2 presign.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-gallery-design-and-sections-design.md`.
- Ejes exactos (constantes en `src/db/schema.ts`, todos importan de ahí): `COVER_STYLES = ["full","overlay","split","banner"]`, `FONT_SETS = ["elegante","dramatica","amable","clasica"]`, `PALETTES = ["blanco","marfil","calido","carbon","noche"]`, `GRID_STYLES = ["justificada","aireada","cuadrada"]`. `GALLERY_TEMPLATES` DESAPARECE.
- SECURITY: `coverImageKey` con prefijo `studios/{studioId}/covers/{galleryId}/` validado en dominio (studioId de sesión) → `Error("INVALID_COVER_KEY")`; la ruta coverPhotoId/primera-foto CONSERVA los gates fail-closed + published/ready/section-visible existentes; el preview exige `requireStudio()` + galería del estudio y NO crea sesión de cliente; tenant-scoping en toda función de dominio.
- Toda foto pertenece a una sección (`photos.section_id` NOT NULL); eliminar sección con fotos exige destino (`SECTION_NOT_EMPTY` sin él); sin otra sección no se puede eliminar.
- Cliente: pestañas SOLO de secciones visibles, SIN "Todas"; favoritas filtra la pestaña activa; radio de foto fijo 2px; cero emojis/alert() (iconos de `icons.tsx`); `prefers-reduced-motion` respetado (patrón existente).
- Migración: `sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'` — NUNCA imprimir `.env.local`. SQL válido en PGlite (tests aplican ./drizzle completo).
- i18n paridad es/en. Gate por tarea: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` (cero warnings).
- Next 16 puede diferir del conocimiento previo: ante dudas, `node_modules/next/dist/docs/`.

---

### Task 1: Migración 0008 + dominio de diseño

**Files:**
- Modify: `src/db/schema.ts`, `src/server/galleries.ts`
- Create: `drizzle/0008_*.sql` (generada + data hand-editada)
- Test: `tests/server/galleries.test.ts`

**Interfaces:**
- Produces: constantes/typos `COVER_STYLES/CoverStyle`, `FONT_SETS/FontSet`, `PALETTES/Palette`, `GRID_STYLES/GridStyle` (schema); `Gallery` gana `coverStyle/fontSet/palette/gridStyle: string` y `coverImageKey: string | null`, pierde `coverTemplate/theme`; `updateGalleryDesign(db, studioId, galleryId, patch) → { gallery: Gallery; replacedCoverKey: string | null }`; `deleteGallery` incluye `coverImageKey` en las claves devueltas.

- [ ] **Step 1: Schema** — en `src/db/schema.ts`: ELIMINAR `GALLERY_TEMPLATES`/`GalleryTemplate` y `galleryThemeEnum`; añadir sobre `galleries`:

```ts
export const COVER_STYLES = ["full", "overlay", "split", "banner"] as const;
export type CoverStyle = (typeof COVER_STYLES)[number];
export const FONT_SETS = ["elegante", "dramatica", "amable", "clasica"] as const;
export type FontSet = (typeof FONT_SETS)[number];
export const PALETTES = ["blanco", "marfil", "calido", "carbon", "noche"] as const;
export type Palette = (typeof PALETTES)[number];
export const GRID_STYLES = ["justificada", "aireada", "cuadrada"] as const;
export type GridStyle = (typeof GRID_STYLES)[number];
```

En la tabla `galleries`: quitar `coverTemplate` y `theme`; añadir tras `coverFocalY`:

```ts
  coverStyle: text("cover_style").notNull().default("full"),
  fontSet: text("font_set").notNull().default("elegante"),
  palette: text("palette").notNull().default("blanco"),
  gridStyle: text("grid_style").notNull().default("justificada"),
  coverImageKey: text("cover_image_key"),
```

En `photos`: `sectionId: uuid("section_id").notNull().references(() => sections.id)` (fuera el `onDelete: "set null"`).

- [ ] **Step 2: Migración** — `npx drizzle-kit generate --name gallery_design_axes`. HAND-EDITAR el SQL: los ADD COLUMN quedan al inicio; INSERTAR los data-statements ANTES de los DROP COLUMN / SET NOT NULL, separados con `--> statement-breakpoint`:

```sql
UPDATE "galleries" SET "cover_style"='overlay', "font_set"='dramatica', "palette"='carbon' WHERE "cover_template"='cinematico';--> statement-breakpoint
UPDATE "galleries" SET "cover_style"='overlay', "font_set"='amable', "palette"='calido', "grid_style"='aireada' WHERE "cover_template"='luminoso';--> statement-breakpoint
UPDATE "galleries" SET "cover_style"='split', "font_set"='clasica', "palette"='marfil', "grid_style"='cuadrada' WHERE "cover_template"='clasico';--> statement-breakpoint
INSERT INTO "sections" ("gallery_id", "name", "position", "visible")
SELECT p."gallery_id", 'Fotos',
       COALESCE((SELECT max(s."position") + 1 FROM "sections" s WHERE s."gallery_id" = p."gallery_id"), 0),
       true
FROM "photos" p WHERE p."section_id" IS NULL GROUP BY p."gallery_id";--> statement-breakpoint
UPDATE "photos" p SET "section_id" = (
  SELECT s."id" FROM "sections" s
  WHERE s."gallery_id" = p."gallery_id" AND s."name" = 'Fotos'
  ORDER BY s."position" DESC LIMIT 1
) WHERE p."section_id" IS NULL;
```

Verificar que el SQL generado incluye: DROP de `cover_template` y `theme` (y el tipo `gallery_theme` si drizzle lo genera), el cambio de FK de `photos.section_id` (sin ON DELETE SET NULL) y `SET NOT NULL` DESPUÉS del backfill. Aplicar a Neon con el comando de Global Constraints. `npm test` valida el SQL en PGlite.

- [ ] **Step 3: Tests RED** — en `tests/server/galleries.test.ts` (adaptar además cualquier test que use `coverTemplate`/`theme`; los helpers que crean fotos deben pasar `sectionId` ahora — crear sección con `createSection` donde haga falta):

```ts
import { updateGalleryDesign } from "@/server/galleries";

describe("updateGalleryDesign", () => {
  it("updates axes and focal point", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    expect(g.coverStyle).toBe("full");
    const { gallery } = await updateGalleryDesign(db, studio.id, g.id, {
      coverStyle: "split", palette: "carbon", coverFocalX: 0.2, coverFocalY: 0.8,
    });
    expect(gallery.coverStyle).toBe("split");
    expect(gallery.palette).toBe("carbon");
    expect(gallery.coverFocalX).toBeCloseTo(0.2);
  });

  it("rejects invalid axis values, foreign studios and bad cover keys", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    await expect(updateGalleryDesign(db, studio.id, g.id, { palette: "neon" as never })).rejects.toThrow();
    await expect(updateGalleryDesign(db, studio.id, g.id, { coverFocalX: 1.5 })).rejects.toThrow();
    await expect(updateGalleryDesign(db, "00000000-0000-0000-0000-000000000000", g.id, { palette: "noche" }))
      .rejects.toThrow("NOT_FOUND");
    await expect(updateGalleryDesign(db, studio.id, g.id, { coverImageKey: "studios/otro/covers/x/a.jpg" }))
      .rejects.toThrow("INVALID_COVER_KEY");
  });

  it("returns the replaced cover key on replace and on removal", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    const k1 = `studios/${studio.id}/covers/${g.id}/a.jpg`;
    const k2 = `studios/${studio.id}/covers/${g.id}/b.jpg`;
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: k1 })).replacedCoverKey).toBeNull();
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: k2 })).replacedCoverKey).toBe(k1);
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: null })).replacedCoverKey).toBe(k2);
  });
});
```

- [ ] **Step 4: Dominio GREEN** — en `src/server/galleries.ts`: quitar `coverTemplate` de `updateGallerySchema` (el diseño ya no entra por settings). Añadir:

```ts
import { COVER_STYLES, FONT_SETS, PALETTES, GRID_STYLES } from "@/db/schema";

const designSchema = z.object({
  coverStyle: z.enum(COVER_STYLES).optional(),
  fontSet: z.enum(FONT_SETS).optional(),
  palette: z.enum(PALETTES).optional(),
  gridStyle: z.enum(GRID_STYLES).optional(),
  coverFocalX: z.number().min(0).max(1).optional(),
  coverFocalY: z.number().min(0).max(1).optional(),
  coverImageKey: z.string().min(1).nullable().optional(),
});
export type GalleryDesignInput = z.infer<typeof designSchema>;

export async function updateGalleryDesign(
  db: Db, studioId: string, galleryId: string, patch: GalleryDesignInput,
): Promise<{ gallery: Gallery; replacedCoverKey: string | null }> {
  const data = designSchema.parse(patch);
  if (data.coverImageKey && !data.coverImageKey.startsWith(`studios/${studioId}/covers/${galleryId}/`)) {
    throw new Error("INVALID_COVER_KEY");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ coverImageKey: galleries.coverImageKey }).from(galleries)
      .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
    if (!current) throw new Error("NOT_FOUND");
    const [gallery] = await tx.update(galleries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)))
      .returning();
    const replacedCoverKey =
      data.coverImageKey !== undefined && current.coverImageKey && current.coverImageKey !== data.coverImageKey
        ? current.coverImageKey : null;
    return { gallery, replacedCoverKey };
  });
}
```

En `deleteGallery`: añadir `gallery.coverImageKey` a las claves devueltas (cargar la galería ya se hace con `getGallery` — usar su retorno).

- [ ] **Step 5: Compilación de consumidores** — `npx tsc --noEmit` señalará todos los usos de `coverTemplate`/`theme` (admin select de plantilla, page.tsx del cliente, templates.ts, tests): para ESTA tarea, hacer el cambio MÍNIMO que compile sin perder el gate — en el admin quitar el select de plantilla (T5 trae la sección Diseño); en `src/app/g/[slug]/page.tsx` y `access-form` pasar temporalmente `template: "editorial"`-equivalente NO existe ya — en su lugar mapear provisionalmente `design`→tokens viejos NO: la solución mínima es que T1 cambie `templates.ts` a aceptar los 4 ejes YA: renombrar en esta tarea `templates.ts`→`design-options.ts` con la API nueva (código completo en Task 3 Step 1 — implementarlo AQUÍ tal cual) y actualizar los consumidores a `design={{ coverStyle, fontSet, palette, gridStyle }}` pasando los campos de la galería con casts (`gallery.coverStyle as CoverStyle`). Los componentes usan tokens equivalentes (Task 3 los refina visualmente; aquí solo deben COMPILAR y renderizar coherente).

- [ ] **Step 6: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: gallery design axes schema, migration and domain"
```

---

### Task 2: Secciones obligatorias (dominio + admin)

**Files:**
- Modify: `src/server/photos.ts`, `src/server/sections.ts`, `src/app/admin/galleries/[id]/actions.ts`, `src/app/admin/galleries/[id]/photo-uploader.tsx`, `src/app/admin/galleries/[id]/photo-manager.tsx`, `src/app/admin/galleries/[id]/page.tsx`, `messages/es.json`, `messages/en.json`
- Create: `src/app/admin/galleries/[id]/delete-section.tsx`
- Test: `tests/server/sections.test.ts`, `tests/server/photos.test.ts`

**Interfaces:**
- Consumes: T1 (photos.sectionId NOT NULL en schema).
- Produces: `deleteSection(db, studioId, sectionId, moveToSectionId?: string)`; `registerUpload` exige `sectionId: string` (uuid); `movePhotos(..., sectionId: string)`.

- [ ] **Step 1: Tests RED** — en `tests/server/sections.test.ts`:

```ts
it("deletes an empty section directly", async () => { /* crear galería+sección sin fotos, deleteSection sin destino, listSections no la incluye */ });

it("requires a target when the section has photos and moves them", async () => {
  // galería con secciones A y B; foto en A (registerUpload con sectionId A + completeProcessing o insert directo con status ready)
  // deleteSection(db, studio.id, A.id) → rejects SECTION_NOT_EMPTY
  // deleteSection(db, studio.id, A.id, B.id) → resuelve; la foto queda en B; A ya no existe
});

it("rejects a target from another gallery and foreign studios", async () => {
  // destino de otra galería → INVALID_TARGET; sectionId de otro estudio → NOT_FOUND
});
```

En `tests/server/photos.test.ts`: `registerUpload` sin `sectionId` → rejects (ZodError); ajustar los tests existentes que subían sin sección para crear/usar una sección.

- [ ] **Step 2: Dominio GREEN** — `src/server/photos.ts`: `registerSchema` → `sectionId: z.string().uuid()`; quitar el `?? null` y el `if (data.sectionId)` condicional (siempre `assertSectionInGallery`). `movePhotos`: firma `sectionId: string`, siempre asserts. `src/server/sections.ts`:

```ts
export async function deleteSection(
  db: Db, studioId: string, sectionId: string, moveToSectionId?: string,
): Promise<void> {
  const row = await assertSectionOwnership(db, studioId, sectionId);
  await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(photos).where(eq(photos.sectionId, sectionId));
    if (count > 0) {
      if (!moveToSectionId) throw new Error("SECTION_NOT_EMPTY");
      if (moveToSectionId === sectionId) throw new Error("INVALID_TARGET");
      const [target] = await tx.select({ id: sections.id }).from(sections)
        .where(and(eq(sections.id, moveToSectionId), eq(sections.galleryId, row.galleryId)));
      if (!target) throw new Error("INVALID_TARGET");
      await tx.update(photos).set({ sectionId: moveToSectionId }).where(eq(photos.sectionId, sectionId));
    }
    await tx.delete(sections).where(eq(sections.id, sectionId));
  });
}
```

(import `photos` de schema.) El comentario del FK SET NULL desaparece.

- [ ] **Step 3: Actions** — `deleteSectionAction`: parsear `moveToSectionId` opcional (`String(formData.get("moveToSectionId") ?? "") || undefined`) y pasarlo. `movePhotosAction`: `sectionId: z.string().uuid()` (fuera nullable). El endpoint de subida que llama `registerUpload` compila solo (Zod exige sectionId; tsc avisa si el route pasaba null).

- [ ] **Step 4: UI** — `photo-uploader.tsx`: quitar `<option value="">` y el prop/label `noSection`; si `sections.length === 0`, deshabilitar select+file input y mostrar `labels.needSection`. `photo-manager.tsx`: quitar la opción "Sin sección" del select de mover y el grupo null (`bySection.get(null)`), quitar label `noSection`. Crear `delete-section.tsx` (client): recibe `{ galleryId, sectionId, photoCount, otherSections: {id,name}[], labels }`; si `photoCount === 0` → form directo como hoy; si hay fotos y `otherSections.length === 0` → botón deshabilitado con `title={labels.deleteBlocked}`; si hay fotos y destinos → al hacer clic despliega inline `<select>` de destino + botón confirmar que envía el form con `moveToSectionId`. Usarlo en `page.tsx` en lugar del form actual de eliminar (page calcula `photoCount` por sección desde `photoRows`). i18n `galleryDetail`: + `"deleteMoveTo": "Mover fotos a…" / "Move photos to…"`, `"deleteConfirmMove": "Mover y eliminar" / "Move & delete"`, `"deleteBlocked": "Crea otra sección para poder eliminarla" / "Create another section first"`; `galleryDetail.upload`: + `"needSection": "Crea una sección para subir fotos" / "Create a section to upload photos"`; QUITAR ambos `noSection` (es/en).

- [ ] **Step 5: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: mandatory sections with guided section deletion"
```

---

### Task 3: design-options.ts — tokens por eje y render del cliente

**Files:**
- Modify: `src/app/g/[slug]/design-options.ts` (creado en T1 Step 5 — refinarlo aquí si quedó provisional), `src/app/g/[slug]/gallery-cover.tsx`, `src/app/g/[slug]/photo-grid.tsx`, `src/app/g/[slug]/access-form.tsx`, `src/app/g/[slug]/client-gallery.tsx`, `src/app/g/[slug]/page.tsx`
- Test: `tests/app/design-options.test.ts` (reemplaza `templates.test.ts`)

**Interfaces:**
- Consumes: tipos de ejes (T1).
- Produces: `type GalleryDesign = { coverStyle: CoverStyle; fontSet: FontSet; palette: Palette; gridStyle: GridStyle }`; `PALETTE_TOKENS: Record<Palette, PaletteTokens>` con `{ bg, text, muted, accent, surface, dark }`; `FONT_TOKENS: Record<FontSet, FontTokens>` con `{ display, body, displayWeight, displayStyle, displayTransform, displayTracking }`; `GRID_TOKENS: Record<GridStyle, { targetH: number; gap: number; square: boolean }>`; `PHOTO_RADIUS = "2px"`. Todos los componentes reciben `design: GalleryDesign`.

- [ ] **Step 1: design-options.ts** (contenido definitivo):

```ts
import type { CoverStyle, FontSet, Palette, GridStyle } from "@/db/schema";

export type GalleryDesign = { coverStyle: CoverStyle; fontSet: FontSet; palette: Palette; gridStyle: GridStyle };

export type PaletteTokens = { bg: string; text: string; muted: string; accent: string; surface: string; dark: boolean };
export const PALETTE_TOKENS: Record<Palette, PaletteTokens> = {
  blanco: { bg: "#ffffff", text: "#1a1a1a", muted: "#8a8a8a", accent: "#1a1a1a", surface: "#ffffff", dark: false },
  marfil: { bg: "#faf7f2", text: "#2b2b2b", muted: "#8a8a8a", accent: "#b59a68", surface: "#ffffff", dark: false },
  calido: { bg: "#fdf9f4", text: "#5b4a3f", muted: "#a08d7f", accent: "#c98d6b", surface: "#ffffff", dark: false },
  carbon: { bg: "#0e0e10", text: "#f4f1ea", muted: "#9c968a", accent: "#c8a96a", surface: "#17171a", dark: true },
  noche: { bg: "#12151c", text: "#e8ebf2", muted: "#8d97a8", accent: "#aab4c4", surface: "#1a1e27", dark: true },
};

export type FontTokens = {
  display: string; body: string; displayWeight: number;
  displayStyle: "normal" | "italic"; displayTransform: "uppercase" | "none"; displayTracking: string;
};
export const FONT_TOKENS: Record<FontSet, FontTokens> = {
  elegante: { display: "var(--font-cormorant), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 300, displayStyle: "normal", displayTransform: "uppercase", displayTracking: "0.18em" },
  dramatica: { display: "var(--font-playfair), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 500, displayStyle: "italic", displayTransform: "none", displayTracking: "0.02em" },
  amable: { display: "var(--font-nunito), sans-serif", body: "var(--font-nunito), sans-serif",
    displayWeight: 700, displayStyle: "normal", displayTransform: "none", displayTracking: "0.01em" },
  clasica: { display: "var(--font-garamond), Georgia, serif", body: "var(--font-lato), sans-serif",
    displayWeight: 400, displayStyle: "normal", displayTransform: "none", displayTracking: "0.06em" },
};

export const GRID_TOKENS: Record<GridStyle, { targetH: number; gap: number; square: boolean }> = {
  justificada: { targetH: 280, gap: 8, square: false },
  aireada: { targetH: 360, gap: 24, square: false },
  cuadrada: { targetH: 0, gap: 8, square: true },
};

export const PHOTO_RADIUS = "2px";
```

- [ ] **Step 2: Test** — `tests/app/design-options.test.ts` (borrar `templates.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { COVER_STYLES, FONT_SETS, PALETTES, GRID_STYLES } from "@/db/schema";
import { PALETTE_TOKENS, FONT_TOKENS, GRID_TOKENS } from "@/app/g/[slug]/design-options";

describe("design options", () => {
  it("defines tokens for every axis value", () => {
    for (const p of PALETTES) for (const f of ["bg","text","muted","accent","surface"] as const)
      expect(PALETTE_TOKENS[p][f], `${p}.${f}`).toMatch(/^#/);
    for (const s of FONT_SETS) expect(FONT_TOKENS[s].display).toContain("var(--font-");
    for (const g of GRID_STYLES) expect(GRID_TOKENS[g]).toBeDefined();
    expect(COVER_STYLES).toEqual(["full", "overlay", "split", "banner"]);
  });
  it("marks exactly carbon and noche as dark", () => {
    expect(PALETTES.filter((p) => PALETTE_TOKENS[p].dark)).toEqual(["carbon", "noche"]);
  });
});
```

- [ ] **Step 3: gallery-cover.tsx** — recibe `design` y compone tokens (`pt = PALETTE_TOKENS[design.palette]`, `ft = FONT_TOKENS[design.fontSet]`): estilos `full` (h-screen, título centrado blanco, flecha sobre la foto — como hoy) / `overlay` (h-[78vh], degradado `linear-gradient(to top, ${pt.bg} 4%, transparent 55%)`, título abajo-izquierda color `pt.text`, filete `pt.accent`) / `split` (como hoy con `pt`/`ft`) / `banner` (NUEVO):

```tsx
  if (style === "banner") {
    return (
      <header style={{ background: pt.bg }}>
        <div className="relative h-[50vh] min-h-56 overflow-hidden">{img}</div>
        <motion.div {...fade} className="flex flex-col items-center px-8 py-10 text-center">
          <h1 className="text-4xl md:text-5xl" style={{ ...titleStyle, color: pt.text }}>{title}</h1>
          <div className="mt-5 h-px w-14" style={{ background: pt.accent }} />
        </motion.div>
      </header>
    );
  }
```

(Los casos lowline/warm actuales se UNIFICAN en `overlay`.)

- [ ] **Step 4: photo-grid.tsx** — recibe `design`; `const gt = GRID_TOKENS[design.gridStyle]`. Si `gt.square`: contenedor `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4` con `gap: gt.gap`, cada figura `aspect-square` + `object-cover` (sin flexProps). Si no: flex actual con `gap: gt.gap` y `flexProps(ar, gt.targetH)`. Radio `PHOTO_RADIUS` fijo; eliminar `photoFrame`.

- [ ] **Step 5: access-form, client-gallery, page** — sustituir todo `template`/`TEMPLATE_TOKENS` por `design`/tokens compuestos; `page.tsx` construye `design` desde la galería (casts `as CoverStyle` etc.); eliminar `templates.ts` si aún existe; `grep -rn "TEMPLATE_TOKENS\|GalleryTemplate\|coverTemplate" src tests` vacío.

- [ ] **Step 6: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: render client gallery from design axes"
```

---

### Task 4: Barra de título con pestañas y favoritas

**Files:**
- Create: `src/app/g/[slug]/title-bar.tsx`
- Modify: `src/app/g/[slug]/client-gallery.tsx`, `src/app/g/[slug]/page.tsx`, `messages/es.json`, `messages/en.json`
- Delete: `src/app/g/[slug]/gallery-header.tsx`

**Interfaces:**
- Consumes: `GalleryDesign`/tokens (T3), iconos (existentes), acciones actuales.
- Produces: `<TitleBar design title sections activeSectionId onSelectSection favoritesOnly onToggleFavorites zip zipResolution onZipResolution onZip labels sentinel />`; `ClientGallery` con estado `activeSectionId` (primera visible por defecto) y `favoritesOnly`.

- [ ] **Step 1: title-bar.tsx** — banda bajo la portada que se vuelve fija al pasar el sentinel (IntersectionObserver como el gallery-header actual, pero el contenido se renderiza SIEMPRE: en flujo normal bajo la portada y `fixed top-0 z-40` cuando `stuck`):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryDesign } from "./design-options";
import { PALETTE_TOKENS, FONT_TOKENS } from "./design-options";
import { IconHeart, IconDownload } from "./icons";

type Res = "web" | "high" | "original";

export function TitleBar({
  design, title, sections, activeSectionId, onSelectSection,
  favoritesOnly, onToggleFavorites, zip, zipResolution, onZipResolution, onZip,
  sentinel, labels,
}: {
  design: GalleryDesign; title: string;
  sections: { id: string; name: string }[];
  activeSectionId: string | null; onSelectSection: (id: string) => void;
  favoritesOnly: boolean; onToggleFavorites: () => void;
  zip: { enabled: boolean; resolutions: Res[] };
  zipResolution: Res; onZipResolution: (r: Res) => void;
  onZip: (scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }) => void;
  sentinel: React.RefObject<HTMLElement | null>;
  labels: { favorites: string; downloadGallery: string; downloadFavorites: string; downloadSection: string;
    resolutions: Record<Res, string> };
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const [stuck, setStuck] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const tab = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs transition-colors ${active ? "text-white" : "hover:opacity-70"}`;

  return (
    <div
      className={`z-40 border-b px-5 py-3 backdrop-blur-md transition-shadow ${
        stuck ? "fixed inset-x-0 top-0 shadow-sm" : "relative"}`}
      style={{ background: pt.dark ? "rgba(14,14,16,.88)" : "rgba(255,255,255,.88)",
        borderColor: pt.dark ? "#26262a" : "#eee", color: pt.text }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <span className="truncate text-base" style={{ fontFamily: ft.display, fontStyle: ft.displayStyle,
          textTransform: ft.displayTransform, letterSpacing: ft.displayTracking, fontWeight: ft.displayWeight }}>
          {title}
        </span>
        <div className="flex items-center gap-2">
          <button aria-label={labels.favorites} aria-pressed={favoritesOnly} onClick={onToggleFavorites}
            className="rounded-full border p-2" style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd",
              background: favoritesOnly ? pt.accent : "transparent",
              color: favoritesOnly ? (pt.dark ? "#0e0e10" : "#fff") : pt.text }}>
            <IconHeart filled={favoritesOnly} className="h-4 w-4" />
          </button>
          {zip.enabled && zip.resolutions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                className="rounded-full border p-2" style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                <IconDownload className="h-4 w-4" />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 mt-2 w-60 space-y-2 rounded-lg border p-3 text-sm shadow-xl"
                  style={{ background: pt.surface, borderColor: pt.dark ? "#3a3a40" : "#e5e5e5" }}>
                  <select value={zipResolution} onChange={(e) => onZipResolution(e.target.value as Res)}
                    className="w-full rounded border bg-transparent px-2 py-1.5 text-xs"
                    style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                    {zip.resolutions.map((r) => <option key={r} value={r}>{labels.resolutions[r]}</option>)}
                  </select>
                  <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                    onClick={() => { setMenu(false); onZip({ type: "gallery" }); }}>{labels.downloadGallery}</button>
                  <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                    onClick={() => { setMenu(false); onZip({ type: "favorites" }); }}>{labels.downloadFavorites}</button>
                  {activeSectionId && (
                    <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                      onClick={() => { setMenu(false); onZip({ type: "section", sectionId: activeSectionId }); }}>
                      {labels.downloadSection}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {sections.length > 1 && (
        <nav className="mx-auto mt-2 flex max-w-6xl flex-wrap gap-1.5">
          {sections.map((s) => (
            <button key={s.id} onClick={() => onSelectSection(s.id)} className={tab(activeSectionId === s.id)}
              style={activeSectionId === s.id ? { background: pt.accent } : { color: pt.muted }}>
              {s.name}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 2: client-gallery.tsx** — eliminar `gallery-header.tsx` y su uso. `sections` prop pasa a `{ id: string; name: string }[]` (solo visibles, sin null — `page.tsx`: `data.sections.map(...)`, quitar el bloque `{ id: null, name: null }`). Estado nuevo: `activeSectionId` (init `sections[0]?.id ?? null`), `favoritesOnly`. Fotos visibles: `photos.filter((p) => p.sectionId === activeSectionId && (!favoritesOnly || p.liked))`. Render: `<GalleryCover/>` → `<div ref={sentinelRef}/>` → `<TitleBar …/>` → un solo `<PhotoGrid photos={visible} …/>` (desaparecen los encabezados por sección y el icono zip por sección — ahora vive en el menú). Estado vacío de favoritas: `{favoritesOnly && visible.length === 0 && <p className="p-16 text-center text-sm" style={{color: pt.muted}}>{labels.noFavorites}</p>}`. Cuando `sections.length === 0` (galería sin secciones visibles) mostrar `labels.empty` como hoy. El lightbox recibe `visible` (la lista filtrada).

- [ ] **Step 3: i18n** — `clientGallery`: + `"favorites": "Favoritas" / "Favorites"`, `"noFavorites": "Aún no tienes favoritas" / "No favorites yet"`; `downloadSection` reutilizado ("Descargar esta sección" — verificar texto existente y ajustarlo si decía otra cosa, manteniendo paridad).

- [ ] **Step 4: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: title bar with section tabs and favorites filter"
```

---

### Task 5: Imagen de portada + sección Diseño (admin)

**Files:**
- Create: `src/app/api/covers/upload-url/route.ts`, `src/app/admin/galleries/[id]/design-section.tsx`, `src/server/cover.ts`
- Modify: `src/app/admin/galleries/[id]/actions.ts`, `src/app/admin/galleries/[id]/page.tsx`, `src/app/g/[slug]/page.tsx` (portada efectiva en vista y puerta), `messages/es.json`, `messages/en.json`
- Test: `tests/server/cover.test.ts`

**Interfaces:**
- Consumes: `updateGalleryDesign` (T1), presign helpers de `src/server/storage.ts` (patrón del upload de watermarks/fotos), gates de delivery existentes.
- Produces: `pickCoverSource(gallery, photos): { type: "upload"; key: string } | { type: "photo"; photo: Photo } | null` (helper puro en `src/server/cover.ts`); `updateGalleryDesignAction(input)`; POST `/api/covers/upload-url`.

- [ ] **Step 1: Test RED del helper** — `tests/server/cover.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickCoverSource } from "@/server/cover";

const photo = (over = {}) => ({ id: "p1", sectionId: "s1", published: true, status: "ready", ...over });

describe("pickCoverSource", () => {
  it("prefers the uploaded cover image", () => {
    expect(pickCoverSource(
      { coverImageKey: "studios/s/covers/g/a.jpg", coverPhotoId: "p1" },
      [photo()],
    )).toEqual({ type: "upload", key: "studios/s/covers/g/a.jpg" });
  });
  it("falls back to the cover photo, then to the first eligible photo", () => {
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: "p2" },
      [photo(), photo({ id: "p2" })])).toMatchObject({ type: "photo", photo: { id: "p2" } });
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: null },
      [photo({ published: false }), photo({ id: "p3" })])).toMatchObject({ type: "photo", photo: { id: "p3" } });
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: null }, [photo({ status: "processing" })])).toBeNull();
  });
});
```

- [ ] **Step 2: cover.ts GREEN**:

```ts
// Selección de imagen de portada: subida > foto elegida > primera elegible.
// `photos` debe venir YA en el orden visible del cliente (secciones visibles, orden de entrega).
type CoverGallery = { coverImageKey: string | null; coverPhotoId: string | null };
type CoverPhoto = { id: string; published: boolean; status: string };

export function pickCoverSource<P extends CoverPhoto>(
  gallery: CoverGallery, photos: P[],
): { type: "upload"; key: string } | { type: "photo"; photo: P } | null {
  if (gallery.coverImageKey) return { type: "upload", key: gallery.coverImageKey };
  const eligible = photos.filter((p) => p.published && p.status === "ready");
  const chosen = eligible.find((p) => p.id === gallery.coverPhotoId) ?? eligible[0];
  return chosen ? { type: "photo", photo: chosen } : null;
}
```

- [ ] **Step 3: upload endpoint** — `src/app/api/covers/upload-url/route.ts` (patrón del de watermarks): `requireStudio()`; body Zod `{ galleryId: uuid, contentType: z.enum(["image/jpeg","image/png"]), size ≤ 10 * 1024 * 1024 }`; `getGallery(db, studio.id, galleryId)` (tenancy); key `studios/${studio.id}/covers/${galleryId}/${crypto.randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`; presigned PUT con ContentType+ContentLength; responde `{ uploadUrl, key }`.

- [ ] **Step 4: action** — en `src/app/admin/galleries/[id]/actions.ts`:

```ts
export async function updateGalleryDesignAction(input: {
  galleryId: string;
  coverStyle?: string; fontSet?: string; palette?: string; gridStyle?: string;
  coverFocalX?: number; coverFocalY?: number; coverImageKey?: string | null;
}) {
  const studio = await requireStudio();
  const galleryId = id.parse(input.galleryId);
  const { replacedCoverKey } = await updateGalleryDesign(db, studio.id, galleryId, {
    ...input, galleryId: undefined,
  } as never); // construir el patch explícito campo a campo, sin `as never` — ver nota
  if (replacedCoverKey) await deleteObjects([replacedCoverKey]);
  revalidatePath(`/admin/galleries/${galleryId}`);
}
```

Nota: construir el patch EXPLÍCITO (`{ coverStyle: input.coverStyle as CoverStyle | undefined, … }`) — el Zod del dominio valida; prohibido `as never`/`as any`.

- [ ] **Step 5: design-section.tsx** — client component en el detalle (sección "Diseño" bajo Configuración): props `{ galleryId, design: GalleryDesign, focal: { x: number; y: number }, coverThumbUrl: string | null, labels }`. Cuatro grupos de radio-cards (`<button>` por opción, borde acentuado la activa; etiquetas de i18n `galleryDetail.design.*`); picker de foco: contenedor `relative` con la miniatura y `onClick={(e) => setFocal({ x: (e.clientX - rect.left) / rect.width, y: … })}` + punto `absolute` (`left: ${x*100}%`); input file (jpeg/png, ≤10 MB) → fetch upload-url → PUT → guarda `pendingCoverKey`; botón quitar (manda `coverImageKey: null`); botón Guardar llama `updateGalleryDesignAction` con los ejes + focal + coverImageKey si cambió, luego `router.refresh()`. `page.tsx` del admin: renderizar `<DesignSection …/>` pasando `coverThumbUrl` = presign de `pickCoverSource(gallery, photoRows)` (webKey si es foto — usar thumbKey para la miniatura) y labels. i18n `galleryDetail.design`: `title` "Diseño"/"Design"; nombres+hints: coverStyle `full` "Pantalla completa"/"Full screen", `overlay` "Degradado"/"Overlay", `split` "Dividida"/"Split", `banner` "Banner"; fontSet `elegante/dramatica/amable/clasica` → "Elegante/Dramática/Amable/Clásica" ("Elegant/Dramatic/Friendly/Classic"); palette → "Blanco/Marfil/Cálido/Carbón/Noche" ("White/Ivory/Warm/Charcoal/Night"); gridStyle → "Justificada/Aireada/Cuadrada" ("Justified/Airy/Square"); `focalHint` "Haz clic en la imagen para fijar el punto de foco"/"Click the image to set the focal point"; `upload` "Subir imagen de portada"/"Upload cover image"; `remove` "Quitar imagen"/"Remove image"; `save` "Guardar diseño"/"Save design"; `saved` "Guardado"/"Saved".

- [ ] **Step 6: portada efectiva en el cliente** — `src/app/g/[slug]/page.tsx`: en la rama autenticada, `coverUrl` = si `pickCoverSource(data.gallery, /* fotos en orden visible */)` es upload → `presignDownload(key)` directo; si es photo → el flujo actual con gates (`viewList.find` sobre la foto elegida — el helper elige, los gates deciden la clave con `viewKeys`; foto sin claves visibles → probar con la lista `viewList` directamente: la primera entrada de viewList YA pasó los gates, usar su webKey). En la puerta (rama sin sesión) misma prioridad: coverImageKey directo; si no, el flujo gated existente; si no, primera foto elegible pasada por los mismos gates.

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: uploaded cover image with focal picker and admin design section"
```

---

### Task 6: Modo preview + compartir

**Files:**
- Create: `src/app/g/[slug]/preview/page.tsx`, `src/app/g/[slug]/build-props.ts`, `src/app/admin/galleries/[id]/share-links.tsx`
- Modify: `src/server/client-access.ts` (getPreviewGalleryData), `src/app/g/[slug]/page.tsx` (extraer builder común), `src/app/g/[slug]/client-gallery.tsx` + `src/app/g/[slug]/lightbox.tsx` (previewMode), `src/app/admin/galleries/[id]/page.tsx`, `messages/es.json`, `messages/en.json`

**Interfaces:**
- Consumes: `getClientGalleryData` (forma actual), `ClientGallery` props.
- Produces: `getPreviewGalleryData(db, studioId, slug)` → misma forma que `getClientGalleryData` con likes/comentarios vacíos y SIN filtrar por status published; `buildGalleryProps(data)` compartido; `ClientGallery`/`Lightbox` prop `previewMode?: boolean`.

- [ ] **Step 1: getPreviewGalleryData** — en `src/server/client-access.ts` (misma consulta que `getClientGalleryData` pero: galería por `slug` + `studioId` sin filtro de status; `likedPhotoIds: []`, `commentsByPhoto: {}`):

```ts
export async function getPreviewGalleryData(db: Db, studioId: string, slug: string): Promise<ClientGalleryData> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.slug, slug), eq(galleries.studioId, studioId)));
  if (!gallery) throw new Error("NOT_FOUND");
  const visibleSections = await db.select().from(sections)
    .where(and(eq(sections.galleryId, gallery.id), eq(sections.visible, true)))
    .orderBy(asc(sections.position));
  const allPhotos = await listPhotosForGallery(db, gallery);
  const visibleSectionIds = new Set(visibleSections.map((s) => s.id));
  const clientPhotos = allPhotos.filter((p) => p.published && p.status === "ready" && visibleSectionIds.has(p.sectionId));
  return { gallery, sections: visibleSections, photos: clientPhotos, likedPhotoIds: [], commentsByPhoto: {} };
}
```

- [ ] **Step 2: build-props.ts** — extraer de `page.tsx` el bloque que construye `photoViews`, `coverUrl`, `sections`, `zip` desde `ClientGalleryData` a `buildGalleryProps(data): Promise<{...}>` y usarlo en ambas páginas (misma lógica, cero duplicación; los gates/fail-closed viven donde hoy).

- [ ] **Step 3: preview/page.tsx**:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getPreviewGalleryData } from "@/server/client-access";
import { buildGalleryProps } from "../build-props";
import { ClientGallery } from "../client-gallery";

export default async function GalleryPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = await requireStudio();
  const data = await getPreviewGalleryData(db, studio.id, slug).catch(() => null);
  if (!data) notFound();
  const t = await getTranslations("clientGallery");
  const props = await buildGalleryProps(data);
  return <ClientGallery {...props} slug={slug} previewMode labels={/* mismas labels que page.tsx + previewBanner/previewOnly */} />;
}
```

- [ ] **Step 4: previewMode en ClientGallery/Lightbox** — prop `previewMode?: boolean`: banda fija `top-0 z-[70]` (empuja con `pt-9` al contenido cuando activa) con `labels.previewBanner`; handlers de like/comentario/descarga/zip → si `previewMode`, no-op; botones correspondientes `disabled` + `title={labels.previewOnly}` (grid, title-bar, lightbox — pasar `previewMode` a TitleBar/PhotoGrid/Lightbox o deshabilitar vía los handlers y aria-disabled). i18n `clientGallery`: + `"previewBanner": "Vista previa — así verán tus clientes esta galería" / "Preview — this is how your clients will see this gallery"`, `"previewOnly": "Solo disponible para clientes" / "Available to clients only"`.

- [ ] **Step 5: share-links.tsx + admin** — client component:

```tsx
"use client";

import { useState } from "react";

export function ShareLinks({ slug, labels }: { slug: string; labels: { preview: string; copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <a href={`/g/${slug}/preview`} target="_blank" rel="noreferrer"
        className="rounded border px-3 py-1.5 hover:bg-neutral-50">{labels.preview}</a>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(`${window.location.origin}/g/${slug}`).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="rounded border px-3 py-1.5 hover:bg-neutral-50"
      >
        {copied ? labels.copied : labels.copy}
      </button>
    </div>
  );
}
```

En `src/app/admin/galleries/[id]/page.tsx`: reemplazar la línea `<code>/g/{slug}</code>` por `<ShareLinks slug={gallery.slug} labels={…}/>`. i18n `galleryDetail.share`: `"preview": "Vista previa" / "Preview"`, `"copy": "Copiar enlace" / "Copy link"`, `"copied": "Copiado ✓" / "Copied ✓"`.

- [ ] **Step 6: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: gallery preview mode with banner and share links"
```

---

### Task 7: Verificación final + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Limpieza verificada** — vacíos: `grep -rn "GALLERY_TEMPLATES\|GalleryTemplate\|coverTemplate\|cover_template" src tests`, `grep -rn "noSection" src messages`, `grep -rn "\btheme\b" src/app/g src/server/galleries.ts src/db/schema.ts` (sin usos de galleries.theme), `grep -rn "gallery-header" src`.

- [ ] **Step 2: Gate completo**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
cd workers/zip && npx tsc --noEmit && cd ../..
```

- [ ] **Step 3: README** — reemplazar el bullet de plantillas por:

```markdown
- **Diseño por galería**: portada (4 estilos + imagen propia con punto de foco), tipografía (4),
  paleta de colores (5) y cuadrícula (3) se configuran en la sección Diseño del detalle; la vista
  del cliente navega por pestañas de secciones con filtro de favoritas.
- **Vista previa y compartir**: botón "Vista previa" (`/g/<slug>/preview`, requiere tu sesión) con
  banda indicadora y acciones deshabilitadas, y botón "Copiar enlace" para enviar al cliente.
- **Secciones obligatorias**: toda foto vive en una sección; para subir hay que crear una; eliminar
  una sección con fotos pide a dónde moverlas.
```

- [ ] **Step 4: Verificación manual (humano; documentar pendiente)** — Diseño (4 ejes + foco + subir/quitar portada), preview con banda y acciones muertas, copiar enlace, pestañas + favoritas + menú zip, subir sin secciones (bloqueado), eliminar sección con fotos (diálogo), galería en borrador visible solo en preview, móvil.

- [ ] **Step 5: Commit**

```bash
git add README.md && git commit -m "docs: document gallery design axes, preview and mandatory sections"
```

---

## Self-Review (aplicado)

- **Cobertura spec:** migración 0008 completa (columnas+mapeo+drops+backfill+NOT NULL) T1; updateGalleryDesign+INVALID_COVER_KEY+replacedCoverKey T1; deleteSection con destino/SECTION_NOT_EMPTY/INVALID_TARGET + uploader/mover/delete UI T2; tokens por eje + banner + cuadrícula square + radio 2px T3; barra de título pegajosa + pestañas visibles sin "Todas" + favoritas + zip de sección en el menú T4; upload de portada + picker de foco + prioridad efectiva (helper con test) + puerta T5; preview requireStudio + banda + acciones deshabilitadas + borrador visible + copiar enlace T6; limpieza+README T7.
- **Placeholders:** los bloques `/* mismas labels que page.tsx */` y "extraer el bloque" refieren a código existente del archivo que se edita (visible para el implementador); el resto lleva código completo.
- **Tipos:** ejes/constantes (T1) usados en T3-T5; `GalleryDesign` (T3) consumido por TitleBar (T4) y DesignSection (T5); `pickCoverSource` genérico sobre el shape mínimo de Photo; `getPreviewGalleryData` devuelve `ClientGalleryData` exacto para `buildGalleryProps` (T6); `deleteSection` firma nueva usada por `deleteSectionAction` y `delete-section.tsx` (T2).
