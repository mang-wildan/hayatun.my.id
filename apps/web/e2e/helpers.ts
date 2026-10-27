import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createCrypto } from "../../api/src/modules/crypto/index";
import { E2E_API_ENV, KEYS, WEB_URL } from "./env";

const crypto = createCrypto({ keys: { k1: KEYS.encryption }, activeKeyId: "k1", blindIndexKey: KEYS.blindIndex });

// Membuat admin lengkap dengan sesi langsung di database, untuk tes yang tidak menguji proses masuk.
export async function adminCookie(email = `admin-${Date.now()}@hayatun.test`) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (role, status, email_enc, email_index, name_enc, email_verified_at, totp_enabled)
     values ('admin', 'active', $1, $2, $3, now(), true) returning id`,
    [crypto.encrypt(email), crypto.blindIndex(email), crypto.encrypt("Admin Tes")],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`,
    [createHash("sha256").update(token).digest("hex"), rows[0].id],
  );
  await pool.end();
  return { name: "hayatun_sid", value: token, url: WEB_URL };
}

// ---- email (Mailpit) dan TOTP, untuk tes yang membaca kotak masuk ----
import { execFileSync } from "node:child_process";
import { generateSync } from "otplib";
import { MAILPIT_URL } from "./env";

export async function latestEmailTo(address: string, subject?: string): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json();
    const hit = (found.messages ?? []).find((m: { Subject: string }) => !subject || m.Subject === subject);
    if (hit) {
      const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json();
      return { subject: full.Subject, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Email untuk ${address} tidak muncul dalam 15 detik`);
}

export const linkFrom = (text: string) => text.match(/https?:\/\/\S+/)![0];

// Kode TOTP untuk sekarang + offsetSec. Pakai +30 untuk kode berikutnya, karena kode yang sama tidak boleh dipakai dua kali.
export const totpNow = (secret: string, offsetSec = 0) => generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + offsetSec });

// Menjalankan skrip admin:bootstrap sungguhan (SMTP ke Mailpit).
export function runBootstrap(email: string) {
  execFileSync("npm", ["-w", "apps/api", "run", "admin:bootstrap"], {
    cwd: "../..",
    env: { ...process.env, ...E2E_API_ENV, ADMIN_BOOTSTRAP_EMAIL: email } as NodeJS.ProcessEnv,
    stdio: "pipe",
  });
}

// Pembeli yang sudah terverifikasi, dibuat lewat API.
export async function createVerifiedBuyer(email: string, password: string, name = "Budi") {
  const post = (path: string, data: object) => fetch(`${WEB_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  expectOk(await post("/api/auth/register", { name, email, password }));
  const mail = await latestEmailTo(email, "Verifikasi email akun Hayatun-mu");
  expectOk(await post("/api/auth/verify-email", { token: new URL(linkFrom(mail.text)).searchParams.get("token") }));
}
function expectOk(res: Response) { if (!res.ok) throw new Error(`Permintaan gagal: ${res.status}`); }

// Menghapus semua admin beserta sesinya, supaya tes undangan tidak bergantung pada tes lain yang membuat admin.
export async function resetAdmins() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const admins = "(select id from users where role = 'admin')";
  await pool.query(`delete from sessions where user_id in ${admins}`);
  await pool.query(`delete from auth_tokens where user_id in ${admins}`);
  await pool.query(`delete from users where role = 'admin'`);
  await pool.end();
}

// ---- produk: data awal dibuat lewat API admin, bukan lewat tampilan ----

// PNG 1x1 yang valid, supaya browser benar-benar bisa menampilkannya
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface SeedProduct {
  name: string;
  type?: "digital" | "physical";
  price?: number;
  description?: string;
  weightG?: number;
  stockQty?: number;
  isLicensed?: boolean;
  cover?: boolean;
  activate?: boolean; // bawaan: ya
  licenses?: string;
}

export async function seedProduct(cookie: { name: string; value: string }, p: SeedProduct): Promise<{ id: string; slug: string }> {
  const headers = { Cookie: `${cookie.name}=${cookie.value}` };
  const call = async (path: string, init: RequestInit, okStatuses = [200, 201, 204]) => {
    const res = await fetch(`${WEB_URL}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!okStatuses.includes(res.status)) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  const type = p.type ?? "digital";
  const created = await call("/api/admin/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: p.name, type, price: p.price ?? 75000, description: p.description ?? "Deskripsi " + p.name,
      ...(type === "physical" ? { weightG: p.weightG ?? 500, stockQty: p.stockQty ?? 10 } : { isLicensed: p.isLicensed ?? false }),
    }),
  });
  if (p.cover) await call(`/api/admin/products/${created.id}/cover`, { method: "PUT", headers: { "content-type": "image/png" }, body: PNG_1X1 });
  if (type === "digital") {
    await call(`/api/admin/products/${created.id}/links`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://contoh.id/unduh", label: "Unduh" }),
    });
    if (p.licenses) await call(`/api/admin/products/${created.id}/licenses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: p.licenses }) });
  }
  if (p.activate !== false) await call(`/api/admin/products/${created.id}/activate`, { method: "POST" });
  return { id: created.id, slug: created.slug };
}

// Menghapus semua produk beserta file dan kode lisensinya, supaya tes katalog tidak bergantung pada tes lain.
export async function resetProducts() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' and tablename in ('license_codes', 'product_files', 'products')");
  if (rows.length) await pool.query(`truncate ${rows.map((r) => r.t).join(", ")} cascade`);
  await pool.end();
}
