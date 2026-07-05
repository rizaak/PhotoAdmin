"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { updateGallerySettings } from "@/server/galleries";
import {
  createSection, renameSection, setSectionVisible, reorderSections, deleteSection, listSections,
} from "@/server/sections";

const id = z.string().uuid();

const settingsForm = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(["draft", "published", "archived"]),
  theme: z.enum(["light", "dark"]),
  photoOrder: z.enum(["capture", "filename", "manual"]),
  watermarkMode: z.enum(["none", "view", "download", "both"]),
  downloadEnabled: z.boolean(),
  resWebEnabled: z.boolean(),
  resHighEnabled: z.boolean(),
  resOriginalEnabled: z.boolean(),
});

export async function updateGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  const data = settingsForm.parse({
    title: formData.get("title"),
    status: formData.get("status"),
    theme: formData.get("theme"),
    photoOrder: formData.get("photoOrder"),
    watermarkMode: formData.get("watermarkMode"),
    downloadEnabled: formData.get("downloadEnabled") === "on",
    resWebEnabled: formData.get("resWebEnabled") === "on",
    resHighEnabled: formData.get("resHighEnabled") === "on",
    resOriginalEnabled: formData.get("resOriginalEnabled") === "on",
  });
  const newPassword = String(formData.get("password") ?? "");
  const clearPassword = formData.get("clearPassword") === "on";
  await updateGallerySettings(db, studio.id, galleryId, {
    ...data,
    ...(clearPassword ? { password: null } : newPassword ? { password: newPassword } : {}),
  });
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function addSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await createSection(db, studio.id, galleryId, String(formData.get("name") ?? ""));
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function renameSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await renameSection(db, studio.id, id.parse(formData.get("sectionId")), String(formData.get("name") ?? ""));
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function toggleSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await setSectionVisible(
    db, studio.id, id.parse(formData.get("sectionId")), formData.get("visible") === "true",
  );
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function moveSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  const sectionId = id.parse(formData.get("sectionId"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));

  const current = await listSections(db, studio.id, galleryId);
  const ids = current.map((s) => s.id);
  const i = ids.indexOf(sectionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderSections(db, studio.id, galleryId, ids);
  revalidatePath(`/admin/galleries/${galleryId}`);
}

export async function deleteSectionAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = id.parse(formData.get("galleryId"));
  await deleteSection(db, studio.id, id.parse(formData.get("sectionId")));
  revalidatePath(`/admin/galleries/${galleryId}`);
}
