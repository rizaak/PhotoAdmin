import { describe, it, expect } from "vitest";
import { createTestDb, seedStudio } from "../helpers/db";
import { createGallery } from "@/server/galleries";
import {
  createSection, renameSection, setSectionVisible, reorderSections, deleteSection, listSections,
  setSectionOverrides,
} from "@/server/sections";
import { photos } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const studio = await seedStudio(db);
  const gallery = await createGallery(db, studio.id, { title: "Boda" });
  return { db, studio, gallery };
}

describe("sections domain", () => {
  it("creates sections with incremental positions and lists them in order", async () => {
    const { db, studio, gallery } = await setup();
    const s1 = await createSection(db, studio.id, gallery.id, "Selección");
    const s2 = await createSection(db, studio.id, gallery.id, "Fotos listas");
    expect([s1.position, s2.position]).toEqual([0, 1]);
    expect((await listSections(db, studio.id, gallery.id)).map((s) => s.name))
      .toEqual(["Selección", "Fotos listas"]);
  });

  it("renames, toggles visibility and reorders", async () => {
    const { db, studio, gallery } = await setup();
    const s1 = await createSection(db, studio.id, gallery.id, "A");
    const s2 = await createSection(db, studio.id, gallery.id, "B");

    expect((await renameSection(db, studio.id, s1.id, "Ceremonia")).name).toBe("Ceremonia");
    expect((await setSectionVisible(db, studio.id, s2.id, false)).visible).toBe(false);

    await reorderSections(db, studio.id, gallery.id, [s2.id, s1.id]);
    expect((await listSections(db, studio.id, gallery.id)).map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  it("cannot delete a section that still has photos (FK enforced; guided deletion lands in a later task)", async () => {
    const { db, studio, gallery } = await setup();
    const s = await createSection(db, studio.id, gallery.id, "Temporal");
    await db.insert(photos)
      .values({ galleryId: gallery.id, sectionId: s.id, filename: "a.jpg", originalKey: "o/a" })
      .returning();

    await expect(deleteSection(db, studio.id, s.id)).rejects.toThrow();
  });

  it("rejects reorders that are not a permutation of the gallery's sections", async () => {
    const { db, studio, gallery } = await setup();
    const s1 = await createSection(db, studio.id, gallery.id, "A");
    const s2 = await createSection(db, studio.id, gallery.id, "B");

    // duplicate id
    await expect(reorderSections(db, studio.id, gallery.id, [s1.id, s1.id]))
      .rejects.toThrow("INVALID_ORDER");
    // incomplete list
    await expect(reorderSections(db, studio.id, gallery.id, [s2.id]))
      .rejects.toThrow("INVALID_ORDER");
  });

  it("sets and clears delivery overrides tenant-scoped", async () => {
    const { db, studio, gallery } = await setup();
    const s = await createSection(db, studio.id, gallery.id, "Selección");
    const updated = await setSectionOverrides(db, studio.id, s.id, { watermarkMode: "both", downloadEnabled: false });
    expect(updated.watermarkMode).toBe("both");
    expect(updated.downloadEnabled).toBe(false);
    const cleared = await setSectionOverrides(db, studio.id, s.id, { watermarkMode: null, downloadEnabled: null });
    expect(cleared.watermarkMode).toBeNull();
    expect(cleared.downloadEnabled).toBeNull();
    const intruder = await seedStudio(db, "auth0|intruso2");
    await expect(setSectionOverrides(db, intruder.id, s.id, { watermarkMode: null, downloadEnabled: null }))
      .rejects.toThrow("NOT_FOUND");
  });

  it("is tenant-scoped", async () => {
    const { db, studio, gallery } = await setup();
    const intruder = await seedStudio(db, "auth0|intruder");
    const s = await createSection(db, studio.id, gallery.id, "Privada");

    await expect(createSection(db, intruder.id, gallery.id, "X")).rejects.toThrow("NOT_FOUND");
    await expect(renameSection(db, intruder.id, s.id, "X")).rejects.toThrow("NOT_FOUND");
    await expect(deleteSection(db, intruder.id, s.id)).rejects.toThrow("NOT_FOUND");
    await expect(setSectionVisible(db, intruder.id, s.id, false)).rejects.toThrow("NOT_FOUND");
    await expect(reorderSections(db, intruder.id, gallery.id, [s.id])).rejects.toThrow("NOT_FOUND");
    await expect(listSections(db, intruder.id, gallery.id)).rejects.toThrow("NOT_FOUND");
  });
});
