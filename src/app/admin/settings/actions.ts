"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { saveWatermark, deleteWatermark, PLACEMENTS, type WatermarkInput } from "@/server/watermarks";
import { deleteObjects } from "@/server/storage";

const saveInput = z.object({
  slot: z.number().int().min(0).max(2),
  type: z.enum(["text", "image"]),
  text: z.string().trim().min(1).max(100).nullable(),
  imageKey: z.string().min(1).nullable(),
  opacityPct: z.number().int().min(5).max(100),
  sizePct: z.number().int().min(5).max(50),
  placement: z.enum(PLACEMENTS),
});

export async function saveWatermarkAction(input: WatermarkInput): Promise<void> {
  const studio = await requireStudio();
  const data = saveInput.parse(input);
  const { replacedImageKey } = await saveWatermark(db, studio.id, data);
  if (replacedImageKey) await deleteObjects([replacedImageKey]);
  revalidatePath("/admin/settings");
}

export async function deleteWatermarkAction(input: { slot: number }): Promise<void> {
  const studio = await requireStudio();
  const { slot } = z.object({ slot: z.number().int().min(0).max(2) }).parse(input);
  const { removedImageKey } = await deleteWatermark(db, studio.id, slot);
  if (removedImageKey) await deleteObjects([removedImageKey]);
  revalidatePath("/admin/settings");
}
