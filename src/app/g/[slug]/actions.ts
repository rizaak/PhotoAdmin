"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { studios, clients, photos } from "@/db/schema";
import { accessGallery } from "@/server/client-access";
import { signClientSession, clientCookieOptions, CLIENT_COOKIE } from "@/server/client-session";
import { checkRateLimit, isRateLimited } from "@/server/rate-limit";
import { notifyPhotographer, firstAccessEmail, commentEmail } from "@/server/emails";
import { requireClientSession } from "@/server/client-auth";
import { toggleLike, addComment } from "@/server/engagement";

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
