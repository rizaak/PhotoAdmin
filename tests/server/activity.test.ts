import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { createSection, listSections } from "@/server/sections";
import { registerUpload, completeProcessing, getOwnedPhoto } from "@/server/photos";
import { accessGallery } from "@/server/client-access";
import { toggleLike, addComment } from "@/server/engagement";
import {
  listGalleryClients, clientEngagementDetail, clientActivityLog, selectionUnion, createSectionFromSelection,
} from "@/server/activity";

async function fixture() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const g = await createGallery(db, studio.id, { title: "Boda" });
  await updateGallerySettings(db, studio.id, g.id, { status: "published" });
  const mk = async (name: string) => {
    const p = await registerUpload(db, studio.id, g.id, { filename: name, size: 1, contentType: "image/jpeg", sectionId: null });
    return completeProcessing(db, studio.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 1,
    });
  };
  const [p1, p2, p3] = [await mk("1.jpg"), await mk("2.jpg"), await mk("3.jpg")];
  const ana = (await accessGallery(db, g.slug, { email: "ana@x.com", name: "Ana" })).clientId;
  const beto = (await accessGallery(db, g.slug, { email: "beto@x.com" })).clientId;
  await toggleLike(db, ana, g.id, p1.id);
  await toggleLike(db, ana, g.id, p2.id);
  await toggleLike(db, beto, g.id, p2.id);
  await toggleLike(db, beto, g.id, p3.id);
  await addComment(db, ana, g.id, p1.id, "me encanta");
  return { db, studio, g, p1, p2, p3, ana, beto };
}

describe("admin activity", () => {
  it("lists clients with engagement counts", async () => {
    const { db, studio, g } = await fixture();
    const rows = await listGalleryClients(db, studio.id, g.id);
    const ana = rows.find((r) => r.email === "ana@x.com")!;
    expect(rows).toHaveLength(2);
    expect(ana.name).toBe("Ana");
    expect(ana.likeCount).toBe(2);
    expect(ana.commentCount).toBe(1);
  });

  it("returns per-client detail and curated log", async () => {
    const { db, studio, g, ana, p1 } = await fixture();
    const detail = await clientEngagementDetail(db, studio.id, g.id, ana);
    expect(detail.likedPhotos.map((p) => p.filename).sort()).toEqual(["1.jpg", "2.jpg"]);
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].photo.id).toBe(p1.id);

    const log = await clientActivityLog(db, studio.id, g.id, ana);
    expect(log.map((e) => e.type)).toEqual(["comment", "like_added", "like_added", "access"]);
    expect(log[0].photoFilename).toBe("1.jpg");
  });

  it("unions selections without duplicates and creates the section moving photos", async () => {
    const { db, studio, g, ana, beto, p1, p2, p3 } = await fixture();
    const union = await selectionUnion(db, studio.id, g.id, [ana, beto]);
    expect(union.sort()).toEqual([p1.id, p2.id, p3.id].sort()); // p2 una sola vez

    const existing = await createSection(db, studio.id, g.id, "Anterior");
    const { sectionId, movedCount } = await createSectionFromSelection(
      db, studio.id, g.id, [ana, beto], "Favoritas combinadas", true,
    );
    expect(movedCount).toBe(3);
    expect((await getOwnedPhoto(db, studio.id, p2.id)).sectionId).toBe(sectionId);
    const sectionsNow = await listSections(db, studio.id, g.id);
    expect(sectionsNow.find((s) => s.id === sectionId)?.visible).toBe(true);
    expect(sectionsNow.find((s) => s.id === existing.id)?.visible).toBe(false); // hideOthers
  });

  it("rejects empty selections and is tenant-scoped", async () => {
    const { db, studio, g, ana } = await fixture();
    const intruder = await seedStudio(db, "auth0|intruder");
    await expect(createSectionFromSelection(db, studio.id, g.id, [], "X", false)).rejects.toThrow("EMPTY_SELECTION");
    await expect(listGalleryClients(db, intruder.id, g.id)).rejects.toThrow("NOT_FOUND");
    await expect(clientEngagementDetail(db, intruder.id, g.id, ana)).rejects.toThrow("NOT_FOUND");
    await expect(clientActivityLog(db, intruder.id, g.id, ana)).rejects.toThrow("NOT_FOUND");
    await expect(selectionUnion(db, intruder.id, g.id, [ana])).rejects.toThrow("NOT_FOUND");
    await expect(createSectionFromSelection(db, intruder.id, g.id, [ana], "X", false)).rejects.toThrow("NOT_FOUND");
  });
});
