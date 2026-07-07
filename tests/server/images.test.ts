import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage, makeDerivatives, applyWatermark } from "@/server/images";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } },
  }).jpeg().toBuffer();
}

describe("processImage", () => {
  it("generates 400px thumb and 2048px web derivatives and reports dimensions", async () => {
    const out = await processImage(await makeJpeg(3000, 2000));
    expect(out.width).toBe(3000);
    expect(out.height).toBe(2000);
    const thumb = await sharp(out.thumb).metadata();
    const web = await sharp(out.web).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect(Math.max(web.width!, web.height!)).toBe(2048);
    expect(out.takenAt).toBeNull(); // imagen sintética sin EXIF
  });

  it("never enlarges small images", async () => {
    const out = await processImage(await makeJpeg(300, 200));
    const thumb = await sharp(out.thumb).metadata();
    const web = await sharp(out.web).metadata();
    expect(thumb.width).toBe(300);
    expect(web.width).toBe(300);
  });

  it("rejects non-image buffers", async () => {
    await expect(processImage(Buffer.from("not an image"))).rejects.toThrow("INVALID_IMAGE");
  });

  it("swaps reported dimensions for rotated EXIF orientations", async () => {
    const rotated = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await processImage(rotated);
    expect(out.width).toBe(600);
    expect(out.height).toBe(800);
    // el derivado queda físicamente rotado por .rotate()
    const web = await sharp(out.web).metadata();
    expect(web.width).toBe(600);
    expect(web.height).toBe(800);
  });

  it("extracts capture date from EXIF when present", async () => {
    const withDate = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withExif({ IFD0: { DateTime: "2026:05:01 10:00:00" } }).toBuffer();
    const out = await processImage(withDate);
    expect(out.takenAt).toBeInstanceOf(Date);
  });
});

describe("makeDerivatives", () => {
  it("produces thumb/web/high and watermarked variants when text given", async () => {
    const out = await makeDerivatives(await makeJpeg(5000, 3000), { watermarkText: "© Isaac" });
    const high = await sharp(out.high).metadata();
    expect(Math.max(high.width!, high.height!)).toBe(4096);
    expect(out.thumbWm).not.toBeNull();
    expect(out.webWm).not.toBeNull();
    expect(out.highWm).not.toBeNull();
    // la variante marcada difiere de la limpia
    expect(Buffer.compare(out.web, out.webWm!)).not.toBe(0);
    expect(out.width).toBe(5000);
  });

  it("skips watermark variants without text", async () => {
    const out = await makeDerivatives(await makeJpeg(800, 600), { watermarkText: null });
    expect(out.thumbWm).toBeNull();
    expect(out.webWm).toBeNull();
    expect(out.highWm).toBeNull();
  });

  it("escapes XML-sensitive characters in the watermark text", async () => {
    const marked = await applyWatermark(await makeJpeg(400, 300), `<Isaac & "Fotos">`);
    expect((await sharp(marked).metadata()).width).toBe(400);
  });
});
