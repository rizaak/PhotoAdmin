import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  return db;
}

export async function seedStudio(db: Db, auth0UserId = "auth0|test-user") {
  const [studio] = await db
    .insert(schema.studios)
    .values({ name: "Test Studio", slug: `test-${auth0UserId.replace(/\W/g, "")}`, auth0UserId })
    .returning();
  return studio;
}
