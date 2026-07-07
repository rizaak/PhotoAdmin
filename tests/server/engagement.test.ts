import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { registerUpload, completeProcessing, setPhotosPublished } from "@/server/photos";
import { accessGallery } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import { activityEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const g = await createGallery(db, studio.id, { title: "Boda" });
  await updateGallerySettings(db, studio.id, g.id, { status: "published" });
  const p0 = await registerUpload(db, studio.id, g.id, { filename: "a.jpg", size: 10, contentType: "image/jpeg", sectionId: null });
  const photo = await completeProcessing(db, studio.id, p0.id, {
    width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 10,
  });
  const { clientId } = await accessGallery(db, g.slug, { email: "ana@x.com" });
  return { db, studio, gallery: g, photo, clientId };
}

describe("engagement", () => {
  it("toggles likes with events", async () => {
    const { db, gallery, photo, clientId } = await setup();
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: true });
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: false });
    expect(await toggleLike(db, clientId, gallery.id, photo.id)).toEqual({ liked: true });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.photoId, photo.id));
    expect(events.map((e) => e.type)).toEqual(["like_added", "like_removed", "like_added"]);
  });

  it("adds validated comments with events", async () => {
    const { db, gallery, photo, clientId } = await setup();
    const c = await addComment(db, clientId, gallery.id, photo.id, "  Preciosa!  ");
    expect(c.body).toBe("Preciosa!");
    await expect(addComment(db, clientId, gallery.id, photo.id, "   ")).rejects.toThrow();
    await expect(addComment(db, clientId, gallery.id, photo.id, "x".repeat(1001))).rejects.toThrow();
  });

  it("rejects hidden photos, foreign galleries and non-member clients", async () => {
    const { db, studio, gallery, photo, clientId } = await setup();
    await setPhotosPublished(db, studio.id, gallery.id, [photo.id], false);
    await expect(toggleLike(db, clientId, gallery.id, photo.id)).rejects.toThrow("NOT_FOUND");
    await setPhotosPublished(db, studio.id, gallery.id, [photo.id], true);

    const other = await createGallery(db, studio.id, { title: "Otra" });
    await updateGallerySettings(db, studio.id, other.id, { status: "published" });
    await expect(toggleLike(db, clientId, other.id, photo.id)).rejects.toThrow("NOT_FOUND");

    const { clientId: outsider } = await accessGallery(db, other.slug, { email: "otro@x.com" });
    await expect(addComment(db, outsider, gallery.id, photo.id, "hola")).rejects.toThrow("NOT_FOUND");
  });

  it("tolerates concurrent double-toggle without raw DB errors", async () => {
    const { db, gallery, photo, clientId } = await setup();
    const results = await Promise.all([
      toggleLike(db, clientId, gallery.id, photo.id),
      toggleLike(db, clientId, gallery.id, photo.id),
    ]);
    // ambos resuelven sin lanzar; el estado final es consistente
    expect(results.every((r) => typeof r.liked === "boolean")).toBe(true);
  });
});
