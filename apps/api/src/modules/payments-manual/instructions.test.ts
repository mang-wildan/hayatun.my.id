import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
let b: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
  b = api(ctx, await ctx.buyerCookie());
});
afterEach(() => ctx.close());

const DAY = 24 * 3600_000;
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const setting = (key: string, value: object) => ctx.db.execute(sql`insert into store_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb) on conflict (key) do update set value = excluded.value`);
const setStatus = (id: string, status: string) => ctx.db.execute(sql`update orders set status = ${status} where id = ${id}`);

async function order(who = b, price = 75000) {
  const d = await makeProduct(ctx, admin, { name: "E-book", price });
  await a.post(`/api/admin/products/${d.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${d.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: d.id }).expect(201);
  return (await who.post("/api/checkout", { expectedTotal: price }).expect(201)).body as { orderId: string; invoiceNumber: string; expiresAt: string };
}
const payment = (id: string, who = b) => who.get(`/api/orders/${id}/payment`);

describe("instruksi bayar (F4.1, F4.2)", () => {
  it("memuat total, nomor invoice, batas waktu 24 jam sejak checkout, dan rekening tujuan", async () => {
    await setting("bankAccount", BANK);
    const o = await order(b, 75000);
    const res = await payment(o.orderId).expect(200);
    expect(res.body).toEqual({
      orderId: o.orderId,
      invoiceNumber: o.invoiceNumber,
      status: "MENUNGGU_PEMBAYARAN",
      total: 75000,
      expiresAt: new Date(ctx.clock.now.getTime() + DAY).toISOString(),
      expired: false,
      canUploadProof: true,
      bankAccount: BANK,
      store: { name: "Hayatun", email: "toko@hayatun.my.id" },
    });
  });

  it("total yang harus ditransfer mengikuti total pesanan, bukan harga produk saat ini (F9.8)", async () => {
    await setting("bankAccount", BANK);
    const o = await order(b, 75000);
    const [item] = (await ctx.db.execute(sql`select product_id from order_items where order_id = ${o.orderId}`)).rows as { product_id: string }[];
    await a.patch(`/api/admin/products/${item.product_id}`, { price: 99000 }).expect(200);
    expect((await payment(o.orderId).expect(200)).body.total).toBe(75000);
  });

  it("kontak toko dari pengaturan toko bila sudah diisi", async () => {
    await setting("store", { name: "Toko Hayatun", email: "halo@hayatun.my.id", phone: "+6281111111111" });
    const o = await order();
    expect((await payment(o.orderId).expect(200)).body.store).toEqual({ name: "Toko Hayatun", email: "halo@hayatun.my.id", phone: "+6281111111111" });
  });
});

describe("rekening belum diatur: tidak ada rekening karangan", () => {
  it("bankAccount null, pembeli masih bisa membuka halaman dan punya kontak toko untuk bertanya", async () => {
    const o = await order();
    const res = await payment(o.orderId).expect(200);
    expect(res.body.bankAccount).toBeNull();
    expect(res.body.store.email).toBeTruthy();
    expect(res.body.canUploadProof).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/\d{8,}/); // tidak ada nomor rekening apa pun
  });

  it.each([{}, { bank: "BCA" }, { bank: "BCA", number: "123" }, { bank: "", number: "123", holder: "X" }, "bukan objek"])("isian setengah jadi %j dianggap belum diatur", async (value) => {
    await ctx.db.execute(sql`insert into store_settings (key, value) values ('bankAccount', ${JSON.stringify(value)}::jsonb)`);
    expect((await payment((await order()).orderId).expect(200)).body.bankAccount).toBeNull();
  });

  it("rekening tidak ikut muncul di invoice", async () => {
    await setting("bankAccount", BANK);
    const o = await order();
    expect(JSON.stringify((await b.get(`/api/invoices/${o.orderId}`).expect(200)).body)).not.toContain(BANK.number);
  });
});

describe("batas waktu unggah bukti (F4.2)", () => {
  it("tepat sebelum 24 jam masih boleh; tepat 24 jam sudah lewat", async () => {
    await setting("bankAccount", BANK);
    const o = await order();
    ctx.clock.advance(DAY - 1);
    expect((await payment(o.orderId).expect(200)).body).toMatchObject({ expired: false, canUploadProof: true });
    ctx.clock.advance(1);
    expect((await payment(o.orderId).expect(200)).body).toMatchObject({ expired: true, canUploadProof: false });
  });

  it("batas yang sudah lewat tidak mengubah status di sini (kedaluwarsa otomatis ada di T34)", async () => {
    const o = await order();
    ctx.clock.advance(2 * DAY);
    expect((await payment(o.orderId).expect(200)).body.status).toBe("MENUNGGU_PEMBAYARAN");
  });
});

describe("boleh unggah bukti hanya pada status yang tepat", () => {
  it.each([
    ["MENUNGGU_PEMBAYARAN", true],
    ["MENUNGGU_VERIFIKASI", false],
    ["LUNAS", false],
    ["KEDALUWARSA", false],
    ["DIBATALKAN", false],
    ["DIKEMBALIKAN", false],
  ])("%s → canUploadProof %s", async (status, can) => {
    const o = await order();
    await setStatus(o.orderId, status);
    const res = (await payment(o.orderId).expect(200)).body;
    expect(res.status).toBe(status);
    expect(res.canUploadProof).toBe(can);
  });
});

describe("akses", () => {
  it("tanpa login: 401", async () => {
    const o = await order();
    const res = await request(ctx.app).get(`/api/orders/${o.orderId}/payment`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("pembeli lain, id tidak ada, dan id ngawur: jawaban sama persis", async () => {
    const o = await order();
    const other = api(ctx, await ctx.buyerCookie());
    const mine = await payment(o.orderId, other).expect(404);
    expect(mine.body).toEqual({ code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." });
    expect((await payment("00000000-0000-0000-0000-000000000000", other).expect(404)).body).toEqual(mine.body);
    expect((await payment("ngawur", other).expect(404)).body).toEqual(mine.body);
  });

  it("admin boleh melihat", async () => {
    const o = await order();
    await payment(o.orderId, a).expect(200);
  });
});
