"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { createSectionFromSelection } from "@/server/activity";

const schema = z.object({
  galleryId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).min(1),
  name: z.string().trim().min(1).max(100),
  hideOthers: z.boolean(),
});

export type SelectionState = { error: "emptySelection" } | { created: number } | null;

export async function createSectionFromSelectionAction(
  _prev: SelectionState, formData: FormData,
): Promise<SelectionState> {
  const studio = await requireStudio();
  const data = schema.parse({
    galleryId: formData.get("galleryId"),
    clientIds: formData.getAll("clientIds").map(String),
    name: formData.get("name"),
    hideOthers: formData.get("hideOthers") === "on",
  });
  try {
    const { movedCount } = await createSectionFromSelection(
      db, studio.id, data.galleryId, data.clientIds, data.name, data.hideOthers,
    );
    revalidatePath(`/admin/galleries/${data.galleryId}`);
    revalidatePath(`/admin/galleries/${data.galleryId}/activity`);
    return { created: movedCount };
  } catch (e) {
    if (e instanceof Error && e.message === "EMPTY_SELECTION") return { error: "emptySelection" };
    throw e;
  }
}
