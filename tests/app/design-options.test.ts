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
