import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings, getGallery } from "@/server/galleries";
import { createSection } from "@/server/sections";
import {
  registerUpload, getOwnedPhoto, completeProcessing, markPhotoError, listGalleryPhotos,
  movePhotos, setPhotosPublished, deletePhotos, setCoverPhoto, storageTotals, sanitizeFilename,
} from "@/server/photos";
import { photos } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const gallery = await createGallery(db, studio.id, { title: "Boda" });
  return { db, studio, gallery };
}

const upload = (name = "IMG_0001.jpg") => ({
  filename: name, size: 1000, contentType: "image/jpeg" as const, sectionId: null,
});

describe("photos domain", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../..\\raro año ñ%.jpg")).toMatch(/^[\w.\-]+$/);
    expect(sanitizeFilename("")).toBe("foto.jpg");
  });

  it("registers an upload as processing with tenant-prefixed key", async () => {
    const { db, studio, gallery } = await setup();
    const photo = await registerUpload(db, studio.id, gallery.id, upload());
    expect(photo.status).toBe("processing");
    expect(photo.originalKey).toBe(
      `studios/${studio.id}/galleries/${gallery.id}/${photo.id}/orig-IMG_0001.jpg`,
    );
    expect(photo.sizeOriginalBytes).toBe(1000);
  });

  it("rejects bad content types and oversized files", async () => {
    const { db, studio, gallery } = await setup();
    await expect(registerUpload(db, studio.id, gallery.id, { ...upload(), contentType: "video/mp4" as never }))
      .rejects.toThrow();
    await expect(registerUpload(db, studio.id, gallery.id, { ...upload(), size: 101 * 1024 * 1024 }))
      .rejects.toThrow();
  });

  it("completes processing and marks errors", async () => {
    const { db, studio, gallery } = await setup();
    const p = await registerUpload(db, studio.id, gallery.id, upload());
    const done = await completeProcessing(db, studio.id, p.id, {
      width: 3000, height: 2000, takenAt: new Date("2026-05-01T10:00:00Z"),
      thumbKey: "k/thumb.jpg", webKey: "k/web.jpg", sizeDerivativesBytes: 500, sizeOriginalBytes: 1000,
    });
    expect(done.status).toBe("ready");
    expect(done.width).toBe(3000);
    expect(done.sizeOriginalBytes).toBe(1000);

    const p2 = await registerUpload(db, studio.id, gallery.id, upload("b.jpg"));
    await markPhotoError(db, studio.id, p2.id);
    expect((await getOwnedPhoto(db, studio.id, p2.id)).status).toBe("error");
  });

  it("lists photos ordered by gallery photoOrder", async () => {
    const { db, studio, gallery } = await setup();
    // filename "aaa" pero tomada después (01-02); filename "bbb" tomada antes (01-01):
    // así capture order y filename order difieren y el test no es tautológico.
    const a = await registerUpload(db, studio.id, gallery.id, upload("aaa.jpg"));
    const b = await registerUpload(db, studio.id, gallery.id, upload("bbb.jpg"));
    await completeProcessing(db, studio.id, a.id, {
      width: 1, height: 1, takenAt: new Date("2026-01-02"), thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 1000,
    });
    await completeProcessing(db, studio.id, b.id, {
      width: 1, height: 1, takenAt: new Date("2026-01-01"), thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 1000,
    });

    // capture (default): b (01-01) antes que a (01-02)
    expect((await listGalleryPhotos(db, studio.id, gallery.id)).map((p) => p.id)).toEqual([b.id, a.id]);
    // filename: aaa antes que bbb
    await updateGallerySettings(db, studio.id, gallery.id, { photoOrder: "filename" });
    expect((await listGalleryPhotos(db, studio.id, gallery.id)).map((p) => p.id)).toEqual([a.id, b.id]);

    // manual: posiciones explícitas invierten el orden de filename
    await updateGallerySettings(db, studio.id, gallery.id, { photoOrder: "manual" });
    await db.update(photos).set({ position: 1 }).where(eq(photos.id, a.id));
    await db.update(photos).set({ position: 0 }).where(eq(photos.id, b.id));
    expect((await listGalleryPhotos(db, studio.id, gallery.id)).map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("moves photos between sections, validating section ownership", async () => {
    const { db, studio, gallery } = await setup();
    const section = await createSection(db, studio.id, gallery.id, "Selección");
    const other = await createGallery(db, studio.id, { title: "Otra" });
    const foreign = await createSection(db, studio.id, other.id, "Ajena");
    const p = await registerUpload(db, studio.id, gallery.id, upload());

    await movePhotos(db, studio.id, gallery.id, [p.id], section.id);
    expect((await getOwnedPhoto(db, studio.id, p.id)).sectionId).toBe(section.id);

    await movePhotos(db, studio.id, gallery.id, [p.id], null);
    expect((await getOwnedPhoto(db, studio.id, p.id)).sectionId).toBeNull();

    await expect(movePhotos(db, studio.id, gallery.id, [p.id], foreign.id))
      .rejects.toThrow("SECTION_NOT_IN_GALLERY");
  });

  it("publishes/hides, deletes returning R2 keys, and sets cover", async () => {
    const { db, studio, gallery } = await setup();
    const p = await registerUpload(db, studio.id, gallery.id, upload());
    await completeProcessing(db, studio.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "k/thumb.jpg", webKey: "k/web.jpg", sizeDerivativesBytes: 1, sizeOriginalBytes: 1000,
    });

    await setPhotosPublished(db, studio.id, gallery.id, [p.id], false);
    expect((await getOwnedPhoto(db, studio.id, p.id)).published).toBe(false);

    await setCoverPhoto(db, studio.id, gallery.id, p.id);
    expect((await getGallery(db, studio.id, gallery.id)).coverPhotoId).toBe(p.id);

    const keys = await deletePhotos(db, studio.id, gallery.id, [p.id]);
    expect(keys).toContain(p.originalKey);
    expect(keys).toContain("k/thumb.jpg");
    expect(keys).toContain("k/web.jpg");
    await expect(getOwnedPhoto(db, studio.id, p.id)).rejects.toThrow("NOT_FOUND");
    // FK set null: la portada se limpia sola
    expect((await getGallery(db, studio.id, gallery.id)).coverPhotoId).toBeNull();
  });

  it("computes storage totals per gallery and total", async () => {
    const { db, studio, gallery } = await setup();
    const other = await createGallery(db, studio.id, { title: "Otra" });
    const p1 = await registerUpload(db, studio.id, gallery.id, upload());
    await completeProcessing(db, studio.id, p1.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 200, sizeOriginalBytes: 1000,
    });
    await registerUpload(db, studio.id, other.id, { ...upload("x.jpg"), size: 5000 });

    const totals = await storageTotals(db, studio.id);
    expect(totals.perGallery[gallery.id]).toBe(1200); // 1000 orig + 200 deriv
    expect(totals.perGallery[other.id]).toBe(5000);
    expect(totals.totalBytes).toBe(6200);
  });

  it("is tenant-scoped for every mutator", async () => {
    const { db, studio, gallery } = await setup();
    const intruder = await seedStudio(db, "auth0|intruder");
    const p = await registerUpload(db, studio.id, gallery.id, upload());

    await expect(registerUpload(db, intruder.id, gallery.id, upload())).rejects.toThrow("NOT_FOUND");
    await expect(getOwnedPhoto(db, intruder.id, p.id)).rejects.toThrow("NOT_FOUND");
    await expect(completeProcessing(db, intruder.id, p.id, {
      width: 1, height: 1, takenAt: null, thumbKey: "t", webKey: "w", sizeDerivativesBytes: 1, sizeOriginalBytes: 1000,
    })).rejects.toThrow("NOT_FOUND");
    await expect(markPhotoError(db, intruder.id, p.id)).rejects.toThrow("NOT_FOUND");
    await expect(movePhotos(db, intruder.id, gallery.id, [p.id], null)).rejects.toThrow("NOT_FOUND");
    await expect(setPhotosPublished(db, intruder.id, gallery.id, [p.id], false)).rejects.toThrow("NOT_FOUND");
    await expect(deletePhotos(db, intruder.id, gallery.id, [p.id])).rejects.toThrow("NOT_FOUND");
    await expect(setCoverPhoto(db, intruder.id, gallery.id, p.id)).rejects.toThrow("NOT_FOUND");
    expect((await storageTotals(db, intruder.id)).totalBytes).toBe(0);
  });
});
