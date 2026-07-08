import { NextResponse } from "next/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireStudio } from "@/server/auth";
import { getObjectBuffer } from "@/server/storage";
import { applyWatermarks, type WatermarkSpec } from "@/server/images";
import { PLACEMENTS } from "@/server/watermarks";

export const maxDuration = 30;

const bodySchema = z.object({
  specs: z.array(z.object({
    type: z.enum(["text", "image"]),
    text: z.string().trim().max(100).nullable(),
    imageKey: z.string().nullable(),
    opacityPct: z.number().int().min(5).max(100),
    sizePct: z.number().int().min(5).max(50),
    placement: z.enum(PLACEMENTS),
  })).max(3),
});

export async function POST(request: Request) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const specs: WatermarkSpec[] = [];
  for (const s of parsed.data.specs) {
    if (s.type === "text") {
      if (!s.text) continue; // slot incompleto: se omite del preview
      specs.push({ type: "text", text: s.text, imageBuffer: null, opacityPct: s.opacityPct, sizePct: s.sizePct, placement: s.placement });
    } else {
      if (!s.imageKey) continue;
      if (!s.imageKey.startsWith(`studios/${studioId}/watermarks/`)) {
        return NextResponse.json({ error: "invalid_image_key" }, { status: 400 });
      }
      const imageBuffer = await getObjectBuffer(s.imageKey).catch(() => null);
      if (!imageBuffer) return NextResponse.json({ error: "image_not_found" }, { status: 400 });
      specs.push({ type: "image", text: null, imageBuffer, opacityPct: s.opacityPct, sizePct: s.sizePct, placement: s.placement });
    }
  }

  const sample = await readFile(path.join(process.cwd(), "public", "watermark-sample.jpg"));
  const rendered = await applyWatermarks(sample, specs);
  return new NextResponse(new Uint8Array(rendered), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
