import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery, updateGallerySettings } from "@/server/galleries";
import { photos, galleries } from "@/db/schema";
import { listWatermarks, saveWatermark, deleteWatermark, type WatermarkInput } from "@/server/watermarks";

const textInput = (slot = 0) => ({
  slot, type: "text" as const, text: "© Isaac", imageKey: null,
  opacityPct: 35, sizePct: 15, placement: "tile" as const,
});

const mark = (overrides: Partial<WatermarkInput> = {}): WatermarkInput => ({
  ...textInput(overrides.slot ?? 0), ...overrides,
});

const WM_KEYS = { thumbWmKey: "t-wm", webWmKey: "w-wm", highWmKey: "h-wm" };

async function seedGalleryWithPhoto(db: Db, studioId: string, title: string) {
  const gallery = await createGallery(db, studioId, { title });
  const [photo] = await db.insert(photos).values({
    galleryId: gallery.id, filename: "a.jpg", originalKey: `studios/${studioId}/${gallery.id}/x/original.jpg`,
    status: "ready", ...WM_KEYS,
  }).returning();
  return { gallery, photo };
}

describe("watermarks domain", () => {
  it("saves, lists ordered by slot, and upserts in place", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await saveWatermark(db, studio.id, { ...textInput(1), placement: "br" });
    await saveWatermark(db, studio.id, textInput(0));
    const list = await listWatermarks(db, studio.id);
    expect(list.map((w) => w.slot)).toEqual([0, 1]);

    const { watermark } = await saveWatermark(db, studio.id, { ...textInput(0), text: "© Nuevo", opacityPct: 50 });
    expect(watermark.text).toBe("© Nuevo");
    expect(await listWatermarks(db, studio.id)).toHaveLength(2); // upsert, no duplica
  });

  it("validates ranges, slot bounds and type coherence", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    await expect(saveWatermark(db, studio.id, { ...textInput(3) })).rejects.toThrow(); // slot 0..2
    await expect(saveWatermark(db, studio.id, { ...textInput(0), opacityPct: 4 })).rejects.toThrow();
    await expect(saveWatermark(db, studio.id, { ...textInput(0), sizePct: 51 })).rejects.toThrow();
    await expect(saveWatermark(db, studio.id, { ...textInput(0), text: null })).rejects.toThrow(); // text requiere text
    await expect(saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: null,
      opacityPct: 50, sizePct: 20, placement: "br",
    })).rejects.toThrow(); // image requiere imageKey
  });

  it("enforces the studio prefix on image keys and reports replaced keys", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const goodKey = `studios/${studio.id}/watermarks/a.png`;
    await expect(saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: "studios/OTRO/watermarks/x.png",
      opacityPct: 50, sizePct: 20, placement: "br",
    })).rejects.toThrow("INVALID_IMAGE_KEY");

    const first = await saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: goodKey,
      opacityPct: 50, sizePct: 20, placement: "br",
    });
    expect(first.replacedImageKey).toBeNull();

    const second = await saveWatermark(db, studio.id, {
      slot: 0, type: "image", text: null, imageKey: `studios/${studio.id}/watermarks/b.png`,
      opacityPct: 50, sizePct: 20, placement: "br",
    });
    expect(second.replacedImageKey).toBe(goodKey);
  });

  it("is tenant-scoped", async () => {
    const db = await createTestDb();
    const a = await seedStudio(db, "auth0|wm-a");
    const b = await seedStudio(db, "auth0|wm-b");
    await saveWatermark(db, a.id, textInput(0));
    expect(await listWatermarks(db, b.id)).toHaveLength(0);
    await expect(deleteWatermark(db, b.id, 0)).rejects.toThrow("NOT_FOUND");
  });

  it("re-saving a mark clears wm keys only in galleries that selected it", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const { watermark: m0 } = await saveWatermark(db, studio.id, mark({ slot: 0 }));
    const { watermark: m1 } = await saveWatermark(db, studio.id, mark({ slot: 1, text: "otra" }));
    const a = await seedGalleryWithPhoto(db, studio.id, "usa m0");
    const b = await seedGalleryWithPhoto(db, studio.id, "usa m1");
    await updateGallerySettings(db, studio.id, a.gallery.id, { watermarkId: m0.id });
    await updateGallerySettings(db, studio.id, b.gallery.id, { watermarkId: m1.id });
    // reponer claves (la selección las limpió)
    await db.update(photos).set(WM_KEYS);

    await saveWatermark(db, studio.id, mark({ slot: 0, text: "editada" }));

    const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
    const [pb] = await db.select().from(photos).where(eq(photos.id, b.photo.id));
    expect(pa.webWmKey).toBeNull();
    expect(pb.webWmKey).toBe("w-wm");
  });

  it("creating a brand-new mark clears nothing", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const a = await seedGalleryWithPhoto(db, studio.id, "g");
    await saveWatermark(db, studio.id, mark({ slot: 2 }));
    const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
    expect(pa.webWmKey).toBe("w-wm");
  });

  it("deleting a mark clears selectors' wm keys and nulls their selection", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const { watermark: m0 } = await saveWatermark(db, studio.id, mark({ slot: 0 }));
    const a = await seedGalleryWithPhoto(db, studio.id, "usa m0");
    await updateGallerySettings(db, studio.id, a.gallery.id, { watermarkId: m0.id });
    await db.update(photos).set(WM_KEYS);

    await deleteWatermark(db, studio.id, 0);

    const [ga] = await db.select().from(galleries).where(eq(galleries.id, a.gallery.id));
    const [pa] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
    expect(ga.watermarkId).toBeNull();
    expect(pa.webWmKey).toBeNull();
  });

  it("isolates photo wm key invalidation to another studio's selecting gallery", async () => {
    const db = await createTestDb();
    const studioA = await seedStudio(db, "auth0|wm-a");
    const studioB = await seedStudio(db, "auth0|wm-b");

    const { watermark: mA } = await saveWatermark(db, studioA.id, mark({ slot: 0 }));
    const { watermark: mB } = await saveWatermark(db, studioB.id, mark({ slot: 0 }));
    const a = await seedGalleryWithPhoto(db, studioA.id, "Boda A");
    const b = await seedGalleryWithPhoto(db, studioB.id, "Boda B");
    await updateGallerySettings(db, studioA.id, a.gallery.id, { watermarkId: mA.id });
    await updateGallerySettings(db, studioB.id, b.gallery.id, { watermarkId: mB.id });
    await db.update(photos).set(WM_KEYS);

    await saveWatermark(db, studioA.id, mark({ slot: 0, text: "editada" }));

    const [afterA] = await db.select().from(photos).where(eq(photos.id, a.photo.id));
    expect(afterA.webWmKey).toBeNull();

    const [afterB] = await db.select().from(photos).where(eq(photos.id, b.photo.id));
    expect(afterB.webWmKey).toBe("w-wm");
  });
});
