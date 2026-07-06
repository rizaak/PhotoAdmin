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
