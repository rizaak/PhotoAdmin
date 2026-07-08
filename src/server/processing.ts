import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { galleries, watermarks } from "@/db/schema";
import { getOwnedPhoto, completeProcessing, MAX_UPLOAD_BYTES } from "./photos";
import { makeDerivatives, type WatermarkSpec } from "./images";
import { getObjectBuffer, putObjectBuffer, deleteObjects } from "./storage";

export async function processPhoto(db: Db, studioId: string, photoId: string): Promise<"ready"> {
  const photo = await getOwnedPhoto(db, studioId, photoId);
  const [gallery] = await db.select().from(galleries).where(eq(galleries.id, photo.galleryId));
  if (!gallery) throw new Error("NOT_FOUND");

  const original = await getObjectBuffer(photo.originalKey);
  if (original.length > MAX_UPLOAD_BYTES) throw new Error("FILE_TOO_LARGE");

  const specs: WatermarkSpec[] = [];
  if (gallery.watermarkId) {
    const [mark] = await db.select().from(watermarks)
      .where(and(eq(watermarks.id, gallery.watermarkId), eq(watermarks.studioId, gallery.studioId)));
    if (mark) {
      specs.push({
        type: mark.type, text: mark.text,
        imageBuffer: mark.type === "image" && mark.imageKey ? await getObjectBuffer(mark.imageKey) : null,
        opacityPct: mark.opacityPct, sizePct: mark.sizePct, placement: mark.placement,
      });
    }
  }
  const set = await makeDerivatives(original, { watermarks: specs });

  const dir = photo.originalKey.split("/").slice(0, -1).join("/");
  const keys = {
    thumbKey: `${dir}/thumb.jpg`,
    webKey: `${dir}/web.jpg`,
    highKey: `${dir}/high.jpg`,
    thumbWmKey: set.thumbWm ? `${dir}/thumb-wm.jpg` : null,
    webWmKey: set.webWm ? `${dir}/web-wm.jpg` : null,
    highWmKey: set.highWm ? `${dir}/high-wm.jpg` : null,
  };

  const puts = [
    putObjectBuffer(keys.thumbKey, set.thumb, "image/jpeg"),
    putObjectBuffer(keys.webKey, set.web, "image/jpeg"),
    putObjectBuffer(keys.highKey, set.high, "image/jpeg"),
  ];
  if (set.thumbWm) puts.push(putObjectBuffer(keys.thumbWmKey!, set.thumbWm, "image/jpeg"));
  if (set.webWm) puts.push(putObjectBuffer(keys.webWmKey!, set.webWm, "image/jpeg"));
  if (set.highWm) puts.push(putObjectBuffer(keys.highWmKey!, set.highWm, "image/jpeg"));
  await Promise.all(puts);

  // si la marca se quitó, borrar variantes -wm que existían antes
  const stale = [photo.thumbWmKey, photo.webWmKey, photo.highWmKey]
    .filter((k): k is string => !!k && !set.thumbWm);
  if (stale.length > 0) await deleteObjects(stale);

  const sizeDerivativesBytes =
    set.thumb.length + set.web.length + set.high.length +
    (set.thumbWm?.length ?? 0) + (set.webWm?.length ?? 0) + (set.highWm?.length ?? 0);

  await completeProcessing(db, studioId, photoId, {
    width: set.width,
    height: set.height,
    takenAt: set.takenAt,
    ...keys,
    sizeDerivativesBytes,
    sizeOriginalBytes: original.length,
  });
  return "ready";
}
