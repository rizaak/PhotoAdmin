import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Tipo aceptado por toda la capa de dominio: sirve tanto para el pool de
// node-postgres (prod/dev) como para PGlite (tests).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db: Db = drizzle(pool, { schema });
