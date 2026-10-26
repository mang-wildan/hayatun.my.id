import pg from "pg";
import { E2E_API_ENV, MAILPIT_URL } from "./env";

// Mengosongkan database tes (lewat role migrasi, karena role aplikasi tidak boleh TRUNCATE audit_logs) dan kotak email.
export default async function globalSetup() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public'");
  await pool.query(`truncate ${rows.map((r) => `"${r.t}"`).join(", ")} restart identity cascade`);
  await pool.end();
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => {}); // Mailpit hanya dipakai tes yang membaca email
}
