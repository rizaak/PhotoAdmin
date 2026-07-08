import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getOwnedPhoto, markPhotoError } from "@/server/photos";

export const maxDuration = 60; // fotos grandes: descargar + sharp + subir

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

  let photo;
  try {
    photo = await getOwnedPhoto(db, studioId, photoId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (photo.status === "ready") return NextResponse.json({ status: "ready" });

  try {
    const { processPhoto } = await import("@/server/processing");
    await processPhoto(db, studioId, photoId);
    return NextResponse.json({ status: "ready" });
  } catch (e) {
    console.error("photo processing failed", photoId, e);
    try {
      await markPhotoError(db, studioId, photoId);
    } catch (err) {
      // la foto pudo ser eliminada concurrentemente; la respuesta 422 sigue siendo correcta
      console.error("markPhotoError failed", photoId, err);
    }
    return NextResponse.json({ status: "error" }, { status: 422 });
  }
}
