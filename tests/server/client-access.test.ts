import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { createSection, setSectionVisible } from "@/server/sections";
import { registerUpload, completeProcessing, setPhotosPublished } from "@/server/photos";
import { getPublicGallery, accessGallery, getClientGalleryData } from "@/server/client-access";
import { activityEvents } from "@/db/schema";

async function publishedGallery(db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, password?: string) {
  const g = await createGallery(db, studioId, { title: "Boda", password });
  await updateGallerySettings(db, studioId, g.id, { status: "published" });
  return (await getPublicGallery(db, g.slug));
}

async function readyPhoto(db: Awaited<ReturnType<typeof createTestDb>>, studioId: string, galleryId: string, name = "a.jpg") {
  const p = await registerUpload(db, studioId, galleryId, { filename: name, size: 10, contentType: "image/jpeg", sectionId: null });
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

  it.todo("returns only visible sections, published+ready photos, and only the client's own activity");
});
