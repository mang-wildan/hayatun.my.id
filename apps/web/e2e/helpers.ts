import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createCrypto } from "../../api/src/modules/crypto/index";
import { E2E_API_ENV, KEYS, WEB_URL } from "./env";

const crypto = createCrypto({ keys: { k1: KEYS.encryption }, activeKeyId: "k1", blindIndexKey: KEYS.blindIndex });

// Membuat admin lengkap dengan sesi langsung di database, untuk tes yang tidak menguji proses masuk.
export const adminCookie = (email = `admin-${Date.now()}@hayatun.test`) => sessionCookie("admin", email);
// Pembeli terverifikasi dengan sesi langsung di database
export const buyerCookie = (email = `pembeli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@hayatun.test`, opts: { verified?: boolean } = {}) => sessionCookie("buyer", email, opts.verified ?? true);

async function sessionCookie(role: "admin" | "buyer", email: string, verified = true) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (role, status, email_enc, email_index, name_enc, email_verified_at, totp_enabled)
     values ($4, 'active', $1, $2, $3, case when $6 then now() end, $5) returning id`,
    [crypto.encrypt(email), crypto.blindIndex(email), crypto.encrypt(role === "admin" ? "Admin Tes" : "Pembeli Tes"), role, role === "admin", verified],
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

// `contains`: hanya email yang isinya memuat teks itu (bila beberapa email dengan subjek sama dikirim ke alamat yang sama)
export async function latestEmailTo(address: string, subject?: string, contains?: string): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json();
    for (const hit of (found.messages ?? []).filter((m: { Subject: string }) => !subject || m.Subject === subject)) {
      const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json();
      if (!contains || full.Text.includes(contains)) return { subject: full.Subject, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  // saat gagal, tunjukkan isi Mailpit: email tidak pernah sampai, atau sampai tapi tidak cocok dengan pencarian
  const all = await (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=5`)).json().catch(() => null);
  const recent = (all?.messages ?? []).map((m: { Subject: string; To: { Address: string }[] }) => `${m.Subject} -> ${m.To?.map((t) => t.Address).join(",")}`);
  throw new Error(`Email untuk ${address} tidak muncul dalam 15 detik. Mailpit berisi ${all?.total ?? "?"} pesan; terbaru: ${recent.join(" | ") || "-"}`);
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
  // jejak keputusan verifikasi dari tes lain menunjuk ke admin ini
  await pool.query(`update orders set verified_by = null where verified_by in ${admins}`);
  await pool.query(`update payment_proofs set reviewed_by = null where reviewed_by in ${admins}`);
  await pool.query(`delete from audit_logs where actor_id in ${admins}`);
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

// Panggilan API sebagai admin, untuk mengubah produk di tengah tes (menonaktifkan, mengubah stok)
export async function adminApi(cookie: { name: string; value: string }, method: string, path: string, body?: object) {
  const res = await fetch(`${WEB_URL}${path}`, { method, headers: { Cookie: `${cookie.name}=${cookie.value}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
}

export const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };

// Data awal pembeli lewat API, bukan lewat tampilan
export async function userApi(cookie: { name: string; value: string }, method: string, path: string, body?: object) {
  const res = await fetch(`${WEB_URL}${path}`, { method, headers: { Cookie: `${cookie.name}=${cookie.value}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function countOrders() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from orders");
  await pool.end();
  return rows[0].n;
}

// Mengubah status pesanan langsung di database, karena verifikasi dan pembatalan belum punya antarmuka di tahap ini
export async function setOrderStatus(orderId: string, status: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("update orders set status = $1 where id = $2", [status, orderId]);
  await pool.end();
}

// Pengaturan toko (kunci seperti "bankAccount") langsung di database, karena halaman pengaturan baru ada di T48
export async function setSetting(key: string, value: object | null) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  if (value === null) await pool.query("delete from store_settings where key = $1", [key]);
  else await pool.query("insert into store_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
  await pool.end();
}

// Membuat batas bayar lewat tanpa menunggu 24 jam (statusnya sengaja tidak diubah, seperti saat tugas kedaluwarsa belum jalan)
export async function expireOrderNow(orderId: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [orderId]);
  await pool.end();
}

// Unggah bukti bayar lewat API (isi file apa adanya)
export async function uploadProofApi(cookie: { name: string; value: string }, orderId: string, file: Buffer, type = "application/pdf") {
  const res = await fetch(`${WEB_URL}/api/orders/${orderId}/proof`, { method: "POST", headers: { Cookie: `${cookie.name}=${cookie.value}`, "content-type": type }, body: new Uint8Array(file) });
  if (!res.ok) throw new Error(`unggah bukti -> ${res.status} ${await res.text()}`);
}

// Mengosongkan antrean verifikasi dari tes lain yang berbagi database (pesanannya dibatalkan, buktinya tetap)
export async function clearQueue() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("update orders set status = 'DIBATALKAN' where status = 'MENUNGGU_VERIFIKASI'");
  await pool.end();
}

export async function auditCount(action: string, entityId: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from audit_logs where action = $1 and entity_id = $2", [action, entityId]);
  await pool.end();
  return rows[0].n;
}

export async function orderStatusOf(orderId: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ status: string }>("select o.status from orders o where o.id = $1", [orderId]);
  await pool.end();
  return rows[0].status;
}

// Mengubah kolom pesanan langsung di database (status yang belum punya antarmuka, nomor resi sebelum T42)
export async function patchOrder(orderId: string, fields: Record<string, string | null>) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const keys = Object.keys(fields);
  await pool.query(`update orders set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [orderId, ...keys.map((k) => fields[k])]);
  await pool.end();
}

// File unduhan produk digital lewat API admin
export async function addProductFile(cookie: { name: string; value: string }, productId: string, data: Buffer, filename: string, type = "application/pdf") {
  const res = await fetch(`${WEB_URL}/api/admin/products/${productId}/files?filename=${encodeURIComponent(filename)}`, { method: "POST", headers: { Cookie: `${cookie.name}=${cookie.value}`, "content-type": type }, body: new Uint8Array(data) });
  if (!res.ok) throw new Error(`unggah file produk -> ${res.status} ${await res.text()}`);
}

// Menghapus kode lisensi yang ditahan sebuah produk, untuk memicu "Lisensi tertunda" (jaring pengaman F7.7)
export async function dropReservedCodes(productId: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("delete from license_codes where product_id = $1 and status = 'reserved'", [productId]);
  await pool.end();
}

// Mengosongkan daftar pengiriman admin dari tes lain yang berbagi database
export async function clearShipments() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("update orders set physical_status = 'DITERIMA' where physical_status in ('DIPROSES', 'DIKIRIM')");
  await pool.end();
}

// Mengosongkan semua pesanan (dan isinya) supaya daftar dan ringkasan admin tidak bergantung pada tes lain
export async function clearOrders() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("truncate orders restart identity cascade");
  await pool.end();
}

// n pesanan Kedaluwarsa tambahan milik pembeli pesanan pertama, untuk menguji halaman berikutnya
export async function bulkOrders(n: number) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query(`insert into orders (invoice_number, user_id, status, digital_status, physical_status, subtotal, shipping_cost, total, expires_at, created_at)
    select 'INV/BULK/' || lpad(g::text, 4, '0'), (select user_id from orders limit 1), 'KEDALUWARSA', 'TIDAK_ADA', 'TIDAK_ADA', 1000, 0, 1000, now(), now() - (g || ' minutes')::interval from generate_series(1, $1::int) g`, [n]);
  await pool.end();
}

// Pembeli dengan password sungguhan (untuk tes yang meminta password lagi): daftar, verifikasi lewat email, lalu masuk
export async function passwordBuyer(password = "rahasia-hayatun-1", name = "Budi Hapus") {
  const email = `hapus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@hayatun.test`;
  await createVerifiedBuyer(email, password, name);
  const res = await fetch(`${WEB_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`login -> ${res.status}`);
  const token = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("hayatun_sid="))!.slice("hayatun_sid=".length);
  return { email, cookie: { name: "hayatun_sid", value: token, url: WEB_URL } };
}

// Menyalakan TOTP untuk pembeli yang dibuat lewat buyerCookie, supaya tes bisa mematikannya sebagai admin
export async function enableTotp(email: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query("update users set totp_enabled = true, totp_secret_enc = $2 where email_index = $1", [crypto.blindIndex(email), crypto.encrypt("JBSWY3DPEHPK3PXP")]);
  await pool.end();
}
export async function totpEnabledOf(email: string) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ totp_enabled: boolean }>("select totp_enabled from users where email_index = $1", [crypto.blindIndex(email)]);
  await pool.end();
  return rows[0].totp_enabled;
}

// Catatan log langsung di database (aktor admin dari email, atau null untuk aksi sistem)
export async function seedAudit(rows: { actorEmail?: string; action: string; entityType?: string; entityId?: string; minutesAgo?: number }[]) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  for (const r of rows) {
    const actor = r.actorEmail ? (await pool.query<{ id: string }>(`select id from users where email_index = $1`, [crypto.blindIndex(r.actorEmail)])).rows[0].id : null;
    await pool.query(`insert into audit_logs (actor_id, action, entity_type, entity_id, created_at) values ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`, [actor, r.action, r.entityType ?? "order", r.entityId ?? "e2e-x", String(r.minutesAgo ?? 0)]);
  }
  await pool.end();
}
export async function seedAuditBulk(actorEmail: string, n: number) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { id } = (await pool.query<{ id: string }>(`select id from users where email_index = $1`, [crypto.blindIndex(actorEmail)])).rows[0];
  await pool.query(`insert into audit_logs (actor_id, action, entity_type, entity_id, created_at) select $1, 'order.shipped', 'order', 'e2e-bulk-' || g, now() - (g || ' seconds')::interval from generate_series(1, $2) g`, [id, n]);
  await pool.end();
}
// Tes halaman log menghitung baris, jadi sisa catatan dari spec lain dikosongkan (hanya database e2e, lewat role pemilik)
export async function clearAudit() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  await pool.query(`delete from audit_logs`);
  await pool.end();
}
export async function auditTotal() {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from audit_logs`);
  await pool.end();
  return rows[0].n;
}
