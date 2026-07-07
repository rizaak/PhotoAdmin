import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  clients, galleryClients, likes, comments, photos, activityEvents,
} from "@/db/schema";
import { getGallery } from "./galleries";
import { createSection, listSections, setSectionVisible } from "./sections";
import { movePhotos } from "./photos";

export async function listGalleryClients(db: Db, studioId: string, galleryId: string) {
  await getGallery(db, studioId, galleryId);
  const rows = await db
    .select({
      clientId: clients.id,
      email: clients.email,
      name: clients.name,
      lastSeenAt: galleryClients.lastSeenAt,
      likeCount: sql<number>`(
        select count(*)::int from ${likes}
        join ${photos} on ${photos.id} = ${likes.photoId}
        where ${likes.clientId} = ${clients.id} and ${photos.galleryId} = ${galleryClients.galleryId}
      )`,
      commentCount: sql<number>`(
        select count(*)::int from ${comments}
        join ${photos} on ${photos.id} = ${comments.photoId}
        where ${comments.clientId} = ${clients.id} and ${photos.galleryId} = ${galleryClients.galleryId}
      )`,
    })
    .from(galleryClients)
    .innerJoin(clients, eq(galleryClients.clientId, clients.id))
    .where(eq(galleryClients.galleryId, galleryId))
    .orderBy(desc(galleryClients.lastSeenAt));
  return rows;
}

export async function clientEngagementDetail(db: Db, studioId: string, galleryId: string, clientId: string) {
  await getGallery(db, studioId, galleryId);
  const likedPhotos = await db.select({ photo: photos }).from(likes)
    .innerJoin(photos, eq(likes.photoId, photos.id))
    .where(and(eq(likes.clientId, clientId), eq(photos.galleryId, galleryId)))
    .then((rows) => rows.map((r) => r.photo));
  const commentRows = await db.select({ comment: comments, photo: photos }).from(comments)
    .innerJoin(photos, eq(comments.photoId, photos.id))
    .where(and(eq(comments.clientId, clientId), eq(photos.galleryId, galleryId)))
    .orderBy(desc(comments.createdAt));
  return {
    likedPhotos,
    comments: commentRows.map((r) => ({
      id: r.comment.id, body: r.comment.body, createdAt: r.comment.createdAt, photo: r.photo,
    })),
  };
}

export async function clientActivityLog(db: Db, studioId: string, galleryId: string, clientId: string) {
  await getGallery(db, studioId, galleryId);
  const rows = await db.select({
    type: activityEvents.type,
    createdAt: activityEvents.createdAt,
    photoFilename: photos.filename,
  })
    .from(activityEvents)
    .leftJoin(photos, eq(activityEvents.photoId, photos.id))
    .where(and(eq(activityEvents.galleryId, galleryId), eq(activityEvents.clientId, clientId)))
    .orderBy(desc(activityEvents.createdAt))
    .limit(200);
  return rows;
}

export async function selectionUnion(db: Db, studioId: string, galleryId: string, clientIds: string[]): Promise<string[]> {
  await getGallery(db, studioId, galleryId);
  if (clientIds.length === 0) return [];
  const rows = await db.selectDistinct({ photoId: likes.photoId }).from(likes)
    .innerJoin(photos, eq(likes.photoId, photos.id))
    .where(and(inArray(likes.clientId, clientIds), eq(photos.galleryId, galleryId)));
  return rows.map((r) => r.photoId);
}

const nameSchema = z.string().trim().min(1).max(100);

export async function createSectionFromSelection(
  db: Db, studioId: string, galleryId: string, clientIds: string[], name: string, hideOthers: boolean,
): Promise<{ sectionId: string; movedCount: number }> {
  const sectionName = nameSchema.parse(name);
  const photoIds = await selectionUnion(db, studioId, galleryId, clientIds);
  if (photoIds.length === 0) throw new Error("EMPTY_SELECTION");

  const section = await createSection(db, studioId, galleryId, sectionName);
  await movePhotos(db, studioId, galleryId, photoIds, section.id);
  if (hideOthers) {
    const all = await listSections(db, studioId, galleryId);
    for (const s of all) {
      if (s.id !== section.id && s.visible) await setSectionVisible(db, studioId, s.id, false);
    }
  }
  return { sectionId: section.id, movedCount: photoIds.length };
}
