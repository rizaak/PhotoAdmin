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
