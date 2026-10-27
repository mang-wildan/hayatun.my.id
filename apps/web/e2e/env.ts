// Nilai khusus tes e2e. Bukan rahasia; kunci ini tidak pernah dipakai di luar database tes.
const key = (n: number) => Buffer.alloc(32, n).toString("base64");

export const WEB_URL = "http://127.0.0.1:3000";
export const E2E_API_ENV = {
  NODE_ENV: "test",
  APP_URL: WEB_URL,
  APP_TIMEZONE: "Asia/Jakarta",
  LOG_LEVEL: "info", // log antrean email ikut tampil di laporan CI untuk melacak kegagalan yang kadang terjadi
  LOG_DIR: "/tmp",
  WEB_PORT: "3000",
  API_PORT: "4000",
  API_INTERNAL_URL: "http://127.0.0.1:4000",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://hayatun_app:hayatun@127.0.0.1:5432/hayatun_test",
  DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL ?? "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_test",
  SESSION_SECRET: key(1),
  DATA_ENCRYPTION_KEYS: `k1:${key(2)}`,
  DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1",
  BLIND_INDEX_KEY: key(3),
  TOTP_ISSUER: "Hayatun",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  EMAIL_FROM: "toko@hayatun.my.id",
  ADMIN_BOOTSTRAP_EMAIL: "pemilik@hayatun.test",
  STORAGE_DIR: "/tmp/hayatun-e2e-files",
};
export const KEYS = { encryption: Buffer.alloc(32, 2), blindIndex: Buffer.alloc(32, 3) };
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
