import { randomUUID } from "node:crypto";
import pg from "pg";
import { createDb, type Db } from "../db/client.js";
import { users } from "../db/schema.js";

// Tes API memakai database sungguhan; jalankan `npm -w apps/api run db:migrate` lebih dulu.
export const testDb = () => createDb(process.env.DATABASE_URL!);

// Mengosongkan semua tabel lewat role migrasi, karena role aplikasi tidak boleh TRUNCATE audit_logs.
export async function resetDb() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public'");
  await pool.query(`truncate ${rows.map((r) => `"${r.t}"`).join(", ")} restart identity cascade`);
  await pool.end();
}

export async function insertUser(db: Db, over: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ role: "buyer", emailEnc: "enc", emailIndex: randomUUID(), ...over })
    .returning({ id: users.id });
  return u.id;
}
