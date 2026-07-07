"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studios } from "@/db/schema";
import { accessGallery } from "@/server/client-access";
import { signClientSession, clientCookieOptions, CLIENT_COOKIE } from "@/server/client-session";
import { checkRateLimit } from "@/server/rate-limit";
import { notifyPhotographer, firstAccessEmail } from "@/server/emails";

export type EnterState = { error: "invalidPassword" | "tooManyAttempts" | "genericError" } | null;

export async function enterGalleryAction(
  slug: string, _prev: EnterState, formData: FormData,
): Promise<EnterState> {
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!checkRateLimit(`${ip}:${slug}`)) return { error: "tooManyAttempts" };

  let result;
  try {
    result = await accessGallery(db, slug, {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
      password: String(formData.get("password") ?? "") || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "INVALID_PASSWORD" || msg === "PASSWORD_REQUIRED") return { error: "invalidPassword" };
    return { error: "genericError" };
  }

  const token = await signClientSession({ clientId: result.clientId, galleryId: result.gallery.id });
  (await cookies()).set(CLIENT_COOKIE, token, clientCookieOptions(slug));

  if (result.firstAccess) {
    const [studio] = await db.select().from(studios).where(eq(studios.id, result.gallery.studioId));
    const email = String(formData.get("email") ?? "");
    const payload = firstAccessEmail(result.gallery.title, email.toLowerCase().trim());
    void notifyPhotographer({ to: studio?.notificationEmail ?? null, ...payload }).catch(() => {});
  }

  redirect(`/g/${slug}`);
}
