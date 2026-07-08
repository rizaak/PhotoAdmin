import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { makeDerivatives, applyWatermarks, type WatermarkSpec } from "@/server/images";

async function makeJpeg(width: number, height: number, color = { r: 0, g: 0, b: 0 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

async function makePngLogo(size = 200): Promise<Buffer> {
  // cuadrado blanco opaco con transparencia alrededor
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
}

const textSpec = (over: Partial<WatermarkSpec> = {}): WatermarkSpec => ({
  type: "text", text: "© Isaac", imageBuffer: null,
  opacityPct: 60, sizePct: 25, placement: "br", ...over,
});

const quadMeans = async (img: Buffer, w: number, h: number) => {
  const q = async (left: number, top: number) =>
    sharp(await sharp(img).extract({ left, top, width: w / 2, height: h / 2 }).toBuffer()).stats();
  const [tl, tr, bl, br] = await Promise.all([q(0, 0), q(w / 2, 0), q(0, h / 2), q(w / 2, h / 2)]);
  return { tl: tl.channels[0].mean, tr: tr.channels[0].mean, bl: bl.channels[0].mean, br: br.channels[0].mean };
};

describe("applyWatermarks", () => {
  it("places a text mark in the requested corner and not in the opposite one", async () => {
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [textSpec({ placement: "br" })]);
    const m = await quadMeans(marked, 1200, 800);
    expect(m.br).toBeGreaterThan(1);
    expect(m.br).toBeGreaterThan(m.tl * 5 + 0.5);
  });

  it("tiles across all quadrants with placement tile", async () => {
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [textSpec({ placement: "tile", opacityPct: 40 })]);
    const m = await quadMeans(marked, 1200, 800);
    for (const v of Object.values(m)) expect(v).toBeGreaterThan(0.5);
  });

  it("higher opacity produces brighter marks", async () => {
    const lo = await applyWatermarks(await makeJpeg(800, 600), [textSpec({ opacityPct: 10, placement: "center" })]);
    const hi = await applyWatermarks(await makeJpeg(800, 600), [textSpec({ opacityPct: 90, placement: "center" })]);
    expect((await sharp(hi).stats()).channels[0].mean)
      .toBeGreaterThan((await sharp(lo).stats()).channels[0].mean * 2);
  });

  it("composes image marks with size and opacity", async () => {
    const logo = await makePngLogo();
    const spec: WatermarkSpec = {
      type: "image", text: null, imageBuffer: logo,
      opacityPct: 50, sizePct: 20, placement: "tl",
    };
    const marked = await applyWatermarks(await makeJpeg(1000, 700), [spec]);
    const m = await quadMeans(marked, 1000, 700);
    expect(m.tl).toBeGreaterThan(m.br * 5 + 0.5);
    // 50% de opacidad sobre negro: el cuadrante no llega al blanco puro
    expect(m.tl).toBeLessThan(200);
  });

  it("applies up to three marks at once", async () => {
    const logo = await makePngLogo();
    const marked = await applyWatermarks(await makeJpeg(1200, 800), [
      textSpec({ placement: "tl" }),
      textSpec({ placement: "br", text: "www.isaac.mx" }),
      { type: "image", text: null, imageBuffer: logo, opacityPct: 40, sizePct: 15, placement: "center" },
    ]);
    const m = await quadMeans(marked, 1200, 800);
    expect(m.tl).toBeGreaterThan(1);
    expect(m.br).toBeGreaterThan(1);
  });

  it("rejects non-image buffers", async () => {
    await expect(applyWatermarks(Buffer.from("nope"), [textSpec()])).rejects.toThrow("INVALID_IMAGE");
  });
});

describe("makeDerivatives", () => {
  it("produces thumb/web/high and wm variants only with specs", async () => {
    const withWm = await makeDerivatives(await makeJpeg(5000, 3000, { r: 180, g: 40, b: 40 }), {
      watermarks: [textSpec({ placement: "tile" })],
    });
    expect(Math.max((await sharp(withWm.high).metadata()).width!, (await sharp(withWm.high).metadata()).height!)).toBe(4096);
    expect(withWm.webWm).not.toBeNull();
    expect(Buffer.compare(withWm.web, withWm.webWm!)).not.toBe(0);

    const clean = await makeDerivatives(await makeJpeg(800, 600), { watermarks: [] });
    expect(clean.thumbWm).toBeNull();
    expect(clean.webWm).toBeNull();
    expect(clean.highWm).toBeNull();
  });

  it("keeps EXIF orientation and capture-date behavior", async () => {
    const rotated = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await makeDerivatives(rotated, { watermarks: [] });
    expect(out.width).toBe(600);
    expect(out.height).toBe(800);

    const withDate = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().withExif({ IFD0: { DateTime: "2026:05:01 10:00:00" } }).toBuffer();
    expect((await makeDerivatives(withDate, { watermarks: [] })).takenAt).toBeInstanceOf(Date);
  });
});
