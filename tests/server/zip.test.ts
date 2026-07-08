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
