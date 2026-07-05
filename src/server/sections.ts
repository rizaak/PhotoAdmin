import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { galleries, sections, type Section } from "@/db/schema";
import { getGallery } from "./galleries";

const nameSchema = z.string().trim().min(1).max(100);

async function assertSectionOwnership(db: Db, studioId: string, sectionId: string) {
  const [row] = await db
    .select({ id: sections.id, galleryId: sections.galleryId })
    .from(sections)
    .innerJoin(galleries, eq(sections.galleryId, galleries.id))
    .where(and(eq(sections.id, sectionId), eq(galleries.studioId, studioId)));
  if (!row) throw new Error("NOT_FOUND");
  return row;
}

export async function createSection(db: Db, studioId: string, galleryId: string, name: string): Promise<Section> {
  await getGallery(db, studioId, galleryId); // valida tenancy
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${sections.position}) + 1, 0)` })
    .from(sections)
    .where(eq(sections.galleryId, galleryId));
  const [section] = await db.insert(sections)
    .values({ galleryId, name: nameSchema.parse(name), position: next })
    .returning();
  return section;
}

export async function listSections(db: Db, studioId: string, galleryId: string): Promise<Section[]> {
  await getGallery(db, studioId, galleryId);
  return db.select().from(sections)
    .where(eq(sections.galleryId, galleryId))
    .orderBy(asc(sections.position));
}

export async function renameSection(db: Db, studioId: string, sectionId: string, name: string): Promise<Section> {
  await assertSectionOwnership(db, studioId, sectionId);
  const [section] = await db.update(sections)
    .set({ name: nameSchema.parse(name) })
    .where(eq(sections.id, sectionId))
    .returning();
  return section;
}

export async function setSectionVisible(db: Db, studioId: string, sectionId: string, visible: boolean): Promise<Section> {
  await assertSectionOwnership(db, studioId, sectionId);
  const [section] = await db.update(sections)
    .set({ visible })
    .where(eq(sections.id, sectionId))
    .returning();
  return section;
}

export async function reorderSections(db: Db, studioId: string, galleryId: string, orderedIds: string[]): Promise<void> {
  await getGallery(db, studioId, galleryId);

  const current = await db
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.galleryId, galleryId));
  const currentIds = new Set(current.map((r) => r.id));
  const orderedSet = new Set(orderedIds);
  const isPermutation =
    orderedIds.length === currentIds.size &&
    orderedSet.size === orderedIds.length &&
    orderedIds.every((id) => currentIds.has(id));
  if (!isPermutation) throw new Error("INVALID_ORDER");

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(sections)
        .set({ position: i })
        .where(and(eq(sections.id, orderedIds[i]), eq(sections.galleryId, galleryId)));
    }
  });
}

export async function deleteSection(db: Db, studioId: string, sectionId: string): Promise<void> {
  await assertSectionOwnership(db, studioId, sectionId);
  // FK photos.section_id ON DELETE SET NULL deja las fotos "sin sección"
  await db.delete(sections).where(eq(sections.id, sectionId));
}
