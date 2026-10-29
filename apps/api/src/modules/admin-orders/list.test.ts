import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
let sitiId: string;
let rinaId: string;
let digitalId: string;
let physicalId: string;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie();
  admin = api(ctx, adminCookie);
  sitiId = await ctx.createUser({ email: "siti@hayatun.test", password: "rahasia-hayatun-1", name: "Siti Aminah" });
  rinaId = await ctx.createUser({ email: "rina@hayatun.test", password: "rahasia-hayatun-1", name: "Rina Marlina" });
  siti = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id: sitiId, role: "buyer" }, ctx.clock.now)).token}`);
  digitalId = (await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 })).id;
  physicalId = (await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", stockQty: 50 })).id;
});
afterEach(() => ctx.close());

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const list = (qs = "", who = admin) => who.get(`/api/admin/orders${qs}`);
const invoices = (res: { body: { orders: { invoiceNumber: string }[] } }) => res.body.orders.map((o) => o.invoiceNumber);

interface Seed { invoice: string; user?: string; status?: string; createdAt?: string; paidAt?: string | null; subtotal?: number; shipping?: number; items?: ("digital" | "physical")[] }
// pesanan langsung di database, supaya tanggal dan status bisa diatur bebas
async function seed(s: Seed) {
  const subtotal = s.subtotal ?? 75000;
  const shipping = s.shipping ?? 0;
  const status = s.status ?? "LUNAS";
  const [o] = await rows<{ id: string }>(sql`insert into orders (invoice_number, user_id, status, digital_status, physical_status, subtotal, shipping_cost, total, expires_at, created_at, paid_at)
    values (${s.invoice}, ${s.user ?? sitiId}, ${status}, 'TIDAK_ADA', 'TIDAK_ADA', ${subtotal}, ${shipping}, ${subtotal + shipping}, now(), ${s.createdAt ?? ctx.clock.now.toISOString()}, ${s.paidAt === undefined ? (status === "LUNAS" ? (s.createdAt ?? ctx.clock.now.toISOString()) : null) : s.paidAt}) returning id`);
  for (const type of s.items ?? ["digital"]) {
    await ctx.db.execute(sql`insert into order_items (order_id, product_id, product_type, name_snapshot, unit_price, qty) values (${o.id}, ${type === "digital" ? digitalId : physicalId}, ${type}, ${type}, 1000, 1)`);
  }
  return o.id;
}

describe("daftar pesanan admin (F13.1)", () => {
  it("terbaru dulu, dengan nama pembeli dan status; tanpa email, telepon, atau alamat", async () => {
    const old = await seed({ invoice: "INV/2026/10/0001", createdAt: "2026-10-01T03:00:00Z" });
    const mid = await seed({ invoice: "INV/2026/10/0002", user: rinaId, status: "MENUNGGU_PEMBAYARAN", createdAt: "2026-10-10T03:00:00Z" });
    const res = (await list().expect(200)).body;
    expect(res.orders.map((o: { orderId: string }) => o.orderId)).toEqual([mid, old]);
    expect(res.orders[0]).toEqual({
      orderId: mid, invoiceNumber: "INV/2026/10/0002", createdAt: expect.any(String), buyerName: "Rina Marlina", total: 75000,
      status: "MENUNGGU_PEMBAYARAN", digitalStatus: "TIDAK_ADA", physicalStatus: "TIDAK_ADA",
    });
    expect(res).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(JSON.stringify(res)).not.toMatch(/@hayatun\.test|81234567890|Pajajaran/);
  });

  it("25 per halaman; halaman berikutnya dan di luar jangkauan", async () => {
    for (let i = 1; i <= 30; i++) await seed({ invoice: `INV/2026/10/${String(i).padStart(4, "0")}`, createdAt: `2026-10-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z` });
    const p1 = (await list().expect(200)).body;
    const p2 = (await list("?page=2").expect(200)).body;
    const p3 = (await list("?page=3").expect(200)).body;
    expect(p1.orders).toHaveLength(25);
    expect(p2.orders).toHaveLength(5);
    expect(p3.orders).toEqual([]);
    expect(p1.total).toBe(30);
    expect(p1.orders[0].invoiceNumber).toBe("INV/2026/10/0030"); // terbaru dulu
    expect(p2.orders[4].invoiceNumber).toBe("INV/2026/10/0001");
    expect(new Set([...p1.orders, ...p2.orders].map((o: { orderId: string }) => o.orderId)).size).toBe(30); // tanpa tumpang tindih
  });

  it("filter status", async () => {
    await seed({ invoice: "INV/2026/10/0001", status: "LUNAS" });
    await seed({ invoice: "INV/2026/10/0002", status: "KEDALUWARSA" });
    await seed({ invoice: "INV/2026/10/0003", status: "DIBATALKAN" });
    expect(invoices(await list("?status=KEDALUWARSA").expect(200))).toEqual(["INV/2026/10/0002"]);
    expect((await list("?status=LUNAS").expect(200)).body.total).toBe(1);
    expect(invoices(await list("?status=DIKEMBALIKAN").expect(200))).toEqual([]);
  });

  it("filter jenis produk: campuran muncul di Digital dan Fisik", async () => {
    await seed({ invoice: "INV/2026/10/0001", items: ["digital"] });
    await seed({ invoice: "INV/2026/10/0002", items: ["physical"] });
    await seed({ invoice: "INV/2026/10/0003", items: ["digital", "physical"] });
    expect(invoices(await list("?type=digital").expect(200)).sort()).toEqual(["INV/2026/10/0001", "INV/2026/10/0003"]);
    expect(invoices(await list("?type=fisik").expect(200)).sort()).toEqual(["INV/2026/10/0002", "INV/2026/10/0003"]);
    expect((await list("?type=fisik").expect(200)).body.total).toBe(2); // total tidak berlipat oleh gabungan barang
  });

  it("cari nomor invoice: sebagian, tanpa membedakan huruf besar-kecil, dan karakter pola dibaca apa adanya", async () => {
    await seed({ invoice: "INV/2026/10/0007" });
    await seed({ invoice: "INV/2026/10/0008" });
    expect(invoices(await list("?q=0007").expect(200))).toEqual(["INV/2026/10/0007"]);
    expect(invoices(await list(`?q=${encodeURIComponent("inv/2026/10/000")}`).expect(200))).toHaveLength(2);
    expect(invoices(await list(`?q=${encodeURIComponent("%")}`).expect(200))).toEqual([]);
    expect(invoices(await list(`?q=${encodeURIComponent("_")}`).expect(200))).toEqual([]);
    expect(invoices(await list("?q=tidak-ada").expect(200))).toEqual([]);
    expect((await list("?q=").expect(200)).body.total).toBe(2); // kosong = tanpa filter
  });

  it("rentang tanggal memakai hari WIB, kedua ujung termasuk", async () => {
    await seed({ invoice: "INV/A", createdAt: "2026-10-25T16:59:59Z" }); // 25 Okt 23.59 WIB
    await seed({ invoice: "INV/B", createdAt: "2026-10-25T17:00:00Z" }); // 26 Okt 00.00 WIB
    await seed({ invoice: "INV/C", createdAt: "2026-10-26T16:59:59Z" }); // 26 Okt 23.59 WIB
    await seed({ invoice: "INV/D", createdAt: "2026-10-26T17:00:00Z" }); // 27 Okt 00.00 WIB
    expect(invoices(await list("?from=2026-10-26&to=2026-10-26").expect(200)).sort()).toEqual(["INV/B", "INV/C"]);
    expect(invoices(await list("?from=2026-10-27").expect(200))).toEqual(["INV/D"]);
    expect(invoices(await list("?to=2026-10-25").expect(200))).toEqual(["INV/A"]);
  });

  it("filter digabung", async () => {
    await seed({ invoice: "INV/2026/10/0001", status: "LUNAS", items: ["digital"], createdAt: "2026-10-05T03:00:00Z" });
    await seed({ invoice: "INV/2026/10/0002", status: "LUNAS", items: ["physical"], createdAt: "2026-10-05T03:00:00Z" });
    await seed({ invoice: "INV/2026/10/0003", status: "KEDALUWARSA", items: ["digital"], createdAt: "2026-10-05T03:00:00Z" });
    await seed({ invoice: "INV/2026/10/0004", status: "LUNAS", items: ["digital"], createdAt: "2026-09-05T03:00:00Z" });
    expect(invoices(await list("?status=LUNAS&type=digital&from=2026-10-01&to=2026-10-31&q=0001").expect(200))).toEqual(["INV/2026/10/0001"]);
    expect(invoices(await list("?status=LUNAS&type=digital&from=2026-10-01").expect(200))).toEqual(["INV/2026/10/0001"]);
  });

  it("nilai filter yang tidak sah ditolak 422 dengan pesan per kolom, bukan diabaikan", async () => {
    const bad: [string, string, string][] = [
      ["?status=SELESAI", "status", "Status tidak dikenal."], ["?type=semua", "type", "Jenis produk tidak dikenal."],
      ["?from=26-10-2026", "from", "Tanggal dari tidak valid."], ["?from=2026-02-30", "from", "Tanggal dari tidak valid."],
      ["?to=kemarin", "to", "Tanggal sampai tidak valid."], ["?page=0", "page", "Halaman tidak valid."], ["?page=abc", "page", "Halaman tidak valid."],
    ];
    for (const [qs, field, message] of bad) expect((await list(qs).expect(422)).body.fields[field], qs).toBe(message);
  });

  it("hanya admin: pembeli 403, tanpa masuk 401", async () => {
    await list("", siti).expect(403);
    await siti.get("/api/admin/orders/summary").expect(403);
    await request(ctx.app).get("/api/admin/orders").expect(401);
    await request(ctx.app).get("/api/admin/orders/summary").expect(401);
  });
});

describe("ringkasan penjualan bulanan (F13.2)", () => {
  it("jumlah pesanan dan nilai produk, ongkir, dan total per bulan WIB dari tanggal dibayar, terbaru dulu", async () => {
    await seed({ invoice: "INV/1", paidAt: "2026-10-05T03:00:00Z", subtotal: 75000 });
    await seed({ invoice: "INV/2", paidAt: "2026-10-20T03:00:00Z", subtotal: 240000, shipping: 15000, items: ["physical"] });
    await seed({ invoice: "INV/3", paidAt: "2026-09-10T03:00:00Z", subtotal: 50000 });
    const res = (await admin.get("/api/admin/orders/summary").expect(200)).body;
    expect(res.months).toEqual([
      { month: "2026-10", orders: 2, products: 315000, shipping: 15000, total: 330000 },
      { month: "2026-09", orders: 1, products: 50000, shipping: 0, total: 50000 },
    ]);
  });

  it("bulan memakai hari WIB: dibayar 31 Okt 17.00 UTC masuk November, dan dibuat bulan lain tidak berpengaruh", async () => {
    await seed({ invoice: "INV/1", createdAt: "2026-10-31T10:00:00Z", paidAt: "2026-10-31T16:59:59Z" });
    await seed({ invoice: "INV/2", createdAt: "2026-10-31T10:00:00Z", paidAt: "2026-10-31T17:00:00Z" });
    const months = (await admin.get("/api/admin/orders/summary").expect(200)).body.months;
    expect(months.map((m: { month: string; orders: number }) => [m.month, m.orders])).toEqual([["2026-11", 1], ["2026-10", 1]]);
  });

  it("hanya status Lunas yang dihitung", async () => {
    await seed({ invoice: "INV/1", status: "LUNAS" });
    for (const [i, status] of ["MENUNGGU_PEMBAYARAN", "MENUNGGU_VERIFIKASI", "KEDALUWARSA", "DIBATALKAN", "DIKEMBALIKAN"].entries()) await seed({ invoice: `INV/X${i}`, status, paidAt: status.startsWith("MENUNGGU") || status === "KEDALUWARSA" ? null : ctx.clock.now.toISOString() });
    const months = (await admin.get("/api/admin/orders/summary").expect(200)).body.months;
    expect(months).toHaveLength(1);
    expect(months[0].orders).toBe(1);
  });

  it("pesanan yang dibatalkan admin keluar dari ringkasan", async () => {
    const p = await makeProduct(ctx, adminCookie, { name: "Aplikasi", price: 50000 });
    await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: p.id }).expect(201);
    const o = (await siti.post("/api/checkout", { expectedTotal: 50000 }).expect(201)).body as { orderId: string };
    await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
    expect((await admin.get("/api/admin/orders/summary").expect(200)).body.months[0]).toMatchObject({ orders: 1, total: 50000 });
    await admin.post(`/api/admin/orders/${o.orderId}/cancel`, { status: "DIBATALKAN", note: "uji" }).expect(200);
    expect((await admin.get("/api/admin/orders/summary").expect(200)).body).toEqual({ months: [] });
  });

  it("tanpa penjualan: kosong; maksimal 24 bulan terbaru", async () => {
    expect((await admin.get("/api/admin/orders/summary").expect(200)).body).toEqual({ months: [] });
    for (let i = 0; i < 26; i++) {
      const d = new Date(Date.UTC(2024, i, 15, 3));
      await seed({ invoice: `INV/${i}`, createdAt: d.toISOString(), paidAt: d.toISOString() });
    }
    const months = (await admin.get("/api/admin/orders/summary").expect(200)).body.months;
    expect(months).toHaveLength(24);
    expect(months[0].month).toBe("2026-02");
    expect(months[23].month).toBe("2024-03");
  });

  it("alamat pembeli tidak ikut di ringkasan, dan data dari alur nyata (fisik) dihitung dengan ongkir", async () => {
    const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Kastengel", price: 120000, stockQty: 10 });
    await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
    const addressId = (await siti.post("/api/addresses", ADDRESS).expect(201)).body.id;
    const o = (await siti.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 255000 }).expect(201)).body as { orderId: string };
    await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
    await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
    const res = (await admin.get("/api/admin/orders/summary").expect(200)).body;
    expect(res.months[0]).toMatchObject({ orders: 1, products: 240000, shipping: 15000, total: 255000 });
    expect(JSON.stringify(res)).not.toMatch(/Pajajaran|81234567890/);
  });
});
