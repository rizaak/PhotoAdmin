import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { createTestDb, seedStudio } from "../helpers/db";
import {
  createGallery, listGalleries, getGallery, updateGallerySettings, deleteGallery,
} from "@/server/galleries";

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

  it("deletes a gallery", async () => {
    const db = await createTestDb();
    const studio = await seedStudio(db);
    const g = await createGallery(db, studio.id, { title: "Temporal" });
    await deleteGallery(db, studio.id, g.id);
    await expect(getGallery(db, studio.id, g.id)).rejects.toThrow("NOT_FOUND");
  });
});
