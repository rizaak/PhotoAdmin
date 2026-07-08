import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db";
import { galleries, photos, sections, type Gallery, type Photo } from "@/db/schema";
import { getGallery } from "./galleries";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const registerSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sectionId: z.string().uuid().nullable().optional(),
});
export type RegisterUploadInput = z.infer<typeof registerSchema>;

export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_").slice(-100);
  return base && base !== "." && base !== ".." ? base : "foto.jpg";
}

async function assertSectionInGallery(db: Db, galleryId: string, sectionId: string) {
  const [row] = await db.select({ id: sections.id }).from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.galleryId, galleryId)));
  if (!row) throw new Error("SECTION_NOT_IN_GALLERY");
}

export async function registerUpload(
  db: Db, studioId: string, galleryId: string, input: RegisterUploadInput,
): Promise<Photo> {
  const data = registerSchema.parse(input);
  await getGallery(db, studioId, galleryId);
  if (data.sectionId) await assertSectionInGallery(db, galleryId, data.sectionId);

  const id = randomUUID();
  const filename = sanitizeFilename(data.filename);
  const [photo] = await db.insert(photos).values({
    id,
    galleryId,
    sectionId: data.sectionId ?? null,
    filename,
    originalKey: `studios/${studioId}/galleries/${galleryId}/${id}/orig-${filename}`,
    sizeOriginalBytes: data.size,
    status: "processing",
  }).returning();
  return photo;
}

export async function getOwnedPhoto(db: Db, studioId: string, photoId: string): Promise<Photo> {
  const [row] = await db.select({ photo: photos }).from(photos)
    .innerJoin(galleries, eq(photos.galleryId, galleries.id))
    .where(and(eq(photos.id, photoId), eq(galleries.studioId, studioId)));
  if (!row) throw new Error("NOT_FOUND");
  return row.photo;
}

export async function completeProcessing(
  db: Db, studioId: string, photoId: string,
  result: {
    width: number; height: number; takenAt: Date | null;
    thumbKey: string; webKey: string;
    highKey?: string | null; thumbWmKey?: string | null; webWmKey?: string | null; highWmKey?: string | null;
    sizeDerivativesBytes: number; sizeOriginalBytes: number;
  },
): Promise<Photo> {
  await getOwnedPhoto(db, studioId, photoId);
  const [photo] = await db.update(photos).set({
    status: "ready",
    width: result.width,
    height: result.height,
    takenAt: result.takenAt,
    thumbKey: result.thumbKey,
    webKey: result.webKey,
    highKey: result.highKey ?? null,
    thumbWmKey: result.thumbWmKey ?? null,
    webWmKey: result.webWmKey ?? null,
    highWmKey: result.highWmKey ?? null,
    sizeDerivativesBytes: result.sizeDerivativesBytes,
    sizeOriginalBytes: result.sizeOriginalBytes,
  }).where(eq(photos.id, photoId)).returning();
  return photo;
}

export async function markPhotoError(db: Db, studioId: string, photoId: string): Promise<void> {
  await getOwnedPhoto(db, studioId, photoId);
  await db.update(photos).set({ status: "error" }).where(eq(photos.id, photoId));
}

export async function listPhotosForGallery(db: Db, gallery: Gallery): Promise<Photo[]> {
  const base = db.select().from(photos).where(eq(photos.galleryId, gallery.id));
  if (gallery.photoOrder === "manual") return base.orderBy(asc(photos.position), asc(photos.filename));
  if (gallery.photoOrder === "filename") return base.orderBy(asc(photos.filename));
  return base.orderBy(sql`${photos.takenAt} asc nulls last`, asc(photos.filename));
}

export async function listGalleryPhotos(db: Db, studioId: string, galleryId: string): Promise<Photo[]> {
  const gallery = await getGallery(db, studioId, galleryId);
  return listPhotosForGallery(db, gallery);
}

const idList = z.array(z.string().uuid()).min(1).max(500);

async function assertPhotosInGallery(db: Db, studioId: string, galleryId: string, photoIds: string[]) {
  await getGallery(db, studioId, galleryId);
  const rows = await db.select({ id: photos.id }).from(photos)
    .where(and(inArray(photos.id, photoIds), eq(photos.galleryId, galleryId)));
  if (rows.length !== new Set(photoIds).size) throw new Error("NOT_FOUND");
}

export async function movePhotos(
  db: Db, studioId: string, galleryId: string, photoIds: string[], sectionId: string | null,
): Promise<void> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  if (sectionId) await assertSectionInGallery(db, galleryId, sectionId);
  await db.update(photos).set({ sectionId })
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)));
}

export async function setPhotosPublished(
  db: Db, studioId: string, galleryId: string, photoIds: string[], published: boolean,
): Promise<void> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  await db.update(photos).set({ published })
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)));
}

export async function deletePhotos(
  db: Db, studioId: string, galleryId: string, photoIds: string[],
): Promise<string[]> {
  const ids = idList.parse(photoIds);
  await assertPhotosInGallery(db, studioId, galleryId, ids);
  const rows = await db.delete(photos)
    .where(and(inArray(photos.id, ids), eq(photos.galleryId, galleryId)))
    .returning({ originalKey: photos.originalKey, thumbKey: photos.thumbKey, webKey: photos.webKey });
  return rows.flatMap((r) => [r.originalKey, r.thumbKey, r.webKey].filter((k): k is string => !!k));
}

export async function setCoverPhoto(db: Db, studioId: string, galleryId: string, photoId: string): Promise<void> {
  await assertPhotosInGallery(db, studioId, galleryId, [photoId]);
  await db.update(galleries).set({ coverPhotoId: photoId, updatedAt: new Date() })
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
}

export async function storageTotals(
  db: Db, studioId: string,
): Promise<{ totalBytes: number; perGallery: Record<string, number> }> {
  const rows = await db.select({
    galleryId: photos.galleryId,
    bytes: sql<number>`coalesce(sum(${photos.sizeOriginalBytes} + ${photos.sizeDerivativesBytes}), 0)::bigint`,
  }).from(photos)
    .innerJoin(galleries, eq(photos.galleryId, galleries.id))
    .where(eq(galleries.studioId, studioId))
    .groupBy(photos.galleryId);

  const perGallery: Record<string, number> = {};
  let totalBytes = 0;
  for (const r of rows) {
    const n = Number(r.bytes);
    perGallery[r.galleryId] = n;
    totalBytes += n;
  }
  return { totalBytes, perGallery };
}
