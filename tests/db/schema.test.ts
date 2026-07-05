import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedStudio } from "../helpers/db";
import { galleries, sections, photos } from "@/db/schema";

describe("schema", () => {
  it("applies migrations and wires FKs studio→gallery→section→photo", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);

    const [gallery] = await db.insert(galleries)
      .values({ studioId: studio.id, title: "Boda A", slug: "boda-a-x1" }).returning();
    const [section] = await db.insert(sections)
      .values({ galleryId: gallery.id, name: "Selección", position: 0 }).returning();
    const [photo] = await db.insert(photos)
      .values({ galleryId: gallery.id, sectionId: section.id, filename: "IMG_0001.jpg", originalKey: "orig/x" })
      .returning();

    expect(gallery.status).toBe("draft");
    expect(gallery.watermarkMode).toBe("none");
    expect(section.visible).toBe(true);
    expect(section.watermarkMode).toBeNull(); // hereda
    expect(photo.published).toBe(true);

    // borrar la sección deja la foto "sin sección", no la borra
    await db.delete(sections).where(eq(sections.id, section.id));
    const [orphan] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(orphan.sectionId).toBeNull();
  });
});
