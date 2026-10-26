import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];
