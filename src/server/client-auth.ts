import { cookies } from "next/headers";
import { db } from "@/db";
import type { Gallery } from "@/db/schema";
import { CLIENT_COOKIE, verifyClientSession } from "./client-session";
import { getPublicGallery } from "./client-access";

export async function getOptionalClientSession(
  slug: string,
): Promise<{ gallery: Gallery; clientId: string } | null> {
  const gallery = await getPublicGallery(db, slug); // NOT_FOUND si no publicada
  const token = (await cookies()).get(CLIENT_COOKIE)?.value;
  if (!token) return null;
  const session = await verifyClientSession(token);
  if (!session || session.galleryId !== gallery.id) return null;
  return { gallery, clientId: session.clientId };
}

export async function requireClientSession(slug: string): Promise<{ gallery: Gallery; clientId: string }> {
  const session = await getOptionalClientSession(slug);
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
