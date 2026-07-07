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
