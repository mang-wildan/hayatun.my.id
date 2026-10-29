import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { processAccountDeletions } from "./delete-account.js";

const PASSWORD = "rahasia-hayatun-1";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const DELETED_SUBJECT = "Akunmu sudah dihapus";

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
let sitiId: string;
let rina: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie();
  admin = api(ctx, adminCookie);
  [siti, sitiId] = await buyer("siti@hayatun.test", "Siti Aminah");
  [rina] = await buyer("rina@hayatun.test", "Rina Marlina");
});
afterEach(() => ctx.close());

async function buyer(email: string, name: string): Promise<[ReturnType<typeof api>, string]> {
  const id = await ctx.createUser({ email, password: PASSWORD, name });
  return [api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`), id];
}
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const user = async (id: string) => (await rows<Record<string, unknown>>(sql`select * from users where id = ${id}`))[0];
const audit = async (action: string) => rows<{ actor_id: string | null; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_id, details from audit_logs where action = ${action} order by id`);
const mails = async (to: string, subject: string) => (await ctx.emails()).filter((m) => m.to === to && m.subject === subject);
const deps = () => ({ db: ctx.db, crypto: ctx.crypto, queue: ctx.queue, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now });
const sweep = () => processAccountDeletions(deps());
const requestDeletion = (who = siti, password: unknown = PASSWORD) => who.post("/api/account/deletion", { password });

async function digital(who = siti, paid = true) {
  const p = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
  await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  if (paid) {
    await who.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  }
  return o;
}
async function physical(who = siti) {
  const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", price: 120000, stockQty: 20 });
  await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await who.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const o = (await who.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 255000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await who.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return o;
}

describe("meminta hapus akun (F1.5)", () => {
  it("harus masuk, pembeli saja, dan password diminta lagi", async () => {
    await request(ctx.app).post("/api/account/deletion").send({ password: PASSWORD }).expect(401);
    await requestDeletion(admin).expect(403);
    const wrong = await requestDeletion(siti, "salah-password").expect(403);
    expect(wrong.body.fields.password).toBe("Password salah.");
    expect((await requestDeletion(siti, "").expect(422)).body.fields.password).toBe("Password wajib diisi.");
    expect((await siti.post("/api/account/deletion", {}).expect(422)).body.fields.password).toBe("Password wajib diisi.");
    expect((await user(sitiId)).deletion_requested_at).toBeNull();
    expect(await audit("account.deletion_requested")).toEqual([]);
  });

  it("permintaan dicatat dengan log, dan statusnya bisa dibaca", async () => {
    expect((await siti.get("/api/account/deletion").expect(200)).body).toEqual({ requestedAt: null, blockers: [] });
    const res = (await requestDeletion().expect(200)).body;
    expect(res).toEqual({ requestedAt: ctx.clock.now.toISOString(), blockers: [] });
    expect((await siti.get("/api/account/deletion").expect(200)).body).toEqual(res);
    const log = await audit("account.deletion_requested");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: sitiId, entity_id: sitiId });
    ctx.clock.advance(60_000);
    expect((await requestDeletion().expect(200)).body.requestedAt).toBe(res.requestedAt); // diajukan ulang: waktu asli dan satu log
    expect(await audit("account.deletion_requested")).toHaveLength(1);
    await request(ctx.app).get("/api/account/deletion").expect(401);
  });

  it("permintaan bisa dibatalkan sebelum diproses, lalu diajukan lagi", async () => {
    await requestDeletion().expect(200);
    expect((await siti.del("/api/account/deletion").expect(200)).body).toEqual({ requestedAt: null, blockers: [] });
    expect(await sweep()).toBe(0);
    expect((await user(sitiId)).status).toBe("active");
    await siti.del("/api/account/deletion").expect(200); // tanpa permintaan: tidak apa-apa
    await requestDeletion().expect(200);
    expect(await sweep()).toBe(1);
  });

  it("akun yang tidak meminta tidak pernah diproses", async () => {
    await requestDeletion().expect(200);
    await sweep();
    expect((await user(sitiId)).status).toBe("deleted");
    expect((await rows<{ status: string }>(sql`select status from users where email_index = ${ctx.crypto.blindIndex("rina@hayatun.test")}`))[0].status).toBe("active");
  });
});

describe("penghapusan: anonimisasi (F12.2, N29)", () => {
  it("profil, alamat, nomor HP, sesi, dan token hilang; invoice dan transaksi utuh", async () => {
    const fis = await physical();
    const dig = await digital();
    await ctx.db.execute(sql`update users set phone_enc = ${ctx.crypto.encrypt("081234567890")}, totp_secret_enc = ${ctx.crypto.encrypt("SECRET")}, totp_enabled = true where id = ${sitiId}`);
    await ctx.db.execute(sql`insert into auth_tokens (user_id, type, token_hash, expires_at) values (${sitiId}, 'reset_password', 'h', now() + interval '1 hour')`);
    await admin.post(`/api/admin/shipments/${fis.orderId}/tracking`, { trackingNumber: "SCP1234567890" }).expect(200);
    await siti.post(`/api/orders/${fis.orderId}/received`).expect(200); // tidak ada penunda lagi
    const before = await rows<{ invoice_number: string; total: number; status: string }>(sql`select invoice_number, total, status from orders where user_id = ${sitiId} order by invoice_number`);
    const itemsBefore = (await rows<{ n: number }>(sql`select count(*)::int as n from order_items where order_id in (select id from orders where user_id = ${sitiId})`))[0].n;
    const oldIndex = (await user(sitiId)).email_index as string;
    await ctx.db.execute(sql`insert into login_attempts (email_index, success) values (${oldIndex}, false)`);

    await requestDeletion().expect(200);
    expect(await sweep()).toBe(1);

    const u = await user(sitiId);
    expect(u).toMatchObject({ status: "deleted", name_enc: null, phone_enc: null, password_hash: null, totp_secret_enc: null, totp_enabled: false });
    expect(u.deleted_at).not.toBeNull();
    expect(u.email_index).not.toBe(oldIndex);
    expect(JSON.stringify(u)).not.toMatch(/siti@hayatun\.test/);
    expect(ctx.crypto.decrypt(u.email_enc as string)).not.toContain("siti");
    expect((await rows(sql`select 1 from sessions where user_id = ${sitiId}`))).toHaveLength(0);
    expect((await rows(sql`select 1 from addresses where user_id = ${sitiId}`))).toHaveLength(0);
    expect((await rows(sql`select 1 from auth_tokens where user_id = ${sitiId}`))).toHaveLength(0);
    expect((await rows(sql`select 1 from login_attempts where email_index = ${oldIndex}`))).toHaveLength(0); // jejak percobaan masuk untuk email itu
    expect(await rows(sql`select ship_recipient_enc, ship_phone_enc, ship_address_enc from orders where user_id = ${sitiId} and ship_recipient_enc is not null`)).toEqual([]);
    expect(await rows(sql`select 1 from orders where user_id = ${sitiId} and ship_area_id is null and courier is not null`)).toEqual([]); // wilayah dan ekspedisi dibiarkan
    expect(await rows<{ invoice_number: string; total: number; status: string }>(sql`select invoice_number, total, status from orders where user_id = ${sitiId} order by invoice_number`)).toEqual(before);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from order_items where order_id in (select id from orders where user_id = ${sitiId})`))[0].n).toBe(itemsBefore);
    expect(dig.invoiceNumber).toBeTruthy();
  });

  it("sesi lama tidak berlaku lagi, login ditolak seperti akun tidak ada, dan email yang sama bisa mendaftar baru", async () => {
    await requestDeletion().expect(200);
    await sweep();
    await siti.get("/api/orders").expect(401);
    const gone = await request(ctx.app).post("/api/auth/login").send({ email: "siti@hayatun.test", password: PASSWORD }).expect(401);
    const unknown = await request(ctx.app).post("/api/auth/login").send({ email: "tidak-ada@hayatun.test", password: PASSWORD }).expect(401);
    expect(gone.body).toEqual(unknown.body);
    await request(ctx.app).post("/api/auth/register").send({ name: "Siti Baru", email: "siti@hayatun.test", password: PASSWORD }).expect(202);
    const fresh = await rows<{ id: string; status: string }>(sql`select id, status from users where email_index = ${ctx.crypto.blindIndex("siti@hayatun.test")}`);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(sitiId);
    expect((await ctx.emails()).filter((m) => m.to === "siti@hayatun.test" && m.subject === "Verifikasi email akun Hayatun-mu")).toHaveLength(1);
  });

  it("email konfirmasi ke alamat asli, tanpa data pribadi lain; log tanpa data pribadi", async () => {
    await digital();
    await requestDeletion().expect(200);
    await sweep();
    const [m, ...rest] = await mails("siti@hayatun.test", DELETED_SUBJECT);
    expect(rest).toEqual([]);
    expect(m.text).toContain("Siti Aminah"); // sapaan memakai nama sebelum dihapus
    expect(m.text).toContain("10 tahun");
    expect(m.text + m.html).not.toMatch(/Pajajaran|81234567890|siti@/);
    const log = await audit("account.deleted");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: null, entity_id: sitiId });
    expect(JSON.stringify(log)).not.toMatch(/Siti|siti@|Pajajaran/);
  });

  it("tepat sekali walau dijalankan bersamaan: satu log dan satu email", async () => {
    await requestDeletion().expect(200);
    const counts = await Promise.all([sweep(), sweep(), sweep()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await audit("account.deleted")).toHaveLength(1);
    expect(await mails("siti@hayatun.test", DELETED_SUBJECT)).toHaveLength(1);
    expect(await sweep()).toBe(0);
  });

  it("antrean email mati: akun tetap terhapus (F11.4)", async () => {
    await requestDeletion().expect(200);
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    expect(await sweep()).toBe(1);
    expect((await user(sitiId)).status).toBe("deleted");
  });

  it("akun yang sudah dihapus tidak bisa meminta lagi", async () => {
    await requestDeletion().expect(200);
    await sweep();
    await requestDeletion().expect(401);
  });

  it("daftar pesanan admin menampilkan nama kosong, bukan error", async () => {
    await digital();
    await requestDeletion().expect(200);
    await sweep();
    const res = (await admin.get("/api/admin/orders").expect(200)).body;
    expect(res.orders[0].buyerName).toBeNull();
  });
});

describe("pesanan yang menunda penghapusan (F12.5)", () => {
  it("Menunggu Verifikasi menunda; selesai setelah admin menerimanya", async () => {
    const o = await digital(siti, false);
    await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    const res = (await requestDeletion().expect(200)).body;
    expect(res.blockers).toEqual([{ orderId: o.orderId, invoiceNumber: o.invoiceNumber, reason: "Menunggu verifikasi" }]);
    expect(await sweep()).toBe(0);
    expect((await user(sitiId)).status).toBe("active");
    expect((await user(sitiId)).deletion_requested_at).not.toBeNull(); // permintaan tetap tercatat
    expect((await siti.get("/api/account/deletion").expect(200)).body.blockers).toHaveLength(1);
    await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200); // digital Lunas: tidak menunda lagi
    expect(await sweep()).toBe(1);
    expect((await user(sitiId)).status).toBe("deleted");
  });

  it("Menunggu Pembayaran menunda; selesai setelah pembeli membatalkannya", async () => {
    const o = await digital(siti, false);
    expect((await requestDeletion().expect(200)).body.blockers).toEqual([{ orderId: o.orderId, invoiceNumber: o.invoiceNumber, reason: "Menunggu pembayaran" }]);
    expect(await sweep()).toBe(0);
    await siti.post(`/api/orders/${o.orderId}/cancel`).expect(200);
    expect(await sweep()).toBe(1);
  });

  it("fisik Diproses dan Dikirim menunda; selesai setelah Diterima", async () => {
    const o = await physical();
    expect((await requestDeletion().expect(200)).body.blockers).toEqual([{ orderId: o.orderId, invoiceNumber: o.invoiceNumber, reason: "Pesanan fisik belum diterima" }]);
    expect(await sweep()).toBe(0);
    await admin.post(`/api/admin/shipments/${o.orderId}/tracking`, { trackingNumber: "SCP1234567890" }).expect(200);
    expect(await sweep()).toBe(0);
    await siti.post(`/api/orders/${o.orderId}/received`).expect(200);
    expect(await sweep()).toBe(1);
  });

  it("fisik yang dibatalkan admin tidak menunda lagi", async () => {
    const o = await physical();
    await requestDeletion().expect(200);
    expect(await sweep()).toBe(0);
    await admin.post(`/api/admin/orders/${o.orderId}/cancel`, { status: "DIBATALKAN", note: "uji" }).expect(200);
    expect(await sweep()).toBe(1);
  });

  it("pesanan Lunas digital, Dibatalkan, dan Kedaluwarsa tidak menunda; pesanan orang lain tidak dihitung", async () => {
    await digital(siti, true);
    const waiting = await digital(siti, false);
    await siti.post(`/api/orders/${waiting.orderId}/cancel`).expect(200);
    await digital(rina, false); // milik Rina, masih Menunggu Pembayaran
    expect((await requestDeletion().expect(200)).body.blockers).toEqual([]);
    expect(await sweep()).toBe(1);
  });

  it("pesanan yang menunda tidak ikut hilang: pesanan orang lain dan miliknya tetap ada setelah akun dihapus", async () => {
    const mine = await digital(siti, true);
    await digital(rina, true);
    await requestDeletion().expect(200);
    await sweep();
    expect((await rows(sql`select 1 from orders where invoice_number = ${mine.invoiceNumber}`))).toHaveLength(1);
    expect((await rows(sql`select 1 from orders`))).toHaveLength(2);
    expect((await rows<{ status: string }>(sql`select status from users where email_index = ${ctx.crypto.blindIndex("rina@hayatun.test")}`))[0].status).toBe("active");
  });
});
