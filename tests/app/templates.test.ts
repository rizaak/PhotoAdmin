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
