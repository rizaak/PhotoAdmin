import { auth0 } from "@/lib/auth0";
import { db } from "@/db";
import type { Studio } from "@/db/schema";
import { ensureStudio } from "./studio";

export async function requireStudio(): Promise<Studio> {
  const session = await auth0.getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  const displayName =
    (session.user.name as string | undefined) ??
    (session.user.email as string | undefined) ??
    "Mi Estudio";
  return ensureStudio(db, session.user.sub, displayName, (session.user.email as string | undefined) ?? null);
}
