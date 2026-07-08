import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery } from "@/server/galleries";
import { photos } from "@/db/schema";
import { listWatermarks, saveWatermark, deleteWatermark } from "@/server/watermarks";

const textInput = (slot = 0) => ({
  slot, type: "text" as const, text: "© Isaac", imageKey: null,
  opacityPct: 35, sizePct: 15, placement: "tile" as const,
});

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

  it("invalidates all studio wm keys on save and delete", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Boda" });
    const [p] = await db.insert(photos).values({
      galleryId: g.id, filename: "a.jpg", originalKey: "k/orig-a.jpg",
      thumbWmKey: "k/thumb-wm.jpg", webWmKey: "k/web-wm.jpg", highWmKey: "k/high-wm.jpg",
    }).returning();

    await saveWatermark(db, studio.id, textInput(0));
    let [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();
    expect(after.thumbWmKey).toBeNull();
    expect(after.highWmKey).toBeNull();

    await db.update(photos).set({ webWmKey: "k/web-wm.jpg" }).where(eq(photos.id, p.id));
    await deleteWatermark(db, studio.id, 0);
    [after] = await db.select().from(photos).where(eq(photos.id, p.id));
    expect(after.webWmKey).toBeNull();
    await expect(deleteWatermark(db, studio.id, 0)).rejects.toThrow("NOT_FOUND");
  });

  it("is tenant-scoped", async () => {
    const db = await createTestDb();
    const a = await seedStudio(db, "auth0|wm-a");
    const b = await seedStudio(db, "auth0|wm-b");
    await saveWatermark(db, a.id, textInput(0));
    expect(await listWatermarks(db, b.id)).toHaveLength(0);
    await expect(deleteWatermark(db, b.id, 0)).rejects.toThrow("NOT_FOUND");
  });

  it("isolates photo wm key invalidation to the modified studio", async () => {
    const db = await createTestDb();
    const studioA = await seedStudio(db, "auth0|wm-a");
    const studioB = await seedStudio(db, "auth0|wm-b");

    const gaA = await createGallery(db, studioA.id, { title: "Boda A" });
    const [photoA] = await db.insert(photos).values({
      galleryId: gaA.id, filename: "a.jpg", originalKey: "k/orig-a.jpg",
      thumbWmKey: "k/thumb-wm-a.jpg", webWmKey: "k/web-wm-a.jpg", highWmKey: "k/high-wm-a.jpg",
    }).returning();

    const gaB = await createGallery(db, studioB.id, { title: "Boda B" });
    const [photoB] = await db.insert(photos).values({
      galleryId: gaB.id, filename: "b.jpg", originalKey: "k/orig-b.jpg",
      thumbWmKey: "k/thumb-wm-b.jpg", webWmKey: "k/web-wm-b.jpg", highWmKey: "k/high-wm-b.jpg",
    }).returning();

    await saveWatermark(db, studioA.id, textInput(0));

    const [afterA] = await db.select().from(photos).where(eq(photos.id, photoA.id));
    expect(afterA.webWmKey).toBeNull();
    expect(afterA.thumbWmKey).toBeNull();
    expect(afterA.highWmKey).toBeNull();

    const [afterB] = await db.select().from(photos).where(eq(photos.id, photoB.id));
    expect(afterB.webWmKey).toBe("k/web-wm-b.jpg");
    expect(afterB.thumbWmKey).toBe("k/thumb-wm-b.jpg");
    expect(afterB.highWmKey).toBe("k/high-wm-b.jpg");
  });
});
