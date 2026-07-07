import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { photos, likes, comments, galleryClients, activityEvents } from "@/db/schema";

const bodySchema = z.string().trim().min(1).max(1000);

async function assertEngageable(db: Db, clientId: string, galleryId: string, photoId: string) {
  const [membership] = await db.select({ clientId: galleryClients.clientId }).from(galleryClients)
    .where(and(eq(galleryClients.galleryId, galleryId), eq(galleryClients.clientId, clientId)));
  if (!membership) throw new Error("NOT_FOUND");
  const [photo] = await db.select().from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.galleryId, galleryId)));
  if (!photo || !photo.published || photo.status !== "ready") throw new Error("NOT_FOUND");
  return photo;
}

export async function toggleLike(
  db: Db, clientId: string, galleryId: string, photoId: string,
): Promise<{ liked: boolean }> {
  await assertEngageable(db, clientId, galleryId, photoId);
  const deleted = await db.delete(likes)
    .where(and(eq(likes.clientId, clientId), eq(likes.photoId, photoId)))
    .returning();
  if (deleted.length > 0) {
    await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "like_removed" });
    return { liked: false };
  }
  const inserted = await db.insert(likes).values({ clientId, photoId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    // carrera: otro request del mismo cliente ya insertó el like
    return { liked: true };
  }
  await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "like_added" });
  return { liked: true };
}

export async function addComment(
  db: Db, clientId: string, galleryId: string, photoId: string, body: string,
): Promise<{ id: string; body: string; createdAt: Date }> {
  const text = bodySchema.parse(body);
  await assertEngageable(db, clientId, galleryId, photoId);
  const [comment] = await db.insert(comments)
    .values({ clientId, photoId, body: text })
    .returning();
  await db.insert(activityEvents).values({ galleryId, clientId, photoId, type: "comment" });
  return { id: comment.id, body: comment.body, createdAt: comment.createdAt };
}
