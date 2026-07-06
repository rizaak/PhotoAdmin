import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "@/server/images";

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
