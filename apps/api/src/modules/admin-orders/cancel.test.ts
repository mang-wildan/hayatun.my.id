import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { renderEmail } from "../notifications/templates.js";

const CANCELLED = "Pesananmu dibatalkan";
const REFUNDED = "Pesananmu dikembalikan";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const NOTE = "Pembeli minta batal, dana dikembalikan lewat transfer";
const SECRET_NOTE = "CATATAN-INTERNAL-RAHASIA";

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie();
  admin = api(ctx, adminCookie);
  siti = await buyer("siti@hayatun.test");
});
afterEach(() => ctx.close());

async function buyer(email: string) {
  const id = await ctx.createUser({ email, password: "rahasia-hayatun-1", name: "Siti Aminah" });
  return api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
}
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const order = async (id: string) => (await rows<{ status: string; digital_status: string; physical_status: string }>(sql`select status, digital_status, physical_status from orders where id = ${id}`))[0];
const stock = async (productId: string) => (await rows<{ stock_qty: number; stock_reserved: number; stock_sold: number; low_stock_notified: boolean }>(sql`select stock_qty, stock_reserved, stock_sold, low_stock_notified from products where id = ${productId}`))[0];
const audit = async (action: string) => rows<{ actor_id: string; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_id, details from audit_logs where action = ${action} order by id`);
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);
const cancel = (id: string, body: object = { status: "DIBATALKAN", note: NOTE }, who = admin) => who.post(`/api/admin/orders/${id}/cancel`, body);

async function pay(who: ReturnType<typeof api>, orderId: string) {
  await who.upload(`/api/orders/${orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${orderId}/accept`).expect(200);
}
// pesanan fisik Lunas: n nastar dengan stok awal `stockQty`, ongkir SiCepat REG Rp15.000
async function physical(n = 2, stockQty = 20) {
  const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", price: 120000, stockQty });
  await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
  await siti.post("/api/cart/items", { productId: f.id, qty: n }).expect(201);
  const addressId = (await siti.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const o = (await siti.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 120000 * n + 15000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await pay(siti, o.orderId);
  return { ...o, productId: f.id };
}
// produk digital dengan file; opsional berlisensi
async function digital(opts: { licenses?: string; drop?: boolean } = {}) {
  const p = await makeProduct(ctx, adminCookie, { name: "Aplikasi Kasir", price: 50000, ...(opts.licenses && { isLicensed: true }) });
  const file = (await admin.upload(`/api/admin/products/${p.id}/files?filename=aplikasi.pdf`, PDF, "application/pdf").expect(201)).body.id as string;
  if (opts.licenses) await admin.post(`/api/admin/products/${p.id}/licenses`, { codes: opts.licenses }).expect(200);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await siti.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await siti.post("/api/checkout", { expectedTotal: 50000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  if (opts.drop) await ctx.db.execute(sql`delete from license_codes where product_id = ${p.id} and status = 'reserved'`);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return { ...o, productId: p.id, file };
}

async function overlapped<T>(orderId: string, waiting: number, fire: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select id from orders where id = $1 for update", [orderId]);
    const running = fire();
    for (let i = 0; i < 150; i++) {
      const { rows: waits } = await client.query<{ n: number }>("select count(distinct pid)::int as n from pg_locks where not granted");
      if (waits[0].n >= waiting) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await client.query("commit");
    return await running;
  } finally {
    await client.end();
  }
}

describe("membatalkan dan mengembalikan (F10.1, F10.2)", () => {
  it("Dibatalkan: status, akses digital dicabut, log, dan email ke pembeli tanpa isi catatan", async () => {
    const o = await physical();
    const res = (await cancel(o.orderId, { status: "DIBATALKAN", note: SECRET_NOTE }).expect(200)).body;
    expect(res).toEqual({ status: "DIBATALKAN" });
    expect(await order(o.orderId)).toMatchObject({ status: "DIBATALKAN" });
    const log = await audit("order.cancelled");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: o.orderId, details: { note: SECRET_NOTE } });
    expect(log[0].actor_id).toBeTruthy();
    const [m, ...rest] = await mails(CANCELLED);
    expect(rest).toEqual([]);
    expect(m.to).toBe("siti@hayatun.test");
    expect(m.text).toContain(o.invoiceNumber);
    expect(m.text).toContain(`${APP_URL}/pesanan/${o.orderId}`);
    expect(m.text + m.html).not.toContain(SECRET_NOTE);
    expect(m.text + m.html).not.toMatch(/Pajajaran|81234567890|Santoso/);
    expect(await mails(REFUNDED)).toHaveLength(0);
  });

  it("Dikembalikan: status, log order.refunded, dan email Pesananmu dikembalikan", async () => {
    const o = await digital();
    expect((await cancel(o.orderId, { status: "DIKEMBALIKAN", note: NOTE }).expect(200)).body).toEqual({ status: "DIKEMBALIKAN" });
    expect(await order(o.orderId)).toMatchObject({ status: "DIKEMBALIKAN", digital_status: "DICABUT" });
    expect(await audit("order.refunded")).toHaveLength(1);
    expect(await audit("order.cancelled")).toHaveLength(0);
    expect(await mails(REFUNDED)).toHaveLength(1);
    expect(await mails(CANCELLED)).toHaveLength(0);
  });

  it("pesanan yang sudah Diterima pun bisa dibatalkan (Lunas atau lebih lanjut)", async () => {
    const o = await physical();
    await admin.post(`/api/admin/shipments/${o.orderId}/tracking`, { trackingNumber: "SCP1234567890" }).expect(200);
    await siti.post(`/api/orders/${o.orderId}/received`).expect(200);
    await cancel(o.orderId).expect(200);
    expect(await order(o.orderId)).toMatchObject({ status: "DIBATALKAN", physical_status: "DITERIMA" });
  });

  it("invoice menampilkan status Dibatalkan", async () => {
    const o = await digital();
    expect((await siti.get(`/api/invoices/${o.orderId}`).expect(200)).body.status).toBe("Lunas");
    await cancel(o.orderId, { status: "DIKEMBALIKAN", note: NOTE }).expect(200);
    expect((await siti.get(`/api/invoices/${o.orderId}`).expect(200)).body.status).toBe("Dibatalkan");
  });

  it("antrean email mati: pembatalan tetap tersimpan (F11.4)", async () => {
    const o = await digital();
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await cancel(o.orderId).expect(200);
    expect(await order(o.orderId)).toMatchObject({ status: "DIBATALKAN" });
  });
});

describe("catatan wajib (F10.4)", () => {
  it("kosong, spasi, bukan teks, atau lebih dari 500 karakter ditolak tanpa mengubah apa pun", async () => {
    const o = await physical();
    const bad: [object, string, string][] = [
      [{ status: "DIBATALKAN", note: "" }, "note", "Catatan wajib diisi."], [{ status: "DIBATALKAN", note: "   " }, "note", "Catatan wajib diisi."],
      [{ status: "DIBATALKAN" }, "note", "Catatan wajib diisi."], [{ status: "DIBATALKAN", note: 123 }, "note", "Catatan wajib diisi."],
      [{ status: "DIBATALKAN", note: "a".repeat(501) }, "note", "Catatan maksimal 500 karakter."],
      [{ status: "LUNAS", note: NOTE }, "status", "Pilih Dibatalkan atau Dikembalikan."], [{ note: NOTE }, "status", "Pilih Dibatalkan atau Dikembalikan."],
    ];
    for (const [body, field, message] of bad) {
      expect((await cancel(o.orderId, body).expect(422)).body.fields[field], JSON.stringify(body)).toBe(message);
    }
    expect(await order(o.orderId)).toMatchObject({ status: "LUNAS" });
    expect((await stock(o.productId)).stock_sold).toBe(2);
    expect(await audit("order.cancelled")).toEqual([]);
    expect(await mails(CANCELLED)).toHaveLength(0);
    await cancel(o.orderId, { status: "DIBATALKAN", note: "a".repeat(500) }).expect(200); // tepat 500 boleh
  });
});

describe("stok fisik (F10.3)", () => {
  it("fisik belum dikirim: stok kembali (jumlah naik, terjual turun, ditahan tetap)", async () => {
    const o = await physical(2, 20);
    expect(await stock(o.productId)).toMatchObject({ stock_qty: 18, stock_reserved: 0, stock_sold: 2 });
    await cancel(o.orderId).expect(200);
    expect(await stock(o.productId)).toMatchObject({ stock_qty: 20, stock_reserved: 0, stock_sold: 0 });
  });

  it("fisik sudah Dikirim atau Diterima: stok tidak otomatis kembali", async () => {
    const shipped = await physical(2, 20);
    await admin.post(`/api/admin/shipments/${shipped.orderId}/tracking`, { trackingNumber: "SCP1234567890" }).expect(200);
    await cancel(shipped.orderId).expect(200);
    expect(await stock(shipped.productId)).toMatchObject({ stock_qty: 18, stock_sold: 2 });

    const done = await physical(3, 20);
    await admin.post(`/api/admin/shipments/${done.orderId}/tracking`, { trackingNumber: "SCP1234567890" }).expect(200);
    await siti.post(`/api/orders/${done.orderId}/received`).expect(200);
    await cancel(done.orderId, { status: "DIKEMBALIKAN", note: NOTE }).expect(200);
    expect(await stock(done.productId)).toMatchObject({ stock_qty: 17, stock_sold: 3 });
  });

  it("penanda stok rendah ikut pulih saat stok kembali di atas ambang", async () => {
    const o = await physical(3, 5); // sisa 2: stok rendah dikabari saat checkout
    expect((await stock(o.productId)).low_stock_notified).toBe(true);
    await cancel(o.orderId).expect(200);
    expect(await stock(o.productId)).toMatchObject({ stock_qty: 5, low_stock_notified: false });
  });

  it("pesanan campuran: hanya bagian fisik yang mengembalikan stok, akses digital dicabut", async () => {
    const d = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
    await admin.post(`/api/admin/products/${d.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await admin.post(`/api/admin/products/${d.id}/activate`).expect(200);
    const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", price: 120000, stockQty: 10 });
    await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: d.id }).expect(201);
    await siti.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
    const addressId = (await siti.post("/api/addresses", ADDRESS).expect(201)).body.id;
    const o = (await siti.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 330000 }).expect(201)).body as { orderId: string };
    await pay(siti, o.orderId);
    await cancel(o.orderId).expect(200);
    expect(await stock(f.id)).toMatchObject({ stock_qty: 10, stock_sold: 0 });
    expect(await order(o.orderId)).toMatchObject({ status: "DIBATALKAN", digital_status: "DICABUT", physical_status: "DIPROSES" });
  });
});

describe("pencabutan akses digital (F7.8)", () => {
  it("daftar file dan tombol unduh ditolak, tautan yang masih berlaku ikut gagal", async () => {
    const o = await digital();
    const url = (await siti.post(`/api/orders/${o.orderId}/files/${o.file}/download`).expect(200)).body.url as string;
    await siti.get(url).expect(200);
    await cancel(o.orderId).expect(200);
    expect((await siti.get(`/api/orders/${o.orderId}/files`).expect(409)).body).toMatchObject({ code: "DOWNLOAD_NOT_ALLOWED" });
    await siti.post(`/api/orders/${o.orderId}/files/${o.file}/download`).expect(409);
    expect((await siti.get(url).expect(403)).body).toMatchObject({ code: "DOWNLOAD_LINK_INVALID" });
  });

  it("kode lisensi yang sudah dikirim tidak kembali ke stok", async () => {
    const o = await digital({ licenses: "KODE-1\nKODE-2" });
    await cancel(o.orderId).expect(200);
    const codes = await rows<{ status: string }>(sql`select status from license_codes where product_id = ${o.productId} order by status`);
    expect(codes.map((c) => c.status)).toEqual(["assigned", "available"]);
  });

  it("lisensi tertunda yang dibatalkan tidak ikut terkirim saat admin menambah kode", async () => {
    const o = await digital({ licenses: "KODE-1", drop: true });
    expect(await order(o.orderId)).toMatchObject({ digital_status: "LISENSI_TERTUNDA" });
    await cancel(o.orderId).expect(200);
    await admin.post(`/api/admin/products/${o.productId}/licenses`, { codes: "BARU-1" }).expect(200);
    expect(await order(o.orderId)).toMatchObject({ status: "DIBATALKAN", digital_status: "DICABUT" });
    expect((await ctx.emails()).filter((m) => m.subject === "Kode lisensimu sudah tersedia")).toHaveLength(0);
    expect((await rows<{ status: string }>(sql`select status from license_codes where product_id = ${o.productId}`)).map((c) => c.status)).toEqual(["available"]);
  });
});

describe("batas aksi", () => {
  it("hanya pesanan Lunas: menunggu, menunggu verifikasi, kedaluwarsa, dan yang sudah dibatalkan ditolak", async () => {
    const f = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
    await admin.post(`/api/admin/products/${f.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: f.id }).expect(201);
    const o = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
    expect((await cancel(o.orderId).expect(409)).body).toMatchObject({ code: "INVALID_TRANSITION" }); // menunggu pembayaran
    await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    await cancel(o.orderId).expect(409); // menunggu verifikasi
    await ctx.db.execute(sql`update orders set status = 'KEDALUWARSA' where id = ${o.orderId}`);
    await cancel(o.orderId).expect(409);
    await ctx.db.execute(sql`update orders set status = 'LUNAS' where id = ${o.orderId}`);
    await cancel(o.orderId).expect(200);
    expect((await cancel(o.orderId).expect(409)).body).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await audit("order.cancelled")).toHaveLength(1);
  });

  it("pesanan tidak ada 404; pembeli 403; tanpa masuk 401", async () => {
    await cancel("00000000-0000-0000-0000-000000000000").expect(404);
    await cancel("bukan-uuid").expect(404);
    const o = await digital();
    await cancel(o.orderId, undefined, siti).expect(403);
    await request(ctx.app).post(`/api/admin/orders/${o.orderId}/cancel`).send({ status: "DIBATALKAN", note: NOTE }).expect(401);
    expect(await order(o.orderId)).toMatchObject({ status: "LUNAS" });
  });

  it("dua admin membatalkan bersamaan: satu berhasil, satu 409; stok kembali sekali, satu log, satu email", async () => {
    const o = await physical(2, 20);
    const [x, y] = await overlapped(o.orderId, 2, () => Promise.all([cancel(o.orderId), cancel(o.orderId, { status: "DIKEMBALIKAN", note: NOTE }, api(ctx, adminCookie))]));
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await stock(o.productId)).toMatchObject({ stock_qty: 20, stock_sold: 0 });
    expect((await audit("order.cancelled")).length + (await audit("order.refunded")).length).toBe(1);
    expect((await mails(CANCELLED)).length + (await mails(REFUNDED)).length).toBe(1);
  });
});

describe("templat email pembatalan", () => {
  const link = `${APP_URL}/pesanan/abc`;
  it("subjek tetap, memuat invoice dan tautan, data wajib, tanpa emoji", () => {
    const c = renderEmail("order_cancelled", { name: "Siti", invoiceNumber: "INV/1", link });
    const r = renderEmail("order_refunded", { name: "Siti", invoiceNumber: "INV/1", link });
    expect(c.subject).toBe(CANCELLED);
    expect(r.subject).toBe(REFUNDED);
    for (const e of [c, r]) { expect(e.text).toContain("INV/1"); expect(e.html).toContain(`href="${link}"`); expect(e.text + e.html).not.toMatch(/\p{Extended_Pictographic}/u); }
    for (const t of ["order_cancelled", "order_refunded"] as const) {
      expect(() => renderEmail(t, { name: "Siti", link })).toThrow(/invoiceNumber/);
      expect(() => renderEmail(t, { name: "Siti", invoiceNumber: "INV/1" })).toThrow(/link/);
    }
  });
});
