"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { createGallery, deleteGallery } from "@/server/galleries";

const createForm = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function createGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const data = createForm.parse({ title: formData.get("title") });
  await createGallery(db, studio.id, data);
  revalidatePath("/admin/galleries");
}

export async function deleteGalleryAction(formData: FormData) {
  const studio = await requireStudio();
  const galleryId = z.string().uuid().parse(formData.get("galleryId"));
  await deleteGallery(db, studio.id, galleryId);
  revalidatePath("/admin/galleries");
}
