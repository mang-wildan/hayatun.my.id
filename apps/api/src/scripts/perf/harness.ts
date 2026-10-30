import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { loadConfig } from "../../config.js";
import { createCrypto } from "../../modules/crypto/index.js";

// Kunci khusus tes, sama seperti e2e. Bukan rahasia dan tidak pernah dipakai di luar database tes.
const key = (n: number) => Buffer.alloc(32, n).toString("base64");
export const API_URL = "http://127.0.0.1:4000";
export const WEB_URL = "http://127.0.0.1:3000";
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
export const PERF_ENV: Record<string, string> = {
  NODE_ENV: "test", APP_URL: WEB_URL, APP_TIMEZONE: "Asia/Jakarta", LOG_LEVEL: "warn", LOG_DIR: "/tmp",
  WEB_PORT: "3000", API_PORT: "4000", API_INTERNAL_URL: API_URL,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://hayatun_app:hayatun@127.0.0.1:5432/hayatun_test",
  DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL ?? "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_test",
  SESSION_SECRET: key(1), DATA_ENCRYPTION_KEYS: `k1:${key(2)}`, DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1", BLIND_INDEX_KEY: key(3),
  TOTP_ISSUER: "Hayatun", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", SMTP_USER: "", SMTP_PASSWORD: "", EMAIL_FROM: "toko@hayatun.my.id",
  STORAGE_DIR: "/tmp/hayatun-perf-files", SHIPPING_PROVIDER: "fake", SHIPPING_ORIGIN_AREA_ID: "area-asal",
};

export const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// JPEG 800x1000 (~170 KB) bermotif halus dengan sedikit derau: sampul mentah seukuran foto produk yang diunggah admin
export async function photoJpeg(): Promise<Buffer> {
  const w = 800, h = 1000, raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, n = (Math.random() - 0.5) * 24;
    raw[i] = 120 + 90 * Math.sin(x / 90) + n; raw[i + 1] = 110 + 80 * Math.cos(y / 70 + x / 300) + n; raw[i + 2] = 140 + 60 * Math.sin((x + y) / 130) + n;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if ((await fetch(url).catch(() => null))?.ok) return; await sleep(500); }
  throw new Error(`${url} tidak siap dalam ${ms / 1000} detik`);
}

export interface Stack { pool: pg.Pool; crypto: ReturnType<typeof createCrypto>; stop: () => Promise<void> }

// Mengosongkan database (hanya yang namanya berakhiran _test atau _perf), lalu menjalankan API (dan web bila diminta) sebagai proses terpisah
export async function startStack({ web = false } = {}): Promise<Stack> {
  const db = new URL(PERF_ENV.DATABASE_MIGRATION_URL).pathname.slice(1);
  if (!/_(test|perf)$/.test(db)) throw new Error(`Menolak berjalan di database "${db}": hanya yang berakhiran _test atau _perf`);
  const pool = new pg.Pool({ connectionString: PERF_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public'");
  await pool.query(`truncate ${rows.map((r) => `"${r.t}"`).join(", ")} restart identity cascade`);
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => {});

  const env = { ...process.env, ...PERF_ENV };
  const kids: ChildProcess[] = [spawn("npm", ["-w", "apps/api", "run", "start"], { env, stdio: "inherit", cwd: new URL("../../../../..", import.meta.url).pathname, detached: true })];
  if (web) kids.push(spawn("npm", ["-w", "apps/web", "run", "start"], { env, stdio: "inherit", cwd: new URL("../../../../..", import.meta.url).pathname, detached: true }));
  await waitFor(`${API_URL}/api/health`, 60_000);
  if (web) await waitFor(`${WEB_URL}/api/health`, 60_000);

  const config = loadConfig(PERF_ENV);
  const crypto = createCrypto({ keys: config.encryptionKeys, activeKeyId: config.activeKeyId, blindIndexKey: config.blindIndexKey });
  const stop = async () => { for (const k of kids) { try { process.kill(-k.pid!, "SIGTERM"); } catch { /* sudah berhenti */ } } await pool.end(); };
  return { pool, crypto, stop };
}

// Pengguna dan sesi langsung di database (seperti helper e2e); mengembalikan cookie sesi
export async function addUser(s: Stack, role: "buyer" | "admin", email: string, sessions = 1): Promise<{ id: string; cookies: string[] }> {
  const { rows } = await s.pool.query<{ id: string }>(
    `insert into users (role, status, email_enc, email_index, name_enc, email_verified_at, totp_enabled) values ($4, 'active', $1, $2, $3, now(), $5) returning id`,
    [s.crypto.encrypt(email), s.crypto.blindIndex(email), s.crypto.encrypt(role === "admin" ? "Admin Uji" : "Pembeli Uji"), role, role === "admin"],
  );
  const cookies: string[] = [];
  for (let i = 0; i < sessions; i++) {
    const token = randomBytes(32).toString("base64url");
    await s.pool.query(`insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '2 hours')`, [createHash("sha256").update(token).digest("hex"), rows[0].id]);
    cookies.push(`hayatun_sid=${token}`);
  }
  return { id: rows[0].id, cookies };
}

export async function call(cookie: string, method: string, path: string, body?: unknown, type = "application/json") {
  const res = await fetch(`${API_URL}${path}`, { method, headers: { Cookie: cookie, "content-type": type }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) });
  const buf = await res.arrayBuffer();
  const text = Buffer.from(buf).toString("utf8");
  return { status: res.status, json: () => (text ? JSON.parse(text) : null) };
}

// Produk digital aktif dengan satu tautan unduhan (dan sampul bila diminta)
export async function seedProducts(adminCookie: string, names: string[], cover?: Buffer) {
  const out: { id: string; slug: string }[] = [];
  for (const name of names) {
    const made = await call(adminCookie, "POST", "/api/admin/products", { name, type: "digital", price: 75000, description: `Deskripsi ${name}`, isLicensed: false });
    if (made.status !== 201) throw new Error(`Gagal membuat produk: ${made.status}`);
    const p = made.json();
    await call(adminCookie, "POST", `/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" });
    if (cover) await call(adminCookie, "PUT", `/api/admin/products/${p.id}/cover`, cover, "image/jpeg");
    await call(adminCookie, "POST", `/api/admin/products/${p.id}/activate`, {});
    out.push({ id: p.id, slug: p.slug });
  }
  return out;
}
