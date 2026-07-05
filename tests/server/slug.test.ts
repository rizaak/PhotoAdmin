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
