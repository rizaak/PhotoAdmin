import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createTestDb, seedStudio } from "../helpers/db";
import {
  createGallery, listGalleries, getGallery, updateGallerySettings, updateGalleryDesign, deleteGallery,
} from "@/server/galleries";
import { createSection } from "@/server/sections";
import { saveWatermark } from "@/server/watermarks";
import { photos } from "@/db/schema";

const textInput = (slot = 0) => ({
  slot, type: "text" as const, text: "© Isaac", imageKey: null,
  opacityPct: 35, sizePct: 15, placement: "tile" as const,
});

describe("galleries domain", () => {
  it("creates a gallery with defaults and hashed optional password", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda María", password: "secreto1" });
    expect(g.status).toBe("draft");
    expect(g.slug).toMatch(/^boda-maria-[a-z0-9]{6}$/);
    expect(g.passwordHash).not.toBe("secreto1");
    expect(await bcrypt.compare("secreto1", g.passwordHash!)).toBe(true);

    const open = await createGallery(db, studio.id, { title: "Sin clave" });
    expect(open.passwordHash).toBeNull();
  });

  it("lists with search (accent-insensitive input handled by caller) and status filter", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await createGallery(db, studio.id, { title: "Boda María" });
    const pub = await createGallery(db, studio.id, { title: "XV Ana" });
    await updateGallerySettings(db, studio.id, pub.id, { status: "published" });

    expect(await listGalleries(db, studio.id)).toHaveLength(2);
    expect(await listGalleries(db, studio.id, { search: "maría" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { search: "boda" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { status: "published" })).toHaveLength(1);
    expect(await listGalleries(db, studio.id, { search: "nada" })).toHaveLength(0);
  });

  it("updates settings, sets and clears password", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda" });

    const updated = await updateGallerySettings(db, studio.id, g.id, {
      watermarkMode: "view", downloadEnabled: true, resOriginalEnabled: true, password: "clave123",
    });
    expect(updated.watermarkMode).toBe("view");
    expect(updated.downloadEnabled).toBe(true);
    expect(updated.passwordHash).not.toBeNull();

    const cleared = await updateGallerySettings(db, studio.id, g.id, { password: null });
    expect(cleared.passwordHash).toBeNull();
  });

  it("is tenant-scoped: another studio cannot read, update or delete", async () => {
    const db = await createTestDb();
    const a = await seedStudio(db, "auth0|studio-a");
    const b = await seedStudio(db, "auth0|studio-b");
    const g = await createGallery(db, a.id, { title: "Privada" });

    await expect(getGallery(db, b.id, g.id)).rejects.toThrow("NOT_FOUND");
    await expect(updateGallerySettings(db, b.id, g.id, { title: "hack" })).rejects.toThrow("NOT_FOUND");
    await expect(deleteGallery(db, b.id, g.id)).rejects.toThrow("NOT_FOUND");
    expect(await listGalleries(db, b.id)).toHaveLength(0);
  });

  it("deletes a gallery and returns no R2 keys when it has no photos", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Temporal" });
    const keys = await deleteGallery(db, studio.id, g.id);
    expect(keys).toEqual([]);
    await expect(getGallery(db, studio.id, g.id)).rejects.toThrow("NOT_FOUND");
  });

  it("deletes a gallery and returns its photos' R2 keys for cleanup", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Con fotos" });
    const section = await createSection(db, studio.id, g.id, "Fotos");
    await db.insert(photos).values({
      galleryId: g.id,
      sectionId: section.id,
      filename: "a.jpg",
      originalKey: "studios/x/galleries/g/photo/orig-a.jpg",
      thumbKey: "studios/x/galleries/g/photo/thumb.jpg",
      webKey: "studios/x/galleries/g/photo/web.jpg",
      highKey: "studios/x/galleries/g/photo/high.jpg",
      thumbWmKey: "studios/x/galleries/g/photo/thumb-wm.jpg",
      webWmKey: "studios/x/galleries/g/photo/web-wm.jpg",
      highWmKey: "studios/x/galleries/g/photo/high-wm.jpg",
    });

    const keys = await deleteGallery(db, studio.id, g.id);
    expect(keys).toContain("studios/x/galleries/g/photo/orig-a.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/thumb.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/web.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/high.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/thumb-wm.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/web-wm.jpg");
    expect(keys).toContain("studios/x/galleries/g/photo/high-wm.jpg");
    expect(keys).toHaveLength(7);
    await expect(getGallery(db, studio.id, g.id)).rejects.toThrow("NOT_FOUND");
  });

  it("rejects selecting a watermark from another studio", async () => {
    const db = await createTestDb();
    const s1 = await seedStudio(db);
    const s2 = await seedStudio(db, "auth0|otro");
    const { watermark } = await saveWatermark(db, s2.id, textInput(0));
    const g = await createGallery(db, s1.id, { title: "mía" });
    await expect(updateGallerySettings(db, s1.id, g.id, { watermarkId: watermark.id }))
      .rejects.toThrow("INVALID_WATERMARK");
  });

  it("changing the selection clears the gallery's wm keys; same value does not", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const { watermark: m0 } = await saveWatermark(db, studio.id, textInput(0));
    const { watermark: m1 } = await saveWatermark(db, studio.id, { ...textInput(1), text: "otra" });
    const g = await createGallery(db, studio.id, { title: "Boda" });
    const section = await createSection(db, studio.id, g.id, "Fotos");
    const [p] = await db.insert(photos).values({
      galleryId: g.id, sectionId: section.id, filename: "a.jpg", originalKey: "studios/x/g/x/original.jpg",
      status: "ready", thumbWmKey: "t-wm", webWmKey: "w-wm", highWmKey: "h-wm",
    }).returning();

    await updateGallerySettings(db, studio.id, g.id, { watermarkId: m0.id });
    let [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();

    await db.update(photos).set({ thumbWmKey: "t-wm", webWmKey: "w-wm", highWmKey: "h-wm" })
      .where(eq(photos.id, p.id));
    await updateGallerySettings(db, studio.id, g.id, { watermarkId: m0.id }); // misma selección
    [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBe("w-wm");

    await updateGallerySettings(db, studio.id, g.id, { watermarkId: m1.id }); // cambia
    [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();
  });
});

describe("updateGalleryDesign", () => {
  it("updates axes and focal point", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    expect(g.coverStyle).toBe("full");
    const { gallery } = await updateGalleryDesign(db, studio.id, g.id, {
      coverStyle: "split", palette: "carbon", coverFocalX: 0.2, coverFocalY: 0.8,
    });
    expect(gallery.coverStyle).toBe("split");
    expect(gallery.palette).toBe("carbon");
    expect(gallery.coverFocalX).toBeCloseTo(0.2);
  });

  it("rejects invalid axis values, foreign studios and bad cover keys", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    await expect(updateGalleryDesign(db, studio.id, g.id, { palette: "neon" as never })).rejects.toThrow();
    await expect(updateGalleryDesign(db, studio.id, g.id, { coverFocalX: 1.5 })).rejects.toThrow();
    await expect(updateGalleryDesign(db, "00000000-0000-0000-0000-000000000000", g.id, { palette: "noche" }))
      .rejects.toThrow("NOT_FOUND");
    await expect(updateGalleryDesign(db, studio.id, g.id, { coverImageKey: "studios/otro/covers/x/a.jpg" }))
      .rejects.toThrow("INVALID_COVER_KEY");
  });

  it("returns the replaced cover key on replace and on removal", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "g" });
    const k1 = `studios/${studio.id}/covers/${g.id}/a.jpg`;
    const k2 = `studios/${studio.id}/covers/${g.id}/b.jpg`;
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: k1 })).replacedCoverKey).toBeNull();
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: k2 })).replacedCoverKey).toBe(k1);
    expect((await updateGalleryDesign(db, studio.id, g.id, { coverImageKey: null })).replacedCoverKey).toBe(k2);
  });
});
