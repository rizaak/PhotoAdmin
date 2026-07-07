import sharp, { type Metadata } from "sharp";
import exifReader from "exif-reader";

export type ProcessedImage = {
  thumb: Buffer;
  web: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
};

const THUMB_SIZE = 400;
const WEB_SIZE = 2048;
const HIGH_SIZE = 4096;

export async function processImage(original: Buffer): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");

  const base = sharp(original).rotate(); // aplica orientación EXIF
  const [thumb, web] = await Promise.all([
    base.clone().resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer(),
    base.clone().resize(WEB_SIZE, WEB_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer(),
  ]);

  // dimensiones tal como se ven (orientaciones 5-8 intercambian ejes)
  const swapped = (meta.orientation ?? 1) >= 5;
  return {
    thumb,
    web,
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    takenAt: extractTakenAt(meta.exif),
  };
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

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function watermarkSvg(width: number, height: number, text: string): Buffer {
  const fontSize = Math.max(14, Math.round(Math.max(width, height) / 24));
  const tileW = fontSize * (text.length + 6);
  const tileH = fontSize * 6;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">` +
      `<text x="0" y="${fontSize * 3}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" ` +
      `fill="white" fill-opacity="0.35">${escapeXml(text)}</text>` +
      `</pattern></defs><rect width="100%" height="100%" fill="url(#wm)"/></svg>`,
  );
}

export async function applyWatermark(image: Buffer, text: string): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error("INVALID_IMAGE");
  return sharp(image)
    .composite([{ input: watermarkSvg(meta.width, meta.height, text) }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

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

export async function makeDerivatives(
  original: Buffer, opts: { watermarkText: string | null },
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
  if (opts.watermarkText) {
    [thumbWm, webWm, highWm] = await Promise.all([
      applyWatermark(thumb, opts.watermarkText),
      applyWatermark(web, opts.watermarkText),
      applyWatermark(high, opts.watermarkText),
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
