import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import {
  galleries, clients, galleryClients, activityEvents, sections, comments, likes,
  type Gallery, type Section, type Photo,
} from "@/db/schema";
import { listPhotosForGallery } from "./photos";

const accessSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(100).optional(),
  password: z.string().max(100).optional(),
});
export type AccessInput = z.infer<typeof accessSchema>;

export async function getPublicGallery(db: Db, slug: string): Promise<Gallery> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.slug, slug), eq(galleries.status, "published")));
  if (!gallery) throw new Error("NOT_FOUND");
  return gallery;
}

export async function accessGallery(
  db: Db, slug: string, input: AccessInput,
): Promise<{ gallery: Gallery; clientId: string; firstAccess: boolean }> {
  const data = accessSchema.parse(input);
  const gallery = await getPublicGallery(db, slug);

  if (gallery.passwordHash) {
    if (!data.password) throw new Error("PASSWORD_REQUIRED");
    if (!(await bcrypt.compare(data.password, gallery.passwordHash))) {
      throw new Error("INVALID_PASSWORD");
    }
  }

  await db.insert(clients)
    .values({ studioId: gallery.studioId, email: data.email, name: data.name ?? null })
    .onConflictDoNothing();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.studioId, gallery.studioId), eq(clients.email, data.email)));

  const inserted = await db.insert(galleryClients)
    .values({ galleryId: gallery.id, clientId: client.id, lastSeenAt: new Date() })
    .onConflictDoNothing()
    .returning();
  const firstAccess = inserted.length > 0;
  if (!firstAccess) {
    await db.update(galleryClients).set({ lastSeenAt: new Date() })
      .where(and(eq(galleryClients.galleryId, gallery.id), eq(galleryClients.clientId, client.id)));
  }

  await db.insert(activityEvents)
    .values({ galleryId: gallery.id, clientId: client.id, type: "access" });

  return { gallery, clientId: client.id, firstAccess };
}

// Fotos visibles para el cliente: publicadas, listas y en sección visible (o sin sección),
// en el orden de entrega de la galería. Compartido entre la vista autenticada y la puerta
// (portada efectiva) para que ambas apliquen exactamente los mismos gates.
export async function getVisiblePhotos(
  db: Db, gallery: Gallery,
): Promise<{ sections: Section[]; photos: Photo[] }> {
  const visibleSections = await db.select().from(sections)
    .where(and(eq(sections.galleryId, gallery.id), eq(sections.visible, true)))
    .orderBy(asc(sections.position));

  const allPhotos = await listPhotosForGallery(db, gallery);
  const shown = allPhotos.filter((p) => p.published && p.status === "ready");
  const visibleSectionIds = new Set(visibleSections.map((s) => s.id));
  const photos = shown.filter((p) => p.sectionId === null || visibleSectionIds.has(p.sectionId));
  return { sections: visibleSections, photos };
}

export type ClientGalleryData = {
  gallery: Gallery;
  sections: Section[];
  photos: Photo[];
  likedPhotoIds: string[];
  commentsByPhoto: Record<string, { id: string; body: string; createdAt: Date }[]>;
};

// Datos de galería para el fotógrafo en modo preview: mismos gates de visibilidad
// que el cliente (getVisiblePhotos), pero sin exigir status "published" (permite
// revisar borradores) y sin likes/comentarios (no hay cliente real detrás).
export async function getPreviewGalleryData(db: Db, studioId: string, slug: string): Promise<ClientGalleryData> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.slug, slug), eq(galleries.studioId, studioId)));
  if (!gallery) throw new Error("NOT_FOUND");

  const { sections: visibleSections, photos: clientPhotos } = await getVisiblePhotos(db, gallery);
  return { gallery, sections: visibleSections, photos: clientPhotos, likedPhotoIds: [], commentsByPhoto: {} };
}

export async function getClientGalleryData(db: Db, galleryId: string, clientId: string): Promise<ClientGalleryData> {
  const [gallery] = await db.select().from(galleries)
    .where(and(eq(galleries.id, galleryId), eq(galleries.status, "published")));
  if (!gallery) throw new Error("NOT_FOUND");

  const { sections: visibleSections, photos: clientPhotos } = await getVisiblePhotos(db, gallery);
  const shownIds = new Set(clientPhotos.map((p) => p.id));

  const myLikes = await db.select({ photoId: likes.photoId }).from(likes)
    .where(eq(likes.clientId, clientId));
  const myComments = await db.select().from(comments)
    .where(eq(comments.clientId, clientId))
    .orderBy(asc(comments.createdAt));

  const commentsByPhoto: ClientGalleryData["commentsByPhoto"] = {};
  for (const c of myComments) {
    if (!shownIds.has(c.photoId)) continue;
    (commentsByPhoto[c.photoId] ??= []).push({ id: c.id, body: c.body, createdAt: c.createdAt });
  }

  return {
    gallery,
    sections: visibleSections,
    photos: clientPhotos,
    likedPhotoIds: myLikes.map((l) => l.photoId).filter((id) => shownIds.has(id)),
    commentsByPhoto,
  };
}
