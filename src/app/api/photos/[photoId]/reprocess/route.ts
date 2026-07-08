import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getOwnedPhoto, markPhotoError } from "@/server/photos";
import { processPhoto } from "@/server/processing";

export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { photoId } = await params;
  if (!z.string().uuid().safeParse(photoId).success) {
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 });
  }
  try {
    await getOwnedPhoto(db, studioId, photoId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    await processPhoto(db, studioId, photoId);
    return NextResponse.json({ status: "ready" });
  } catch (e) {
    console.error("photo reprocess failed", photoId, e);
    try {
      await markPhotoError(db, studioId, photoId);
    } catch (err) {
      console.error("markPhotoError failed", photoId, err);
    }
    return NextResponse.json({ status: "error" }, { status: 422 });
  }
}
