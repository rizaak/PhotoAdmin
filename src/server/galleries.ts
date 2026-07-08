import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { galleries, photos, type Gallery, type GalleryStatus } from "@/db/schema";
import { makeSlug } from "./slug";

const createGallerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  password: z.string().min(4).max(100).optional(),
});
export type CreateGalleryInput = z.infer<typeof createGallerySchema>;

const updateGallerySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  photoOrder: z.enum(["capture", "filename", "manual"]).optional(),
  downloadEnabled: z.boolean().optional(),
  resWebEnabled: z.boolean().optional(),
  resHighEnabled: z.boolean().optional(),
  resOriginalEnabled: z.boolean().optional(),
  watermarkMode: z.enum(["none", "view", "download", "both"]).optional(),
  watermarkText: z.string().max(100).nullable().optional(),
  password: z.string().min(4).max(100).nullable().optional(),
});
export type UpdateGalleryInput = z.infer<typeof updateGallerySchema>;

export async function createGallery(db: Db, studioId: string, input: CreateGalleryInput): Promise<Gallery> {
  const data = createGallerySchema.parse(input);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;
  const [gallery] = await db
    .insert(galleries)
    .values({ studioId, title: data.title, slug: makeSlug(data.title), passwordHash })
    .returning();
  return gallery;
}

export async function listGalleries(
  db: Db, studioId: string,
  opts: { search?: string; status?: GalleryStatus } = {},
): Promise<Gallery[]> {
  const conditions = [eq(galleries.studioId, studioId)];
  if (opts.search?.trim()) conditions.push(ilike(galleries.title, `%${opts.search.trim()}%`));
  if (opts.status) conditions.push(eq(galleries.status, opts.status));
  return db.select().from(galleries).where(and(...conditions)).orderBy(desc(galleries.createdAt));
}

export async function getGallery(db: Db, studioId: string, galleryId: string): Promise<Gallery> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)));
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function updateGallerySettings(
  db: Db, studioId: string, galleryId: string, patch: UpdateGalleryInput,
): Promise<Gallery> {
  const data = updateGallerySchema.parse(patch);
  const { password, ...rest } = data;
  const values: Partial<typeof galleries.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (password !== undefined) {
    values.passwordHash = password === null ? null : await bcrypt.hash(password, 10);
  }

  let textChanged = false;
  if (data.watermarkText !== undefined) {
    const current = await getGallery(db, studioId, galleryId);
    textChanged = current.watermarkText != null && data.watermarkText != null
      && current.watermarkText !== data.watermarkText;
  }

  const gallery = await db.transaction(async (tx) => {
    if (textChanged) {
      await tx.update(photos).set({ thumbWmKey: null, webWmKey: null, highWmKey: null })
        .where(eq(photos.galleryId, galleryId));
    }
    const [row] = await tx.update(galleries).set(values)
      .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)))
      .returning();
    return row;
  });
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function deleteGallery(db: Db, studioId: string, galleryId: string): Promise<string[]> {
  await getGallery(db, studioId, galleryId);
  const rows = await db.select({
    originalKey: photos.originalKey, thumbKey: photos.thumbKey, webKey: photos.webKey,
    highKey: photos.highKey, thumbWmKey: photos.thumbWmKey, webWmKey: photos.webWmKey, highWmKey: photos.highWmKey,
  }).from(photos).where(eq(photos.galleryId, galleryId));
  const keys = rows.flatMap((r) =>
    [r.originalKey, r.thumbKey, r.webKey, r.highKey, r.thumbWmKey, r.webWmKey, r.highWmKey]
      .filter((k): k is string => !!k));

  const deleted = await db.delete(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.studioId, studioId)))
    .returning({ id: galleries.id });
  if (deleted.length === 0) throw new Error("NOT_FOUND");
  return keys;
}
