import sharp, { type Metadata } from "sharp";
import exifReader from "exif-reader";

export type WatermarkPlacement =
  | "tl" | "tc" | "tr" | "ml" | "center" | "mr" | "bl" | "bc" | "br" | "tile";

export type WatermarkSpec = {
  type: "text" | "image";
  text?: string | null;
  imageBuffer?: Buffer | null;
  opacityPct: number;
  sizePct: number;
  placement: WatermarkPlacement;
};

export type DerivativeSet = {
  width: number;
  height: number;
  takenAt: Date | null;
  thumb: Buffer;
  web: Buffer;
  high: Buffer;
  thumbWm: Buffer | null;
  webWm: Buffer | null;
  highWm: Buffer | null;
};

const THUMB_SIZE = 400;
const WEB_SIZE = 2048;
const HIGH_SIZE = 4096;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function textSvg(text: string, targetW: number, opacityPct: number): Buffer {
  const len = Math.max(text.length, 1);
  const fontSize = Math.max(12, Math.floor(targetW / (0.6 * len)));
  const width = Math.ceil(0.6 * fontSize * len) + fontSize;
  const height = Math.ceil(fontSize * 1.6);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${fontSize / 2}" y="${fontSize * 1.15}" font-family="Helvetica, Arial, sans-serif" ` +
      `font-size="${fontSize}" fill="white" fill-opacity="${opacityPct / 100}">${escapeXml(text)}</text></svg>`,
  );
}

// multiplica el canal alfa de un PNG por opacityPct/100
async function withOpacity(png: Buffer, opacityPct: number): Promise<Buffer> {
  if (opacityPct >= 100) return sharp(png).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const factor = opacityPct / 100;
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * factor);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// garantiza que el overlay cabe dentro de la base (sharp exige overlay ≤ base)
async function fitWithin(png: Buffer, maxW: number, maxH: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  if ((meta.width ?? 0) <= maxW && (meta.height ?? 0) <= maxH) return png;
  return sharp(png).resize(maxW, maxH, { fit: "inside" }).png().toBuffer();
}

const GRAVITY: Record<Exclude<WatermarkPlacement, "tile">, string> = {
  tl: "northwest", tc: "north", tr: "northeast",
  ml: "west", center: "center", mr: "east",
  bl: "southwest", bc: "south", br: "southeast",
};

async function overlayFor(
  spec: WatermarkSpec, photoW: number, photoH: number,
): Promise<{ input: Buffer; gravity?: string; tile?: boolean }> {
  const targetW = Math.max(16, Math.round((photoW * spec.sizePct) / 100));

  let png: Buffer;
  if (spec.type === "text") {
    png = await sharp(textSvg(spec.text ?? "", targetW, spec.opacityPct)).png().toBuffer();
  } else {
    const resized = await sharp(spec.imageBuffer!).resize({ width: targetW }).png().toBuffer();
    png = await withOpacity(resized, spec.opacityPct);
  }

  if (spec.placement === "tile") {
    const rotated = await sharp(png)
      .rotate(-30, { background: TRANSPARENT })
      .png().toBuffer();
    const meta = await sharp(rotated).metadata();
    const gapX = Math.round((meta.width ?? targetW) * 0.6);
    const gapY = Math.round((meta.height ?? targetW) * 0.8);
    const padded = await sharp(rotated)
      .extend({ top: gapY, bottom: 0, left: gapX, right: 0, background: TRANSPARENT })
      .png().toBuffer();
    return { input: await fitWithin(padded, photoW, photoH), tile: true };
  }

  const margin = Math.max(4, Math.round(photoW * 0.02));
  const padded = await sharp(png)
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: TRANSPARENT })
    .png().toBuffer();
  return { input: await fitWithin(padded, photoW, photoH), gravity: GRAVITY[spec.placement] };
}

export async function applyWatermarks(image: Buffer, specs: WatermarkSpec[]): Promise<Buffer> {
  let meta: Metadata;
  try {
    meta = await sharp(image).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");
  if (specs.length === 0) return image;

  const overlays = [];
  for (const spec of specs) overlays.push(await overlayFor(spec, meta.width, meta.height));
  return sharp(image).composite(overlays).jpeg({ quality: 85 }).toBuffer();
}

function extractTakenAt(exif?: Buffer): Date | null {
  if (!exif) return null;
  try {
    const parsed = exifReader(exif);
    const d = parsed.Photo?.DateTimeOriginal ?? parsed.Image?.DateTime;
    return d instanceof Date ? d : null;
  } catch {
    return null;
  }
}

export async function makeDerivatives(
  original: Buffer, opts: { watermarks: WatermarkSpec[] },
): Promise<DerivativeSet> {
  let meta: Metadata;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");

  const base = sharp(original).rotate();
  const resize = (px: number, quality: number) =>
    base.clone().resize(px, px, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();

  const [thumb, web, high] = await Promise.all([resize(THUMB_SIZE, 80), resize(WEB_SIZE, 85), resize(HIGH_SIZE, 90)]);

  let thumbWm: Buffer | null = null;
  let webWm: Buffer | null = null;
  let highWm: Buffer | null = null;
  if (opts.watermarks.length > 0) {
    [thumbWm, webWm, highWm] = await Promise.all([
      applyWatermarks(thumb, opts.watermarks),
      applyWatermarks(web, opts.watermarks),
      applyWatermarks(high, opts.watermarks),
    ]);
  }

  const swapped = (meta.orientation ?? 1) >= 5;
  return {
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    takenAt: extractTakenAt(meta.exif),
    thumb, web, high, thumbWm, webWm, highWm,
  };
}
