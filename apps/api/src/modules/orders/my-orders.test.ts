import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const MIN = 60_000;
const HOUR = 3600_000;

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
  [siti, sitiId] = await buyer("siti@hayatun.test");
  [rina] = await buyer("rina@hayatun.test");
});
afterEach(() => ctx.close());

async function buyer(email: string): Promise<[ReturnType<typeof api>, string]> {
  const id = await ctx.createUser({ email, password: "rahasia-hayatun-1", name: "Siti Aminah" });
  return [api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`), id];
}
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];

async function digital(who = siti, name = "E-book Ramadan") {
  const p = await makeProduct(ctx, adminCookie, { name, price: 75000 });
  await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: p.id }).expect(201);
  return (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string; invoiceNumber: string; expiresAt: string };
}
async function physical(who = siti) {
  const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", price: 120000, stockQty: 10 });
  await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await who.post("/api/addresses", ADDRESS).expect(201)).body.id;
  return (await who.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 255000 }).expect(201)).body as { orderId: string };
}

describe("daftar pesanan saya", () => {
  it("hanya milik sendiri, terbaru dulu, dengan status tiap bagian", async () => {
    const first = await digital();
    ctx.clock.advance(10 * MIN);
    const second = await physical();
    await digital(rina, "E-book Rina");
    const res = (await siti.get("/api/orders").expect(200)).body;
    expect(res.orders.map((o: { orderId: string }) => o.orderId)).toEqual([second.orderId, first.orderId]);
    expect(res.orders[1]).toEqual({
      orderId: first.orderId, invoiceNumber: first.invoiceNumber, createdAt: expect.any(String), total: 75000,
      status: "MENUNGGU_PEMBAYARAN", digitalStatus: "MENUNGGU", physicalStatus: "TIDAK_ADA",
    });
    expect(res.orders[0]).toMatchObject({ total: 255000, digitalStatus: "TIDAK_ADA", physicalStatus: "MENUNGGU" });
    expect((await rina.get("/api/orders").expect(200)).body.orders).toHaveLength(1);
  });

  it("belum punya pesanan: daftar kosong; tanpa masuk 401; admin hanya melihat miliknya (kosong)", async () => {
    expect((await siti.get("/api/orders").expect(200)).body).toEqual({ orders: [] });
    await request(ctx.app).get("/api/orders").expect(401);
    await digital();
    expect((await admin.get("/api/orders").expect(200)).body).toEqual({ orders: [] });
  });

  it("batas bayar yang lewat tampil Kedaluwarsa walau tugas belum jalan (F4.8)", async () => {
    const o = await digital();
    ctx.clock.advance(25 * HOUR);
    const mine = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id: sitiId, role: "buyer" }, ctx.clock.now)).token}`);
    expect((await mine.get("/api/orders").expect(200)).body.orders[0]).toMatchObject({ orderId: o.orderId, status: "KEDALUWARSA" });
  });

  it("maksimal 50 pesanan terbaru", async () => {
    await ctx.db.execute(sql`insert into orders (invoice_number, user_id, status, digital_status, physical_status, subtotal, shipping_cost, total, expires_at, created_at)
      select 'INV/TEST/' || g, ${sitiId}::uuid, 'KEDALUWARSA', 'TIDAK_ADA', 'TIDAK_ADA', 1, 0, 1, now(), now() - (g || ' minutes')::interval from generate_series(1, 52) g`);
    const res = (await siti.get("/api/orders").expect(200)).body.orders;
    expect(res).toHaveLength(50);
    expect(res[0].invoiceNumber).toBe("INV/TEST/1");
    expect(res[49].invoiceNumber).toBe("INV/TEST/50");
  });
});

describe("detail pesanan", () => {
  it("pesanan digital: barang, status, tanggal, tanpa data pengiriman", async () => {
    const o = await digital();
    const res = (await siti.get(`/api/orders/${o.orderId}`).expect(200)).body;
    expect(res).toEqual({
      orderId: o.orderId, invoiceNumber: o.invoiceNumber, status: "MENUNGGU_PEMBAYARAN", digitalStatus: "MENUNGGU", physicalStatus: "TIDAK_ADA",
      subtotal: 75000, shippingCost: 0, total: 75000, createdAt: expect.any(String), paidAt: null,
      items: [{ name: "E-book Ramadan", type: "digital", qty: 1, unitPrice: 75000 }], shipping: null,
    });
  });

  it("pesanan fisik: ekspedisi dan layanan, resi kosong lalu terisi; alamat dan kontak tidak ikut", async () => {
    const o = await physical();
    let res = (await siti.get(`/api/orders/${o.orderId}`).expect(200)).body;
    expect(res.shipping).toEqual({ courier: "SiCepat", service: "REG", trackingNumber: null });
    expect(res.shippingCost).toBe(15000);
    expect(res.items).toEqual([{ name: "Nastar", type: "physical", qty: 2, unitPrice: 120000 }]);
    await ctx.db.execute(sql`update orders set tracking_number = 'SCP1234567890', physical_status = 'DIKIRIM' where id = ${o.orderId}`);
    res = (await siti.get(`/api/orders/${o.orderId}`).expect(200)).body;
    expect(res.shipping.trackingNumber).toBe("SCP1234567890");
    expect(res.physicalStatus).toBe("DIKIRIM");
    expect(JSON.stringify(res)).not.toMatch(/Pajajaran|81234567890|Budi|Santoso|Cicendo|40172/);
  });

  it("paidAt terisi setelah diterima admin", async () => {
    const o = await digital();
    await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
    const res = (await siti.get(`/api/orders/${o.orderId}`).expect(200)).body;
    expect(res).toMatchObject({ status: "LUNAS", digitalStatus: "TERKIRIM", paidAt: expect.any(String) });
  });

  it("kedaluwarsa tampil sebagai Kedaluwarsa; bukan pemilik, admin, id ngawur 404; tanpa masuk 401", async () => {
    const o = await digital();
    await rina.get(`/api/orders/${o.orderId}`).expect(404);
    await admin.get(`/api/orders/${o.orderId}`).expect(404);
    await siti.get("/api/orders/bukan-uuid").expect(404);
    await request(ctx.app).get(`/api/orders/${o.orderId}`).expect(401);
    ctx.clock.advance(25 * HOUR);
    const mine = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id: sitiId, role: "buyer" }, ctx.clock.now)).token}`);
    expect((await mine.get(`/api/orders/${o.orderId}`).expect(200)).body.status).toBe("KEDALUWARSA");
  });

  it("kolom resi ada di tabel pesanan (migrasi 0012), kosong bawaan", async () => {
    const [c] = await rows<{ is_nullable: string }>(sql`select is_nullable from information_schema.columns where table_name = 'orders' and column_name = 'tracking_number'`);
    expect(c?.is_nullable).toBe("YES");
  });
});
