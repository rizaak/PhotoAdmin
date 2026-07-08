import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { watermarks, photos, galleries, type Watermark } from "@/db/schema";

export const PLACEMENTS = ["tl", "tc", "tr", "ml", "center", "mr", "bl", "bc", "br", "tile"] as const;
export type Placement = (typeof PLACEMENTS)[number];

const inputSchema = z.object({
  slot: z.number().int().min(0).max(2),
  type: z.enum(["text", "image"]),
  text: z.string().trim().min(1).max(100).nullable(),
  imageKey: z.string().min(1).nullable(),
  opacityPct: z.number().int().min(5).max(100),
  sizePct: z.number().int().min(5).max(50),
  placement: z.enum(PLACEMENTS),
}).refine((w) => (w.type === "text" ? !!w.text : !!w.imageKey), {
  message: "text requiere texto; image requiere imageKey",
});
export type WatermarkInput = z.infer<typeof inputSchema>;

export async function listWatermarks(db: Db, studioId: string): Promise<Watermark[]> {
  return db.select().from(watermarks)
    .where(eq(watermarks.studioId, studioId))
    .orderBy(asc(watermarks.slot));
}

async function clearStudioWatermarkKeys(db: Db, studioId: string): Promise<void> {
  await db.update(photos)
    .set({ thumbWmKey: null, webWmKey: null, highWmKey: null })
    .where(inArray(
      photos.galleryId,
      db.select({ id: galleries.id }).from(galleries).where(eq(galleries.studioId, studioId)),
    ));
}

export async function saveWatermark(
  db: Db, studioId: string, input: WatermarkInput,
): Promise<{ watermark: Watermark; replacedImageKey: string | null }> {
  const data = inputSchema.parse(input);
  if (data.type === "image" && !data.imageKey!.startsWith(`studios/${studioId}/watermarks/`)) {
    throw new Error("INVALID_IMAGE_KEY");
  }
  const values = {
    studioId,
    slot: data.slot,
    type: data.type,
    text: data.type === "text" ? data.text : null,
    imageKey: data.type === "image" ? data.imageKey : null,
    opacityPct: data.opacityPct,
    sizePct: data.sizePct,
    placement: data.placement,
  };
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(watermarks)
      .where(and(eq(watermarks.studioId, studioId), eq(watermarks.slot, data.slot)));
    const [watermark] = await tx.insert(watermarks).values(values)
      .onConflictDoUpdate({ target: [watermarks.studioId, watermarks.slot], set: values })
      .returning();
    await clearStudioWatermarkKeys(tx, studioId);
    const replacedImageKey =
      existing?.imageKey && existing.imageKey !== watermark.imageKey ? existing.imageKey : null;
    return { watermark, replacedImageKey };
  });
}

export async function deleteWatermark(
  db: Db, studioId: string, slot: number,
): Promise<{ removedImageKey: string | null }> {
  const parsedSlot = z.number().int().min(0).max(2).parse(slot);
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(watermarks)
      .where(and(eq(watermarks.studioId, studioId), eq(watermarks.slot, parsedSlot)))
      .returning();
    if (deleted.length === 0) throw new Error("NOT_FOUND");
    await clearStudioWatermarkKeys(tx, studioId);
    return { removedImageKey: deleted[0].imageKey };
  });
}
