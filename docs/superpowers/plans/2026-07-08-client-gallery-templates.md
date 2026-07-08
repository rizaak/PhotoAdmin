# Plantillas de diseño de la galería del cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseño premium de `/g/[slug]` (acceso, galería, lightbox) con 4 plantillas seleccionables por galería: `editorial` (default), `cinematico`, `luminoso`, `clasico`.

**Architecture:** Tokens de diseño centrales (`templates.ts`) + fuentes `next/font` visten componentes compartidos; solo la portada tiene 4 variantes estructurales. `client-gallery.tsx` se divide en portada / header pegajoso / grid justificado / lightbox. El dominio NO cambia — solo presentación + select de plantilla en el admin (reemplaza al de tema).

**Tech Stack:** Next.js 16 App Router, Tailwind, `motion` (framer-motion, dependencia NUEVA aprobada), `next/font/google`, next-intl.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-client-gallery-templates-design.md`.
- SIN cambios de dominio: likes/comentarios/descargas/zip/sesiones/marcas siguen usando las MISMAS acciones y funciones; el fail-closed de delivery no se toca.
- Plantillas exactas: `editorial | cinematico | luminoso | clasico`, default `editorial`; la constante vive en `src/db/schema.ts` como `GALLERY_TEMPLATES` y todos la importan de ahí.
- El grid preserva el ORDEN de las fotos y su proporción real (`width/height` de DB, fallback 3:2 si faltan).
- Animaciones respetan `prefers-reduced-motion` (hook `useReducedMotion` de motion).
- CERO emojis en la UI del cliente: iconos SVG de línea (stroke 1.5) de `icons.tsx`. Sin contador en el lightbox. Sin `alert()`.
- i18n: paridad de claves es/en obligatoria.
- Migración: `sh -c 'set -a; . ./.env.local; set +a; npm run db:migrate'` — NUNCA imprimir `.env.local`.
- Gate por tarea: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` (cero warnings).
- Next 16 puede diferir del conocimiento previo: ante dudas de API (next/font, etc.) consultar `node_modules/next/dist/docs/`.

---

### Task 1: Fundaciones — dependencia motion, fuentes, tokens y helper de grid

**Files:**
- Create: `src/app/g/[slug]/fonts.ts`, `src/app/g/[slug]/templates.ts`, `src/app/g/[slug]/gallery-layout.ts`
- Modify: `src/db/schema.ts` (constante GALLERY_TEMPLATES junto a `galleries`), `package.json` (dep motion)
- Test: `tests/app/gallery-layout.test.ts`, `tests/app/templates.test.ts`

**Interfaces:**
- Produces: `GALLERY_TEMPLATES` y `type GalleryTemplate` (schema); `TEMPLATE_TOKENS: Record<GalleryTemplate, TemplateTokens>`; `fontVariables: string`; `aspectRatio(p): number`; `flexProps(ar, targetH): { flexGrow: number; flexBasis: number }`.

- [ ] **Step 1: Instalar motion**

```bash
npm install motion
```

- [ ] **Step 2: Constante en schema** — en `src/db/schema.ts`, encima de `export const galleries`:

```ts
export const GALLERY_TEMPLATES = ["editorial", "cinematico", "luminoso", "clasico"] as const;
export type GalleryTemplate = (typeof GALLERY_TEMPLATES)[number];
```

- [ ] **Step 3: Tests RED del helper** — `tests/app/gallery-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aspectRatio, flexProps } from "@/app/g/[slug]/gallery-layout";

describe("aspectRatio", () => {
  it("uses real dimensions", () => {
    expect(aspectRatio({ width: 3000, height: 2000 })).toBeCloseTo(1.5);
    expect(aspectRatio({ width: 2000, height: 3000 })).toBeCloseTo(0.667, 2);
  });
  it("falls back to 3:2 without dimensions", () => {
    expect(aspectRatio({ width: null, height: null })).toBe(1.5);
    expect(aspectRatio({ width: 0, height: 100 })).toBe(1.5);
    expect(aspectRatio({ width: 100, height: 0 })).toBe(1.5);
  });
});

describe("flexProps", () => {
  it("is proportional to aspect ratio and target height", () => {
    const wide = flexProps(2, 280);
    const tall = flexProps(0.5, 280);
    expect(wide.flexBasis).toBe(560);
    expect(tall.flexBasis).toBe(140);
    expect(wide.flexGrow).toBeGreaterThan(tall.flexGrow);
  });
});
```

`tests/app/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GALLERY_TEMPLATES } from "@/db/schema";
import { TEMPLATE_TOKENS } from "@/app/g/[slug]/templates";

describe("TEMPLATE_TOKENS", () => {
  it("defines every token for every template", () => {
    for (const key of GALLERY_TEMPLATES) {
      const tk = TEMPLATE_TOKENS[key];
      expect(tk).toBeDefined();
      for (const field of ["bg", "text", "muted", "accent", "surface", "display", "body", "photoRadius", "cover"] as const) {
        expect(tk[field], `${key}.${field}`).toBeTruthy();
      }
      expect(typeof tk.dark).toBe("boolean");
      expect(typeof tk.photoFrame).toBe("boolean");
    }
  });
  it("only cinematico is dark and covers are the 4 variants", () => {
    expect(GALLERY_TEMPLATES.filter((k) => TEMPLATE_TOKENS[k].dark)).toEqual(["cinematico"]);
    expect(GALLERY_TEMPLATES.map((k) => TEMPLATE_TOKENS[k].cover)).toEqual(["full", "lowline", "warm", "split"]);
  });
});
```

Run: `npx vitest run tests/app` → FAIL (módulos no existen).

- [ ] **Step 4: fonts.ts** — `src/app/g/[slug]/fonts.ts` (verificar API exacta en `node_modules/next/dist/docs/` si tsc protesta):

```ts
import { Cormorant_Garamond, Inter, Playfair_Display, Nunito, EB_Garamond, Lato } from "next/font/google";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-cormorant" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-playfair" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito" });
const ebGaramond = EB_Garamond({ subsets: ["latin"], variable: "--font-garamond" });
const lato = Lato({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-lato" });

// className con todas las CSS vars — se aplica una vez en el wrapper de /g/[slug]
export const fontVariables = [cormorant, inter, playfair, nunito, ebGaramond, lato]
  .map((f) => f.variable).join(" ");
```

- [ ] **Step 5: templates.ts** — `src/app/g/[slug]/templates.ts`:

```ts
import type { GalleryTemplate } from "@/db/schema";

export type TemplateTokens = {
  bg: string; text: string; muted: string; accent: string; surface: string;
  display: string; body: string;               // valores font-family CSS
  displayWeight: number; displayStyle: "normal" | "italic";
  displayTransform: "uppercase" | "none"; displayTracking: string;
  photoRadius: string; photoFrame: boolean;    // frame = marco blanco + sombra (clasico)
  cover: "full" | "lowline" | "warm" | "split";
  dark: boolean;
};

export const TEMPLATE_TOKENS: Record<GalleryTemplate, TemplateTokens> = {
  editorial: {
    bg: "#ffffff", text: "#1a1a1a", muted: "#8a8a8a", accent: "#1a1a1a", surface: "#ffffff",
    display: "var(--font-cormorant), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 300, displayStyle: "normal", displayTransform: "uppercase", displayTracking: "0.18em",
    photoRadius: "0px", photoFrame: false, cover: "full", dark: false,
  },
  cinematico: {
    bg: "#0e0e10", text: "#f4f1ea", muted: "#9c968a", accent: "#c8a96a", surface: "#17171a",
    display: "var(--font-playfair), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 500, displayStyle: "italic", displayTransform: "none", displayTracking: "0.02em",
    photoRadius: "2px", photoFrame: false, cover: "lowline", dark: true,
  },
  luminoso: {
    bg: "#fdf9f4", text: "#5b4a3f", muted: "#a08d7f", accent: "#c98d6b", surface: "#ffffff",
    display: "var(--font-nunito), sans-serif", body: "var(--font-nunito), sans-serif",
    displayWeight: 700, displayStyle: "normal", displayTransform: "none", displayTracking: "0.01em",
    photoRadius: "16px", photoFrame: false, cover: "warm", dark: false,
  },
  clasico: {
    bg: "#faf7f2", text: "#2b2b2b", muted: "#8a8a8a", accent: "#b59a68", surface: "#ffffff",
    display: "var(--font-garamond), Georgia, serif", body: "var(--font-lato), sans-serif",
    displayWeight: 400, displayStyle: "normal", displayTransform: "none", displayTracking: "0.06em",
    photoRadius: "0px", photoFrame: true, cover: "split", dark: false,
  },
};
```

- [ ] **Step 6: gallery-layout.ts** — `src/app/g/[slug]/gallery-layout.ts`:

```ts
// Grid de filas justificadas sin librería: cada figura recibe
// flex-grow ∝ aspect-ratio y flex-basis = ar × altura objetivo;
// el CSS (aspect-ratio + flex-wrap + spacer final) hace el resto.
export function aspectRatio(p: { width: number | null; height: number | null }): number {
  if (!p.width || !p.height || p.width <= 0 || p.height <= 0) return 1.5; // fallback 3:2
  return p.width / p.height;
}

export function flexProps(ar: number, targetH: number): { flexGrow: number; flexBasis: number } {
  return { flexGrow: ar * 100, flexBasis: Math.round(ar * targetH) };
}
```

- [ ] **Step 7: GREEN + gate + commit**

```bash
npx vitest run tests/app && npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: gallery template tokens, fonts and justified-grid helper"
```

---

### Task 2: Plantilla por galería — migración 0007 + admin

**Files:**
- Modify: `src/db/schema.ts` (default de `coverTemplate`), `src/server/galleries.ts` (Zod), `src/app/admin/galleries/[id]/actions.ts`, `src/app/admin/galleries/[id]/page.tsx`, `messages/es.json`, `messages/en.json`
- Create: `drizzle/0007_*.sql` (generada + data UPDATE)
- Test: `tests/server/galleries.test.ts` (coverTemplate en settings)

**Interfaces:**
- Consumes: `GALLERY_TEMPLATES` (T1).
- Produces: `updateGallerySettings` acepta `coverTemplate` y RECHAZA `theme`; `gallery.coverTemplate` tipado como plantilla en consumidores.

- [ ] **Step 1: Test RED** — en `tests/server/galleries.test.ts` añadir:

```ts
it("updates the gallery template and rejects unknown values", async () => {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const g = await createGallery(db, studio.id, { title: "g" });
  expect(g.coverTemplate).toBe("editorial");
  const upd = await updateGallerySettings(db, studio.id, g.id, { coverTemplate: "cinematico" });
  expect(upd.coverTemplate).toBe("cinematico");
  await expect(updateGallerySettings(db, studio.id, g.id, { coverTemplate: "neon" as never }))
    .rejects.toThrow();
});
```

(El primer expect fallará hasta cambiar el default; ajustar tests existentes que asuman `theme` en updateGallerySchema.)

- [ ] **Step 2: Schema + migración** — en `src/db/schema.ts`: `coverTemplate: text("cover_template").notNull().default("editorial")`. Luego `npx drizzle-kit generate --name gallery_template_default` y APPEND al SQL generado:

```sql
--> statement-breakpoint
UPDATE "galleries" SET "cover_template" = 'editorial' WHERE "cover_template" = 'classic';
```

Aplicar a Neon con el comando de Global Constraints.

- [ ] **Step 3: Zod** — en `src/server/galleries.ts`: importar `GALLERY_TEMPLATES` desde `@/db/schema`; en `updateGallerySchema` ELIMINAR `theme` y añadir `coverTemplate: z.enum(GALLERY_TEMPLATES).optional()`.

- [ ] **Step 4: Admin** — en `src/app/admin/galleries/[id]/actions.ts` (`settingsForm` + parse): quitar `theme`, añadir `coverTemplate: z.enum(GALLERY_TEMPLATES)` y `coverTemplate: formData.get("coverTemplate")`. En `src/app/admin/galleries/[id]/page.tsx`: reemplazar el `<label>` del select `theme` por:

```tsx
          <label className="flex flex-col gap-1">
            {t("template")}
            <select name="coverTemplate" defaultValue={gallery.coverTemplate} className={input}>
              <option value="editorial">{t("templates.editorial")}</option>
              <option value="cinematico">{t("templates.cinematico")}</option>
              <option value="luminoso">{t("templates.luminoso")}</option>
              <option value="clasico">{t("templates.clasico")}</option>
            </select>
          </label>
```

- [ ] **Step 5: i18n** — en `galleryDetail` de ambos idiomas: QUITAR `theme` y `themes`; AÑADIR es: `"template": "Plantilla"`, `"templates": { "editorial": "Editorial", "cinematico": "Cinemático oscuro", "luminoso": "Luminoso tierno", "clasico": "Clásico elegante" }` / en: `"template": "Template"`, `"templates": { "editorial": "Editorial", "cinematico": "Cinematic dark", "luminoso": "Soft & bright", "clasico": "Classic elegant" }`.

- [ ] **Step 6: Gate + commit** (la vista cliente sigue leyendo `theme` hasta T4 — el campo sigue en la tabla, solo salió del Zod/admin, el build debe seguir verde)

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: per-gallery design template selection in admin (replaces theme)"
```

---

### Task 3: Puerta de acceso rediseñada

**Files:**
- Modify: `src/app/g/[slug]/access-form.tsx`, `src/app/g/[slug]/page.tsx` (rama sin sesión), `messages/es.json`, `messages/en.json`

**Interfaces:**
- Consumes: `TEMPLATE_TOKENS`, `fontVariables` (T1); `viewKeys`/`effectiveWatermarkMode` de `@/server/delivery` (firmas actuales — copiar el patrón de uso de la rama autenticada del mismo page.tsx).
- Produces: `AccessForm` con props `{ slug, galleryTitle, hasPassword, template: GalleryTemplate, coverUrl: string | null, labels }`.

- [ ] **Step 1: page.tsx rama sin sesión** — cargar portada con el MISMO gate fail-closed de la vista (sin variante requerida → sin fondo):

```tsx
  if (!session) {
    const gallery = await getPublicGallery(db, slug).catch(() => null);
    if (!gallery) notFound();
    let coverUrl: string | null = null;
    if (gallery.coverPhotoId) {
      const [cover] = await db.select().from(photos)
        .where(and(eq(photos.id, gallery.coverPhotoId), eq(photos.galleryId, gallery.id)));
      const [section] = cover?.sectionId
        ? await db.select().from(sections).where(eq(sections.id, cover.sectionId))
        : [];
      if (cover) {
        const mode = effectiveWatermarkMode(cover, section ?? null,
          { watermarkMode: gallery.watermarkMode, hasWatermarks: !!gallery.watermarkId });
        const keys = viewKeys(cover, mode);
        if (keys) coverUrl = await presignDownload(keys.webKey);
      }
    }
    return (
      <AccessForm
        slug={slug} galleryTitle={gallery.title} hasPassword={gallery.passwordHash !== null}
        template={gallery.coverTemplate as GalleryTemplate} coverUrl={coverUrl}
        labels={/* los actuales */}
      />
    );
  }
```

(Imports nuevos: `photos`, `sections` de `@/db/schema`, `and/eq` de drizzle, `viewKeys` de delivery, `GalleryTemplate`. Ajustar a las firmas REALES de delivery.ts si difieren — usar la rama autenticada como referencia.)

- [ ] **Step 2: AccessForm** — reescribir `src/app/g/[slug]/access-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { fontVariables } from "./fonts";
import { enterGalleryAction, type EnterState } from "./actions";

type Labels = {
  welcome: string; emailLabel: string; nameLabel: string; passwordLabel: string;
  enter: string; invalidPassword: string; tooManyAttempts: string; genericError: string;
};

export function AccessForm({
  slug, galleryTitle, hasPassword, template, coverUrl, labels,
}: {
  slug: string; galleryTitle: string; hasPassword: boolean;
  template: GalleryTemplate; coverUrl: string | null; labels: Labels;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const action = enterGalleryAction.bind(null, slug);
  const [state, formAction, pending] = useActionState<EnterState, FormData>(action, null);

  const input =
    "w-full border-0 border-b bg-transparent px-1 py-2 text-sm outline-none focus:border-current";

  return (
    <main
      className={`relative flex min-h-screen items-center justify-center overflow-hidden p-6 ${fontVariables}`}
      style={{ background: tk.bg, color: tk.text, fontFamily: tk.body }}
    >
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" draggable={false} aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md brightness-[.55]" />
      )}
      <motion.form
        action={formAction}
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
        className="relative w-full max-w-sm space-y-5 rounded-xl p-9 shadow-2xl backdrop-blur-md"
        style={{ background: coverUrl ? "rgba(255,255,255,.92)" : tk.surface, color: "#1f1f1f" }}
      >
        <p className="text-xs" style={{ color: tk.accent, letterSpacing: "0.25em", textTransform: "uppercase" }}>
          {labels.welcome}
        </p>
        <h1
          className="text-3xl leading-snug"
          style={{ fontFamily: tk.display, fontWeight: tk.displayWeight, fontStyle: tk.displayStyle,
            textTransform: tk.displayTransform, letterSpacing: tk.displayTracking }}
        >
          {galleryTitle}
        </h1>
        <input name="email" type="email" required placeholder={labels.emailLabel} className={input} />
        <input name="name" placeholder={labels.nameLabel} className={input} />
        {hasPassword && (
          <input name="password" type="password" required placeholder={labels.passwordLabel} className={input} />
        )}
        {state?.error && <p className="text-sm text-red-600">{labels[state.error]}</p>}
        <button
          disabled={pending}
          className="w-full rounded-full py-2.5 text-sm text-white transition-opacity disabled:opacity-50"
          style={{ background: tk.dark ? tk.accent : "#1a1a1a" }}
        >
          {labels.enter}
        </button>
      </motion.form>
    </main>
  );
}
```

- [ ] **Step 3: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: templated access door with blurred cover backdrop"
```

---

### Task 4: Galería — portadas, header pegajoso, grid justificado y animaciones

**Files:**
- Create: `src/app/g/[slug]/icons.tsx`, `src/app/g/[slug]/gallery-cover.tsx`, `src/app/g/[slug]/gallery-header.tsx`, `src/app/g/[slug]/photo-grid.tsx`
- Modify: `src/app/g/[slug]/client-gallery.tsx` (reescritura: composición + estado), `src/app/g/[slug]/page.tsx` (props nuevas), `messages/es.json`, `messages/en.json`

**Interfaces:**
- Consumes: T1 (`TEMPLATE_TOKENS`, `fontVariables`, `aspectRatio`, `flexProps`), acciones actuales de `./actions`.
- Produces: `ClientPhoto` gana `width: number | null; height: number | null`; `ClientGallery` props ganan `template: GalleryTemplate` y pierden `theme`; `Icon*` componentes SVG; el lightbox ACTUAL se conserva temporalmente (T5 lo reemplaza) recibiendo los mismos datos de hoy.

- [ ] **Step 1: icons.tsx** — `src/app/g/[slug]/icons.tsx`:

```tsx
// Iconos de línea compartidos (stroke 1.5). Sin emojis en la UI del cliente.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconHeart = ({ filled = false, className = "" }: { filled?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z" />
  </svg>
);
export const IconComment = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
  </svg>
);
export const IconDownload = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
);
export const IconClose = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconPrev = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconNext = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M9 5l7 7-7 7" /></svg>
);
export const IconChevronDown = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6 9l6 6 6-6" /></svg>
);
```

- [ ] **Step 2: gallery-cover.tsx** — 4 variantes estructurales; respeta punto focal:

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { IconChevronDown } from "./icons";

export function GalleryCover({
  template, title, coverUrl, focalX, focalY,
}: {
  template: GalleryTemplate; title: string; coverUrl: string | null;
  focalX: number; focalY: number;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const reduce = useReducedMotion();
  const fade = reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9 } };
  const titleStyle = {
    fontFamily: tk.display, fontWeight: tk.displayWeight, fontStyle: tk.displayStyle,
    textTransform: tk.displayTransform, letterSpacing: tk.displayTracking,
  } as const;
  const img = coverUrl && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={coverUrl} alt="" draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }} />
  );

  if (tk.cover === "split") {
    return (
      <header className="grid min-h-[70vh] md:grid-cols-2" style={{ background: tk.bg }}>
        <motion.div {...fade} className="flex flex-col items-center justify-center p-10 text-center">
          <h1 className="text-4xl md:text-5xl" style={titleStyle}>{title}</h1>
          <div className="mt-6 h-px w-14" style={{ background: tk.accent }} />
        </motion.div>
        <div className="relative min-h-[40vh]">{img}</div>
      </header>
    );
  }

  const overlay =
    tk.cover === "lowline" ? `linear-gradient(to top, ${tk.bg} 4%, transparent 55%)`
    : tk.cover === "warm" ? `linear-gradient(to top, ${tk.bg} 2%, transparent 45%)`
    : "linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.12))";

  return (
    <header className={`relative overflow-hidden ${tk.cover === "full" ? "h-screen" : "h-[78vh]"} min-h-72`}>
      {img}
      <div className="absolute inset-0" style={{ background: overlay }} />
      <motion.div
        {...fade}
        className={`absolute inset-0 flex flex-col p-8 md:p-12 ${
          tk.cover === "lowline" ? "items-start justify-end" : "items-center " + (tk.cover === "warm" ? "justify-end pb-16" : "justify-center")
        }`}
      >
        <h1 className="text-4xl md:text-6xl" style={{ ...titleStyle, color: tk.cover === "full" ? "#fff" : tk.text }}>
          {title}
        </h1>
        {tk.cover === "lowline" && <div className="mt-3 h-px w-16" style={{ background: tk.accent }} />}
        {tk.cover === "full" && (
          <motion.span
            className="absolute bottom-8 text-white/80"
            animate={reduce ? undefined : { y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2.2 }}
          >
            <IconChevronDown className="h-6 w-6" />
          </motion.span>
        )}
      </motion.div>
    </header>
  );
}
```

- [ ] **Step 3: gallery-header.tsx** — barra pegajosa que aparece tras la portada, con menú ZIP:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { IconDownload } from "./icons";

type Res = "web" | "high" | "original";

export function GalleryHeader({
  template, title, sentinel, zip, labels, onZip,
}: {
  template: GalleryTemplate; title: string;
  sentinel: React.RefObject<HTMLElement | null>;
  zip: { enabled: boolean; resolutions: Res[] };
  labels: { downloadGallery: string; downloadFavorites: string; resolutions: Record<Res, string> };
  onZip: (scope: { type: "gallery" | "favorites" }, resolution: Res) => void;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Res>(zip.resolutions[0] ?? "web");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ y: -48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -48, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 py-2.5 backdrop-blur-md"
          style={{ background: tk.dark ? "rgba(14,14,16,.82)" : "rgba(255,255,255,.85)",
            borderColor: tk.dark ? "#26262a" : "#eee", color: tk.text }}
        >
          <span className="truncate text-sm" style={{ fontFamily: tk.display, fontStyle: tk.displayStyle,
            textTransform: tk.displayTransform, letterSpacing: tk.displayTracking }}>
            {title}
          </span>
          {zip.enabled && zip.resolutions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: tk.dark ? "#3a3a40" : "#ddd" }}>
                <IconDownload className="h-4 w-4" />
              </button>
              {open && (
                <div role="menu"
                  className="absolute right-0 mt-2 w-56 space-y-2 rounded-lg border p-3 text-sm shadow-xl"
                  style={{ background: tk.surface, borderColor: tk.dark ? "#3a3a40" : "#e5e5e5", color: tk.text }}>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value as Res)}
                    className="w-full rounded border bg-transparent px-2 py-1.5 text-xs"
                    style={{ borderColor: tk.dark ? "#3a3a40" : "#ddd" }}>
                    {zip.resolutions.map((r) => <option key={r} value={r}>{labels.resolutions[r]}</option>)}
                  </select>
                  <button role="menuitem" onClick={() => { setOpen(false); onZip({ type: "gallery" }, resolution); }}
                    className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70">
                    {labels.downloadGallery}
                  </button>
                  <button role="menuitem" onClick={() => { setOpen(false); onZip({ type: "favorites" }, resolution); }}
                    className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70">
                    {labels.downloadFavorites}
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: photo-grid.tsx** — filas justificadas + fade-up + iconos:

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { aspectRatio, flexProps } from "./gallery-layout";
import { IconHeart, IconComment } from "./icons";
import type { ClientPhoto } from "./client-gallery";

export function PhotoGrid({
  template, photos, onOpen, onToggleLike, likeLabel, unlikeLabel,
}: {
  template: GalleryTemplate; photos: ClientPhoto[];
  onOpen: (p: ClientPhoto) => void; onToggleLike: (p: ClientPhoto) => void;
  likeLabel: string; unlikeLabel: string;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const reduce = useReducedMotion();
  const frame = tk.photoFrame
    ? { border: "5px solid #ffffff", boxShadow: "0 2px 14px rgba(0,0,0,.14)" } : {};

  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p, i) => {
        const ar = aspectRatio(p);
        const { flexGrow, flexBasis } = flexProps(ar, 280);
        return (
          <motion.figure
            key={p.id}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -60px 0px" }}
            transition={{ duration: 0.5, delay: (i % 6) * 0.05 }}
            className="group relative cursor-pointer overflow-hidden"
            style={{ aspectRatio: String(ar), flexGrow, flexBasis: `${flexBasis}px`,
              borderRadius: tk.photoRadius, ...frame }}
            onClick={() => onOpen(p)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img layoutId={`photo-${p.id}`} src={p.thumbUrl} alt={p.filename} draggable={false}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            <button
              aria-label={p.liked ? unlikeLabel : likeLabel}
              onClick={(e) => { e.stopPropagation(); onToggleLike(p); }}
              className={`absolute right-2 top-2 rounded-full bg-black/35 p-2 text-white backdrop-blur transition-opacity ${
                p.liked ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              }`}
            >
              <IconHeart filled={p.liked} className={`h-4 w-4 ${p.liked ? "text-red-400" : ""}`} />
            </button>
            {p.comment && (
              <span className="absolute bottom-2 right-2 rounded-full bg-black/35 p-1.5 text-white backdrop-blur">
                <IconComment className="h-3.5 w-3.5" />
              </span>
            )}
          </motion.figure>
        );
      })}
      <div style={{ flexGrow: 1e4 }} aria-hidden />
    </div>
  );
}
```

- [ ] **Step 5: client-gallery.tsx** — reescritura como contenedor. CONSERVAR: tipo `ClientPhoto` (+ `width`/`height` nullable), estado y funciones `onToggleLike`/`onDownload`/`onZip`/`onComment` tal cual (cambiando `alert(...)` por `setNotice(mensaje)` con auto-clear a 4 s), agrupación `bySection`. NUEVO: props `template: GalleryTemplate` (fuera `theme`), wrapper `<main className={fontVariables} style={{ background: tk.bg, color: tk.text, fontFamily: tk.body }}>`, sentinel `<div ref={sentinelRef} className="absolute top-[60vh]" />` para el header, composición `<GalleryCover …/> <GalleryHeader …/>`, aviso `notice` como banda fija inferior discreta (`fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs`, colores `tk.surface`/`tk.text`), encabezados de sección con `tk.display` + icono descarga por sección (IconDownload pequeño, como hoy pero SVG), `<PhotoGrid …/>` por sección, y el LIGHTBOX ACTUAL (JSX del overlay existente) conservado con sus mismas funciones (T5 lo reemplaza). `page.tsx`: pasar `template: data.gallery.coverTemplate as GalleryTemplate`, `width: p.width, height: p.height` en photoViews, y quitar `theme`.

- [ ] **Step 6: i18n** — añadir en `clientGallery` es/en: `"close": "Cerrar"/"Close"`, `"prev": "Anterior"/"Previous"`, `"next": "Siguiente"/"Next"` (los usa T5; añadirlos ya mantiene una sola pasada de i18n). Pasar por props: `labels.close/prev/next`.

- [ ] **Step 7: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: templated gallery with justified grid, sticky header and motion"
```

---

### Task 5: Lightbox inmersivo

**Files:**
- Create: `src/app/g/[slug]/lightbox.tsx`
- Modify: `src/app/g/[slug]/client-gallery.tsx` (reemplaza el overlay antiguo)

**Interfaces:**
- Consumes: `ClientPhoto` (con `webUrl`, `downloads`, `liked`, `comment`), iconos (T4), labels `close/prev/next/like/unlike/comments/commentPlaceholder/send/download/resolutions/actionError`.
- Produces: `<Lightbox photos={flatPhotos} openId={id|null} onClose onNavigate(id) onToggleLike(p) onDownload(p, res) onComment(p, body)→Promise<void> labels busy/>` — el contenedor mantiene el estado; el lightbox es presentación + gestos.

- [ ] **Step 1: lightbox.tsx** — comportamiento aprobado en mockup: inmersivo, sin contador, iconos flotantes auto-ocultables (~2.5 s), panel de comentario deslizante, popover de resoluciones, teclado ←/→/Escape, swipe horizontal para navegar y arrastre vertical para cerrar, error inline (banda breve sobre los controles):

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconClose, IconPrev, IconNext, IconHeart, IconComment, IconDownload } from "./icons";
import type { ClientPhoto } from "./client-gallery";

type Res = "web" | "high" | "original";
type Labels = {
  close: string; prev: string; next: string; like: string; unlike: string;
  comments: string; commentPlaceholder: string; send: string; download: string;
  resolutions: Record<Res, string>; actionError: string;
};

export function Lightbox({
  photos, openId, busy, labels, onClose, onNavigate, onToggleLike, onDownload, onComment,
}: {
  photos: ClientPhoto[]; openId: string | null; busy: boolean; labels: Labels;
  onClose: () => void; onNavigate: (id: string) => void;
  onToggleLike: (p: ClientPhoto) => void;
  onDownload: (p: ClientPhoto, res: Res) => Promise<void>;
  onComment: (p: ClientPhoto, body: string) => Promise<void>;
}) {
  const reduce = useReducedMotion();
  const idx = photos.findIndex((p) => p.id === openId);
  const photo = idx >= 0 ? photos[idx] : null;
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<"none" | "comment" | "download">("none");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 2500);
  }, []);

  useEffect(() => {
    if (!photo) return;
    poke();
    setPanel("none");
    setDraft(photo.comment?.body ?? "");
    setError(null);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((dir: 1 | -1) => {
    if (idx < 0) return;
    const next = photos[idx + dir];
    if (next) onNavigate(next.id);
  }, [idx, photos, onNavigate]);

  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photo, go, onClose]);

  if (!photo) return null;
  const fail = (msg: string) => { setError(msg); setTimeout(() => setError(null), 3500); };
  const pill = "flex items-center justify-center rounded-full bg-neutral-900/55 p-3 text-white backdrop-blur-md";

  return (
    <AnimatePresence>
      <motion.div
        key="lb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black"
        onMouseMove={poke} onTouchStart={(e) => { poke(); touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t = touch.current; touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
          else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
        }}
      >
        <div className="flex h-full items-center justify-center" onClick={onClose}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            layoutId={reduce ? undefined : `photo-${photo.id}`}
            src={photo.webUrl} alt={photo.filename} draggable={false}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <AnimatePresence>
          {controls && (
            <motion.div key="ctl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button aria-label={labels.close} onClick={onClose} className={`${pill} absolute right-4 top-4`}>
                <IconClose className="h-4 w-4" />
              </button>
              {idx > 0 && (
                <button aria-label={labels.prev} onClick={() => go(-1)}
                  className={`${pill} absolute left-3 top-1/2 -translate-y-1/2`}>
                  <IconPrev className="h-5 w-5" />
                </button>
              )}
              {idx < photos.length - 1 && (
                <button aria-label={labels.next} onClick={() => go(1)}
                  className={`${pill} absolute right-3 top-1/2 -translate-y-1/2`}>
                  <IconNext className="h-5 w-5" />
                </button>
              )}
              <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-3">
                <button aria-label={photo.liked ? labels.unlike : labels.like} className={pill}
                  onClick={() => onToggleLike(photo)}>
                  <IconHeart filled={photo.liked} className={`h-4.5 w-4.5 h-[18px] w-[18px] ${photo.liked ? "text-red-400" : ""}`} />
                </button>
                <button aria-label={labels.comments} className={pill}
                  onClick={() => setPanel(panel === "comment" ? "none" : "comment")}>
                  <IconComment className="h-[18px] w-[18px]" />
                </button>
                {photo.downloads.length > 0 && (
                  <button aria-label={labels.download} className={pill}
                    onClick={() => setPanel(panel === "download" ? "none" : "download")}>
                    <IconDownload className="h-[18px] w-[18px]" />
                  </button>
                )}
              </div>
              {error && (
                <p className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-red-600/85 px-4 py-1.5 text-xs text-white">
                  {error}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {panel === "download" && (
            <motion.div key="dl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col gap-1 rounded-xl bg-neutral-900/85 p-2 text-sm text-white backdrop-blur-md">
              {photo.downloads.map((r) => (
                <button key={r} disabled={busy}
                  onClick={() => { setPanel("none"); void onDownload(photo, r).catch(() => fail(labels.actionError)); }}
                  className="rounded-lg px-4 py-1.5 text-left hover:bg-white/10 disabled:opacity-50">
                  {labels.resolutions[r]}
                </button>
              ))}
            </motion.div>
          )}
          {panel === "comment" && (
            <motion.aside key="cm" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="absolute inset-y-0 right-0 w-full max-w-xs space-y-3 bg-neutral-900/92 p-5 text-white backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm opacity-80">{labels.comments}</h3>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4}
                placeholder={labels.commentPlaceholder}
                className="w-full resize-none rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/50" />
              <button disabled={busy || !draft.trim()}
                onClick={() => void onComment(photo, draft).catch(() => fail(labels.actionError))}
                className="rounded-full bg-white px-4 py-1.5 text-sm text-neutral-900 disabled:opacity-50">
                {labels.send}
              </button>
            </motion.aside>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Integración** — en `client-gallery.tsx`: eliminar el overlay antiguo; estado pasa a `openId: string | null`; `flatPhotos = bySection.flatMap((s) => s.photos)` (orden visible); `onComment(photo, body)` envuelve el `addCommentAction` actual; `onDownload(photo, res)` envuelve `downloadPhotoAction`. Render: `<Lightbox photos={flatPhotos} openId={openId} busy={busy} labels={…} onClose={() => setOpenId(null)} onNavigate={setOpenId} onToggleLike={onToggleLike} onDownload={onDownload} onComment={onComment} />`. Limpiar estado muerto (`openPhoto`, `resolution` del overlay viejo).

- [ ] **Step 3: Gate + commit**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
git add -A && git commit -m "feat: immersive lightbox with auto-hiding controls and gestures"
```

---

### Task 6: Verificación final + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Limpieza verificada** — `grep -rn "theme" src/app/g src/server/galleries.ts` no debe mostrar usos de `gallery.theme` (la columna sigue en schema, sin consumidores); `grep -rn "alert(" src/app/g` vacío; `grep -rn "♥\|💬\|⬇" src/app/g` vacío.

- [ ] **Step 2: Gate completo**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src tests
cd workers/zip && npx tsc --noEmit && cd ../..
```

- [ ] **Step 3: README** — en la sección de galerías/entrega, añadir bullet:

```markdown
- **Plantillas por galería**: Editorial, Cinemático oscuro, Luminoso tierno y Clásico elegante —
  se eligen en el detalle de la galería y visten portada, grid, acceso y lightbox del cliente.
```

- [ ] **Step 4: Verificación manual (humano; documentar como pendiente)** — con una galería por plantilla: puerta de acceso (fondo portada difuminada), portada, grid (orden y proporciones), hover like/comentario, header pegajoso + ZIP, lightbox (teclado, swipe, auto-ocultado, comentario, descarga), móvil, `prefers-reduced-motion`.

- [ ] **Step 5: Commit**

```bash
git add README.md && git commit -m "docs: document client gallery templates"
```

---

## Self-Review (aplicado)

- **Cobertura spec:** 4 plantillas+tokens+fuentes (T1), selección admin+migración 0007 classic→editorial+theme fuera (T2), acceso (T3), portadas 4 variantes+grid justificado+header pegajoso+animaciones+SVG (T4), lightbox inmersivo aprobado (T5), verificación+README (T6). Grid preserva orden (flex-wrap pinta en orden DOM) y proporción; `prefers-reduced-motion` en cover/grid/lightbox; sin alert() (banda inline en galería T4 y lightbox T5); walkthrough manual en T6.
- **Placeholders:** el único "los actuales" (labels de AccessForm en T3) refiere a props ya existentes en el archivo que el implementador está editando; código completo en todos los pasos nuevos.
- **Tipos:** `GalleryTemplate`/`GALLERY_TEMPLATES` de schema en T1 y usados en T2-T5; `TemplateTokens.cover` = variantes usadas en gallery-cover; `ClientPhoto` +width/height (T4) consumido por `aspectRatio` (firma T1); labels `close/prev/next` añadidos en T4 Step 6 y consumidos en T5; `flexProps(ar, 280)` coincide con firma T1.
