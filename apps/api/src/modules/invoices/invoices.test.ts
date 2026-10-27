import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { nextInvoiceNumber } from "./numbering.js";

let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
let buyerCookie: string;
let b: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
  buyerCookie = await ctx.buyerCookie();
  b = api(ctx, buyerCookie);
});
afterEach(() => ctx.close());

const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const number = (at: string) => ctx.db.transaction((tx) => nextInvoiceNumber(tx, new Date(at)));

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}

// pesanan digital Rp75.000 milik pembeli `who`
async function digitalOrder(who = b, over: Record<string, unknown> = {}) {
  const d = await publish({ name: "E-book Resep Lebaran", price: 75000, ...over });
  await who.post("/api/cart/items", { productId: d.id }).expect(201);
  return { product: d, order: (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string; invoiceNumber: string } };
}

// pesanan campuran: 1 e-book Rp75.000 + 2 nastar Rp120.000 + ongkir SiCepat REG Rp15.000
async function mixedOrder() {
  const d = await publish({ name: "E-book Resep Lebaran", price: 75000 });
  const f = await publish({ ...PHYSICAL, name: "Kue Nastar", price: 120000 });
  await b.post("/api/cart/items", { productId: d.id }).expect(201);
  await b.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const order = (await b.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 330000 }).expect(201)).body;
  return { d, f, addressId, order };
}
const invoice = (orderId: string, who = b) => who.get(`/api/invoices/${orderId}`);

describe("nomor invoice berurutan per bulan (F6.1)", () => {
  it("bulan dihitung menurut WIB: 31 Okt 23.59 WIB masih Oktober, 1 Nov 00.00 WIB sudah November", async () => {
    expect(await number("2026-10-31T16:59:59Z")).toBe("INV/2026/10/0001");
    expect(await number("2026-10-31T17:00:00Z")).toBe("INV/2026/11/0001");
    expect(await number("2026-10-15T03:00:00Z")).toBe("INV/2026/10/0002"); // tiap bulan punya urutannya sendiri
    expect(await number("2026-11-02T03:00:00Z")).toBe("INV/2026/11/0002");
  });

  it("pergantian tahun", async () => {
    expect(await number("2026-12-31T16:59:59Z")).toBe("INV/2026/12/0001");
    expect(await number("2026-12-31T17:00:00Z")).toBe("INV/2027/01/0001");
  });

  it("lewat 9999 nomornya memanjang, tidak berputar ulang", async () => {
    await ctx.db.execute(sql`insert into invoice_counters (period, last_number) values ('202610', 9999)`);
    expect(await number("2026-10-26T07:00:00Z")).toBe("INV/2026/10/10000");
  });

  it("sepuluh pengambilan bersamaan: semua unik dan tanpa celah", async () => {
    const got = await Promise.all(Array.from({ length: 10 }, () => number("2026-10-26T07:00:00Z")));
    expect(got.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `INV/2026/10/${String(i + 1).padStart(4, "0")}`));
  });

  it("transaksi yang batal tidak meninggalkan celah (nomornya tidak pernah dipakai pesanan mana pun)", async () => {
    await expect(ctx.db.transaction(async (tx) => { await nextInvoiceNumber(tx, new Date("2026-10-26T07:00:00Z")); throw new Error("batal"); })).rejects.toThrow("batal");
    expect(await number("2026-10-26T07:00:00Z")).toBe("INV/2026/10/0001");
  });

  it("nomor pesanan yang dibatalkan tidak dipakai ulang", async () => {
    const first = (await digitalOrder()).order;
    await ctx.db.execute(sql`update orders set status = 'DIBATALKAN' where id = ${first.orderId}`);
    const other = api(ctx, await ctx.buyerCookie());
    expect((await digitalOrder(other)).order.invoiceNumber).toBe("INV/2026/10/0002");
  });
});

describe("isi invoice (F6.2, F6.3)", () => {
  it("pesanan campuran: semua bagian F6.2, alamat dari salinan pesanan", async () => {
    const { order } = await mixedOrder();
    const res = await invoice(order.orderId).expect(200);
    expect(res.body).toEqual({
      number: "INV/2026/10/0001",
      issuedAt: ctx.clock.now.toISOString(),
      store: { name: "Hayatun", email: "toko@hayatun.my.id" },
      buyer: { name: expect.any(String), email: expect.stringMatching(/@hayatun\.test$/) },
      shippingAddress: { recipient: "Budi Santoso", phone: "+6281234567890", address: ADDRESS.address, postalCode: "40172", courier: "SiCepat", service: "REG" },
      items: [
        { name: "E-book Resep Lebaran", qty: 1, unitPrice: 75000, subtotal: 75000 },
        { name: "Kue Nastar", qty: 2, unitPrice: 120000, subtotal: 240000 },
      ],
      subtotal: 315000,
      shippingCost: 15000,
      total: 330000,
      paymentMethod: "Transfer bank",
      status: "Belum Lunas",
      paidAt: null,
    });
  });

  it("pesanan digital: tanpa alamat kirim", async () => {
    const { order } = await digitalOrder();
    expect((await invoice(order.orderId).expect(200)).body).toMatchObject({ shippingAddress: null, shippingCost: 0, total: 75000 });
  });

  it("tanpa PPN dan tanpa label faktur pajak (F6.3)", async () => {
    const { order } = await mixedOrder();
    expect(JSON.stringify((await invoice(order.orderId).expect(200)).body)).not.toMatch(/ppn|pajak|tax|faktur/i);
  });

  it.each([
    ["MENUNGGU_PEMBAYARAN", "Belum Lunas"],
    ["MENUNGGU_VERIFIKASI", "Belum Lunas"],
    ["LUNAS", "Lunas"],
    ["KEDALUWARSA", "Dibatalkan"],
    ["DIBATALKAN", "Dibatalkan"],
    ["DIKEMBALIKAN", "Dibatalkan"],
  ])("status pesanan %s → invoice %s", async (status, label) => {
    const { order } = await digitalOrder();
    await ctx.db.execute(sql`update orders set status = ${status} where id = ${order.orderId}`);
    expect((await invoice(order.orderId).expect(200)).body.status).toBe(label);
  });

  it("nama dan kontak toko dari pengaturan toko bila sudah diisi", async () => {
    await ctx.db.execute(sql`insert into store_settings (key, value) values ('store', ${JSON.stringify({ name: "Toko Hayatun", email: "halo@hayatun.my.id", phone: "+6281111111111" })}::jsonb)`);
    const { order } = await digitalOrder();
    expect((await invoice(order.orderId).expect(200)).body.store).toEqual({ name: "Toko Hayatun", email: "halo@hayatun.my.id", phone: "+6281111111111" });
  });
});

describe("isi invoice tidak berubah (F6.5)", () => {
  it("nama atau harga produk diubah, alamat pembeli diubah atau dihapus: invoice tetap", async () => {
    const { d, f, addressId, order } = await mixedOrder();
    const before = (await invoice(order.orderId).expect(200)).body;
    await a.patch(`/api/admin/products/${d.id}`, { name: "Nama Baru", price: 1000 }).expect(200);
    await a.patch(`/api/admin/products/${f.id}`, { price: 1 }).expect(200);
    await b.patch(`/api/addresses/${addressId}`, { recipient: "Orang Lain", postalCode: "40111" }).expect(200);
    await b.del(`/api/addresses/${addressId}`).expect(204);
    expect((await invoice(order.orderId).expect(200)).body).toEqual(before);
  });
});

describe("akses hanya pemilik atau admin (F6.6)", () => {
  it("pemilik bisa membuka; tidak tercatat di log aktivitas", async () => {
    const { order } = await digitalOrder();
    await invoice(order.orderId).expect(200);
    expect(await rows(sql`select id from audit_logs where action = 'invoice.viewed'`)).toEqual([]);
  });

  it("admin bisa membuka, dan pembukaannya dicatat karena memuat data pribadi (F15.3)", async () => {
    const { order } = await digitalOrder();
    await invoice(order.orderId, a).expect(200);
    const log = await rows<{ entity_type: string; entity_id: string; details: object }>(sql`select entity_type, entity_id, details from audit_logs where action = 'invoice.viewed'`);
    expect(log).toEqual([{ entity_type: "order", entity_id: order.orderId, details: {} }]);
  });

  it("pembeli lain: jawaban sama persis dengan invoice yang tidak ada", async () => {
    const { order } = await digitalOrder();
    const other = api(ctx, await ctx.buyerCookie());
    const mine = await invoice(order.orderId, other).expect(404);
    const missing = await invoice("00000000-0000-0000-0000-000000000000", other).expect(404);
    const junk = await invoice("ngawur", other).expect(404);
    expect(mine.body).toEqual({ code: "INVOICE_NOT_FOUND", message: "Invoice tidak ditemukan." });
    expect(missing.body).toEqual(mine.body);
    expect(junk.body).toEqual(mine.body);
  });

  it("tanpa login: 401", async () => {
    const { order } = await digitalOrder();
    expect((await request(ctx.app).get(`/api/invoices/${order.orderId}`)).status).toBe(401);
  });
});
