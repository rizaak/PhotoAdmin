import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { studios, type Studio } from "@/db/schema";
import { makeSlug } from "./slug";

export async function ensureStudio(
  db: Db, auth0UserId: string, displayName: string, email?: string | null,
): Promise<Studio> {
  const existing = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(studios)
    .values({ name: displayName, slug: makeSlug(displayName), auth0UserId, notificationEmail: email ?? null })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const [winner] = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  return winner;
}
