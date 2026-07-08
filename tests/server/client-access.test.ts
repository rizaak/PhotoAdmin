import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { createSection, setSectionVisible } from "@/server/sections";
import { registerUpload, completeProcessing, setPhotosPublished } from "@/server/photos";
import { getPublicGallery, accessGallery, getClientGalleryData } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import { activityEvents } from "@/db/schema";

async function publishedGallery(db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, password?: string) {
  const g = await createGallery(db, studioId, { title: "Boda", password });
  await updateGallerySettings(db, studioId, g.id, { status: "published" });
  return (await getPublicGallery(db, g.slug));
}

async function readyPhoto(
  db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, galleryId: string, sectionId: string, name = "a.jpg",
) {
  const p = await registerUpload(db, studioId, galleryId, { filename: name, size: 10, contentType: "image/jpeg", sectionId });
  return completeProcessing(db, studioId, p.id, {
    width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 10,
  });
}

describe("client access", () => {
  it("only exposes published galleries", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const draft = await createGallery(db, studio.id, { title: "Borrador" });
    await expect(getPublicGallery(db, draft.slug)).rejects.toThrow("NOT_FOUND");
    await expect(getPublicGallery(db, "no-existe")).rejects.toThrow("NOT_FOUND");
    const g = await publishedGallery(db, studio.id);
    expect(g.status).toBe("published");
  });

  it("enforces gallery password and rejects wrong ones", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id, "clave123");
    await expect(accessGallery(db, g.slug, { email: "ana@x.com" })).rejects.toThrow("PASSWORD_REQUIRED");
    await expect(accessGallery(db, g.slug, { email: "ana@x.com", password: "mala" })).rejects.toThrow("INVALID_PASSWORD");
    const ok = await accessGallery(db, g.slug, { email: "ana@x.com", password: "clave123" });
    expect(ok.firstAccess).toBe(true);
  });

  it("upserts client by normalized email and tracks first vs repeat access", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id);
    const first = await accessGallery(db, g.slug, { email: "  Ana@X.com ", name: "Ana" });
    const again = await accessGallery(db, g.slug, { email: "ana@x.com" });
    expect(again.clientId).toBe(first.clientId);
    expect(first.firstAccess).toBe(true);
    expect(again.firstAccess).toBe(false);
    const events = await db.select().from(activityEvents);
    expect(events.filter((e) => e.type === "access")).toHaveLength(2);
  });

  it("returns only visible sections, published+ready photos, and only the client's own activity", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await publishedGallery(db, studio.id);
    const visible = await createSection(db, studio.id, g.id, "Visible");
    const hidden = await createSection(db, studio.id, g.id, "Oculta");
    await setSectionVisible(db, studio.id, hidden.id, false);

    const shown = await readyPhoto(db, studio.id, g.id, visible.id, "shown.jpg");
    const unpublished = await readyPhoto(db, studio.id, g.id, visible.id, "hidden.jpg");
    await setPhotosPublished(db, studio.id, g.id, [unpublished.id], false);
    await registerUpload(db, studio.id, g.id, { filename: "processing.jpg", size: 5, contentType: "image/jpeg", sectionId: visible.id });

    const ana = await accessGallery(db, g.slug, { email: "ana@x.com" });
    const beto = await accessGallery(db, g.slug, { email: "beto@x.com" });
    await toggleLike(db, beto.clientId, g.id, shown.id);
    await addComment(db, beto.clientId, g.id, shown.id, "de beto");
    await toggleLike(db, ana.clientId, g.id, shown.id);

    const data = await getClientGalleryData(db, g.id, ana.clientId);
    expect(data.sections.map((s) => s.id)).toEqual([visible.id]);
    expect(data.photos.map((p) => p.id)).toEqual([shown.id]);
    expect(data.likedPhotoIds).toEqual([shown.id]); // solo el like de ana
    expect(data.commentsByPhoto[shown.id] ?? []).toHaveLength(0); // el comentario de beto no se ve
  });
});
