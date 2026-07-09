import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getGallery } from "@/server/galleries";
import { presignUpload } from "@/server/storage";

const bodySchema = z.object({
  galleryId: z.string().uuid(),
  contentType: z.enum(["image/jpeg", "image/png"]),
  size: z.number().int().positive().max(10 * 1024 * 1024),
});

export async function POST(request: Request) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    await getGallery(db, studioId, parsed.data.galleryId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ext = parsed.data.contentType === "image/png" ? "png" : "jpg";
  const key = `studios/${studioId}/covers/${parsed.data.galleryId}/${randomUUID()}.${ext}`;
  const uploadUrl = await presignUpload(key, parsed.data.contentType, 600, parsed.data.size);
  return NextResponse.json({ uploadUrl, key });
}
