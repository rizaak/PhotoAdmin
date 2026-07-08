"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { studios, clients, photos, sections, activityEvents } from "@/db/schema";
import { accessGallery, getClientGalleryData } from "@/server/client-access";
import { signClientSession, clientCookieOptions, CLIENT_COOKIE } from "@/server/client-session";
import { checkRateLimit, isRateLimited } from "@/server/rate-limit";
import { notifyPhotographer, firstAccessEmail, commentEmail } from "@/server/emails";
import { requireClientSession } from "@/server/client-auth";
import { toggleLike, addComment } from "@/server/engagement";
import {
  effectiveWatermarkMode, effectiveDownloadEnabled, enabledResolutions, downloadKey,
} from "@/server/delivery";
import { presignDownload, putObjectBuffer } from "@/server/storage";
import { buildZipManifest, signZipToken } from "@/server/zip";

export type EnterState = { error: "invalidPassword" | "tooManyAttempts" | "genericError" } | null;

export async function enterGalleryAction(
  slug: string, _prev: EnterState, formData: FormData,
): Promise<EnterState> {
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const limitKey = `${ip}:${slug}`;
  if (isRateLimited(limitKey)) return { error: "tooManyAttempts" };

  let result;
  try {
    result = await accessGallery(db, slug, {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
      password: String(formData.get("password") ?? "") || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "INVALID_PASSWORD" || msg === "PASSWORD_REQUIRED") {
      checkRateLimit(limitKey);
      return { error: "invalidPassword" };
    }
    return { error: "genericError" };
  }

  const token = await signClientSession({ clientId: result.clientId, galleryId: result.gallery.id });
  (await cookies()).set(CLIENT_COOKIE, token, clientCookieOptions(slug));

  if (result.firstAccess) {
    const galleryTitle = result.gallery.title;
    const studioId = result.gallery.studioId;
    const clientEmail = String(formData.get("email") ?? "").toLowerCase().trim();
    after(async () => {
      try {
        const [studio] = await db.select().from(studios).where(eq(studios.id, studioId));
        await notifyPhotographer({ to: studio?.notificationEmail ?? null, ...firstAccessEmail(galleryTitle, clientEmail) });
      } catch (e) {
        console.error("first-access email failed", e);
      }
    });
  }

  redirect(`/g/${slug}`);
}

const likeInput = z.object({ slug: z.string().min(1), photoId: z.string().uuid() });

export async function toggleLikeAction(input: { slug: string; photoId: string }) {
  const data = likeInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);
  return toggleLike(db, clientId, gallery.id, data.photoId);
}

const commentInput = likeInput.extend({ body: z.string().trim().min(1).max(1000) });

export async function addCommentAction(input: { slug: string; photoId: string; body: string }) {
  const data = commentInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);
  if (!checkRateLimit(`comment:${clientId}`, 30, 60_000)) throw new Error("RATE_LIMITED");
  const comment = await addComment(db, clientId, gallery.id, data.photoId, data.body);

  if (comment.created) {
    after(async () => {
      try {
        const [studio] = await db.select().from(studios).where(eq(studios.id, gallery.studioId));
        const [photo] = await db.select({ filename: photos.filename }).from(photos).where(eq(photos.id, data.photoId));
        const [clientRow] = await db.select({ email: clients.email }).from(clients).where(eq(clients.id, clientId));
        await notifyPhotographer({
          to: studio?.notificationEmail ?? null,
          ...commentEmail(gallery.title, clientRow?.email ?? "cliente", comment.body, photo?.filename ?? ""),
        });
      } catch (e) {
        console.error("comment email failed", e);
      }
    });
  }

  return { id: comment.id, body: comment.body };
}

const downloadInput = z.object({
  slug: z.string().min(1),
  photoId: z.string().uuid(),
  resolution: z.enum(["web", "high", "original"]),
});

export async function downloadPhotoAction(
  input: { slug: string; photoId: string; resolution: "web" | "high" | "original" },
): Promise<{ url: string }> {
  const data = downloadInput.parse(input);
  const { gallery, clientId } = await requireClientSession(data.slug);

  const [photo] = await db.select().from(photos)
    .where(and(eq(photos.id, data.photoId), eq(photos.galleryId, gallery.id)));
  if (!photo || !photo.published || photo.status !== "ready") throw new Error("NOT_FOUND");

  let section = null;
  if (photo.sectionId) {
    [section] = await db.select().from(sections).where(eq(sections.id, photo.sectionId));
    if (!section || !section.visible) throw new Error("NOT_FOUND");
  }
  if (!effectiveDownloadEnabled(section, gallery)) throw new Error("NOT_AVAILABLE");
  if (!enabledResolutions(gallery).includes(data.resolution)) throw new Error("NOT_AVAILABLE");

  const mode = effectiveWatermarkMode(photo, section, gallery);
  const key = downloadKey(photo, mode, data.resolution);
  if (!key) throw new Error("NOT_AVAILABLE");

  const stem = photo.filename.replace(/\.[^.]+$/, "");
  const filename = data.resolution === "original" ? photo.filename
    : data.resolution === "web" ? `${stem}-web.jpg` : `${stem}-alta.jpg`;
  const url = await presignDownload(key, 900, filename);

  await db.insert(activityEvents).values({
    galleryId: gallery.id, clientId, photoId: photo.id, type: "download_photo",
    metadata: { resolution: data.resolution },
  });
  return { url };
}

const zipInput = z.object({
  slug: z.string().min(1),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("gallery") }),
    z.object({ type: z.literal("favorites") }),
    z.object({ type: z.literal("section"), sectionId: z.string().uuid() }),
  ]),
  resolution: z.enum(["web", "high", "original"]),
});

export async function zipRequestAction(
  input: { slug: string; scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }; resolution: "web" | "high" | "original" },
): Promise<{ url: string }> {
  const data = zipInput.parse(input);
  const workerUrl = process.env.ZIP_WORKER_URL;
  if (!workerUrl || !process.env.ZIP_SIGNING_SECRET) throw new Error("ZIP_NOT_CONFIGURED");

  const { gallery, clientId } = await requireClientSession(data.slug);
  if (!checkRateLimit(`zip:${clientId}`, 10, 60_000)) throw new Error("RATE_LIMITED");

  const galleryData = await getClientGalleryData(db, gallery.id, clientId);
  if (!enabledResolutions(gallery).includes(data.resolution)) throw new Error("NOT_AVAILABLE");

  const sectionById = new Map(galleryData.sections.map((s) => [s.id, s]));
  let candidates = galleryData.photos;
  if (data.scope.type === "section") {
    candidates = candidates.filter((p) => p.sectionId === (data.scope as { sectionId: string }).sectionId);
  } else if (data.scope.type === "favorites") {
    const liked = new Set(galleryData.likedPhotoIds);
    candidates = candidates.filter((p) => liked.has(p.id));
  }

  const entries: { key: string; name: string }[] = [];
  for (const photo of candidates) {
    const section = photo.sectionId ? sectionById.get(photo.sectionId) ?? null : null;
    if (!effectiveDownloadEnabled(section, gallery)) continue;
    const mode = effectiveWatermarkMode(photo, section, gallery);
    const key = downloadKey(photo, mode, data.resolution);
    if (!key) continue;
    const stem = photo.filename.replace(/\.[^.]+$/, "");
    entries.push({
      key,
      name: data.resolution === "original" ? photo.filename
        : data.resolution === "web" ? `${stem}-web.jpg` : `${stem}-alta.jpg`,
    });
  }

  const manifest = buildZipManifest({
    zipName: `${gallery.title.replace(/[^\w. -]+/g, "_")}.zip`,
    entries,
  });
  const manifestKey = `studios/${gallery.studioId}/galleries/${gallery.id}/zips/${randomUUID()}.json`;
  await putObjectBuffer(manifestKey, Buffer.from(JSON.stringify(manifest)), "application/json");
  const token = await signZipToken(manifestKey);

  await db.insert(activityEvents).values({
    galleryId: gallery.id, clientId, type: "download_zip",
    metadata: { scope: data.scope.type, resolution: data.resolution, count: manifest.files.length },
  });
  return { url: `${workerUrl.replace(/\/$/, "")}/?token=${token}` };
}
