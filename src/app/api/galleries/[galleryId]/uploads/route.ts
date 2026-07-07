import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { registerUpload } from "@/server/photos";
import { presignUpload } from "@/server/storage";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ galleryId: string }> },
) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { galleryId } = await params;
  if (!z.string().uuid().safeParse(galleryId).success) {
    return NextResponse.json({ error: "invalid_gallery" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const photo = await registerUpload(db, studioId, galleryId, body);
    const uploadUrl = await presignUpload(photo.originalKey, body.contentType, undefined, photo.sizeOriginalBytes);
    return NextResponse.json({ photoId: photo.id, uploadUrl });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    if (e instanceof Error && (e.message === "NOT_FOUND" || e.message === "SECTION_NOT_IN_GALLERY")) {
      return NextResponse.json({ error: e.message.toLowerCase() }, { status: 404 });
    }
    throw e;
  }
}
