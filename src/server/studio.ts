import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { studios, type Studio } from "@/db/schema";
import { makeSlug } from "./slug";

export async function ensureStudio(db: Db, auth0UserId: string, displayName: string): Promise<Studio> {
  const existing = await db.select().from(studios).where(eq(studios.auth0UserId, auth0UserId));
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(studios)
    .values({ name: displayName, slug: makeSlug(displayName), auth0UserId })
    .returning();
  return created;
}
