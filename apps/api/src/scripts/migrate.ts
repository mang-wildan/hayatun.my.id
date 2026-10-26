import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PgBoss } from "pg-boss";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL belum diatur");

const pool = new pg.Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });

// Skema antrean dibuat di sini oleh role pemilik; role aplikasi hanya diberi hak di skema pgboss
const boss = new PgBoss(url);
await boss.start();
await boss.stop();
await pool.query(`
  GRANT USAGE, CREATE ON SCHEMA pgboss TO hayatun_app;
  GRANT ALL ON ALL TABLES IN SCHEMA pgboss TO hayatun_app;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA pgboss TO hayatun_app;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA pgboss TO hayatun_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO hayatun_app;
`);
await pool.end();
console.log("Migrasi selesai.");
