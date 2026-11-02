import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, PNG, api, makeProduct } from "../../test/products.js";

// T64 (F14.1, N26, N31, N36): pembeli memilih bayar online saat checkout dan diarahkan ke gateway dengan nominal sama dengan total invoice.
// Gateway ditiru (createFakeGateway). Webhook dan status Lunas adalah T65, bukan di sini.
let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
let b: ReturnType<typeof api>;
async function setup(env: Record<string, string> = {}) {
  ctx = await createTestContext({ env });
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
  b = api(ctx, await ctx.buyerCookie());
}
afterEach(() => ctx.close());

const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const setting = (key: string, value: object) => ctx.db.execute(sql`insert into store_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb) on conflict (key) do update set value = excluded.value`);

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
const digitalCart = async (price = 75000, who = b) => { const p = await publish({ price }); await who.post("/api/cart/items", { productId: p.id }).expect(201); return p; };
const checkout = (body: object, who = b) => who.post("/api/checkout", body);
const gatewayCheckout = async (price = 75000, who = b) => { await digitalCart(price, who); return checkout({ expectedTotal: price, paymentMethod: "gateway" }, who); };
const payLink = (id: string, who = b) => who.post(`/api/orders/${id}/payment/gateway`);
const orderRow = async (id: string) => (await rows<{ payment_method: string; status: string; gateway_reference: string | null; gateway_url: string | null; total: number; expires_at: Date }>(sql`select payment_method, status, gateway_reference, gateway_url, total, expires_at from orders where id = ${id}`))[0];

describe("pilihan bayar di checkout (F14.1)", () => {
  it("rincian (quote) menyebut cara bayar yang tersedia: manual dan gateway bila penyedia aktif", async () => {
    await setup();
    await digitalCart();
    expect((await b.post("/api/checkout/quote", {}).expect(200)).body.paymentMethods).toEqual(["manual", "gateway"]);
  });

  it("penyedia 'none' (bawaan produksi): hanya manual, dan memilih gateway ditolak 422 tanpa pesanan dan tanpa memanggil gateway", async () => {
    await setup({ PAYMENT_GATEWAY_PROVIDER: "none" });
    await digitalCart();
    expect((await b.post("/api/checkout/quote", {}).expect(200)).body.paymentMethods).toEqual(["manual"]);
    const res = await checkout({ expectedTotal: 75000, paymentMethod: "gateway" }).expect(422);
    expect(res.body).toMatchObject({ code: "VALIDATION", fields: { paymentMethod: expect.any(String) } });
    expect(await rows(sql`select id from orders`)).toEqual([]);
    expect(ctx.gateway.requests).toEqual([]);
    expect(await rows(sql`select 1 from cart_items`)).toHaveLength(1); // keranjang utuh
  });

  it("tanpa paymentMethod = manual: tidak menyentuh gateway dan tidak ada tautan", async () => {
    await setup();
    await digitalCart();
    const res = await checkout({ expectedTotal: 75000 }).expect(201);
    expect(res.body).toMatchObject({ paymentMethod: "manual", paymentUrl: null });
    expect(ctx.gateway.requests).toEqual([]);
    expect(await orderRow(res.body.orderId)).toMatchObject({ payment_method: "manual", gateway_reference: null, gateway_url: null });
  });

  it("nilai paymentMethod lain ditolak 422", async () => {
    await setup();
    await digitalCart();
    await checkout({ expectedTotal: 75000, paymentMethod: "bitcoin" }).expect(422);
    expect(await rows(sql`select id from orders`)).toEqual([]);
  });

  it("gateway: pesanan dibuat, pembeli mendapat tautan, referensi dan tautan tersimpan, gateway dipanggil sekali", async () => {
    await setup();
    const res = await gatewayCheckout();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ paymentMethod: "gateway", paymentUrl: expect.stringMatching(/^https:\/\/gateway\.fake\.test\/pay\//) });
    const o = await orderRow(res.body.orderId);
    expect(o).toMatchObject({ payment_method: "gateway", status: "MENUNGGU_PEMBAYARAN", gateway_url: res.body.paymentUrl, gateway_reference: expect.any(String) });
    expect(ctx.gateway.requests).toHaveLength(1);
  });

  it("nominal ke gateway = total invoice (termasuk ongkir), dari database; kiriman amount dari klien diabaikan", async () => {
    await setup();
    const p = await publish({ ...PHYSICAL, price: 120000 });
    await b.post("/api/cart/items", { productId: p.id }).expect(201);
    const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
    const q = (await b.post("/api/checkout/quote", { addressId, courier: "SiCepat", service: "REG" }).expect(200)).body;
    expect(q.total).toBe(135000);
    const res = await checkout({ addressId, courier: "SiCepat", service: "REG", expectedTotal: q.total, paymentMethod: "gateway", amount: 1, total: 1 }).expect(201);
    expect(ctx.gateway.requests[0].amount).toBe(135000);
    expect((await orderRow(res.body.orderId)).total).toBe(135000);
    expect(Number.isInteger(ctx.gateway.requests[0].amount)).toBe(true);
  });

  it("hanya data minimum ke gateway (N31): id pesanan, nomor invoice, nominal, batas waktu, tautan kembali; tanpa nama, HP, alamat, atau email", async () => {
    await setup();
    const p = await publish({ ...PHYSICAL, price: 120000 });
    await b.post("/api/cart/items", { productId: p.id }).expect(201);
    const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
    const q = (await b.post("/api/checkout/quote", { addressId, courier: "SiCepat", service: "REG" }).expect(200)).body;
    const res = await checkout({ addressId, courier: "SiCepat", service: "REG", expectedTotal: q.total, paymentMethod: "gateway" }).expect(201);
    const req = ctx.gateway.requests[0];
    expect(Object.keys(req).sort()).toEqual(["amount", "expiresAt", "invoiceNumber", "orderId", "returnUrl"]);
    expect(req).toMatchObject({ orderId: res.body.orderId, invoiceNumber: res.body.invoiceNumber, returnUrl: `${APP_URL}/pesanan/${res.body.orderId}` });
    expect(new Date(req.expiresAt).getTime()).toBe((await orderRow(res.body.orderId)).expires_at.getTime());
    const sent = JSON.stringify(req);
    for (const secret of [ADDRESS.recipient, ADDRESS.phone, "Pajajaran", "@hayatun.test"]) expect(sent).not.toContain(secret);
  });

  it("total berubah (TOTAL_CHANGED): 409, tidak ada pesanan, gateway tidak dipanggil", async () => {
    await setup();
    await digitalCart(75000);
    await checkout({ expectedTotal: 1, paymentMethod: "gateway" }).expect(409);
    expect(await rows(sql`select id from orders`)).toEqual([]);
    expect(ctx.gateway.requests).toEqual([]);
  });
});

describe("gateway gagal: pesanan tetap ada, bisa dicoba lagi", () => {
  const failedOrder = async () => {
    await digitalCart(75000);
    const res = await checkout({ expectedTotal: 75000, paymentMethod: "gateway" }).expect(201);
    return res.body as { orderId: string; paymentUrl: string | null };
  };

  it("gateway error: 201, paymentUrl null, pesanan MENUNGGU_PEMBAYARAN, keranjang terpakai, tanpa tautan tersimpan", async () => {
    await setup();
    ctx.gateway.error = new Error("503 dari gateway");
    const { orderId, paymentUrl } = await failedOrder();
    expect(paymentUrl).toBeNull();
    expect(await orderRow(orderId)).toMatchObject({ status: "MENUNGGU_PEMBAYARAN", payment_method: "gateway", gateway_reference: null, gateway_url: null });
    expect(await rows(sql`select 1 from cart_items`)).toEqual([]);
  });

  it("gateway lambat dan mengabaikan batal: dipotong tepat waktu (5 detik bawaan, di sini 50 ms), checkout tetap 201", async () => {
    await setup({ PAYMENT_GATEWAY_TIMEOUT_MS: "50" });
    ctx.gateway.delayMs = 3000; ctx.gateway.ignoreAbort = true;
    const t0 = Date.now();
    const { paymentUrl } = await failedOrder();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(paymentUrl).toBeNull();
    expect(ctx.gateway.lastSignal?.aborted).toBe(true);
  });

  it.each(["http://gateway.fake.test/pay/1", "javascript:alert(1)", "//evil.test/pay", "/pay/relatif", "bukan url", ""])("tautan dari gateway yang tidak sah (%j) dianggap gagal dan tidak disimpan", async (bad) => {
    await setup();
    ctx.gateway.paymentUrl = bad;
    const { orderId, paymentUrl } = await failedOrder();
    expect(paymentUrl).toBeNull();
    expect(await orderRow(orderId)).toMatchObject({ gateway_url: null, gateway_reference: null });
  });

  it("coba lagi: berhasil membuat tautan, lalu panggilan berikutnya mengembalikan tautan yang sama tanpa memanggil gateway lagi", async () => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const { orderId } = await failedOrder();
    expect(ctx.gateway.requests).toHaveLength(1);
    ctx.gateway.error = undefined;
    const first = (await payLink(orderId).expect(200)).body;
    expect(first.paymentUrl).toMatch(/^https:\/\/gateway\.fake\.test\/pay\//);
    expect(ctx.gateway.requests).toHaveLength(2);
    const second = (await payLink(orderId).expect(200)).body;
    expect(second).toEqual(first);
    expect(ctx.gateway.requests).toHaveLength(2);
    expect(await orderRow(orderId)).toMatchObject({ gateway_url: first.paymentUrl });
  });

  it("dua permintaan coba-lagi bersamaan: gateway dipanggil sekali, keduanya mendapat tautan yang sama", async () => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const { orderId } = await failedOrder();
    ctx.gateway.error = undefined; ctx.gateway.delayMs = 100;
    const [r1, r2] = await Promise.all([payLink(orderId), payLink(orderId)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.paymentUrl).toBe(r2.body.paymentUrl);
    expect(ctx.gateway.requests).toHaveLength(2); // 1 yang gagal di checkout + 1 sukses
  });

  it("coba lagi saat gateway masih mati: 503 dengan pesan jelas, pesanan tidak berubah", async () => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const { orderId } = await failedOrder();
    const res = await payLink(orderId).expect(503);
    expect(res.body).toMatchObject({ code: "GATEWAY_UNAVAILABLE", message: "Pembayaran online belum bisa dibuka. Coba lagi sebentar lagi ya." });
    expect(await orderRow(orderId)).toMatchObject({ status: "MENUNGGU_PEMBAYARAN", gateway_url: null });
  });

  it("pembeli bisa membatalkan pesanan gateway yang belum punya tautan, dan stok fisik kembali", async () => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const p = await publish({ ...PHYSICAL, price: 120000 });
    await b.post("/api/cart/items", { productId: p.id }).expect(201);
    const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
    const q = (await b.post("/api/checkout/quote", { addressId, courier: "SiCepat", service: "REG" }).expect(200)).body;
    const { orderId } = (await checkout({ addressId, courier: "SiCepat", service: "REG", expectedTotal: q.total, paymentMethod: "gateway" }).expect(201)).body;
    expect((await rows<{ stock_reserved: number }>(sql`select stock_reserved from products where id = ${p.id}`))[0].stock_reserved).toBe(1);
    await b.post(`/api/orders/${orderId}/cancel`).expect(200);
    expect((await rows<{ stock_reserved: number }>(sql`select stock_reserved from products where id = ${p.id}`))[0].stock_reserved).toBe(0);
    expect((await orderRow(orderId)).status).toBe("DIBATALKAN");
  });
});

describe("hak akses dan keadaan pesanan untuk /payment/gateway", () => {
  it("wajib login (401); pembeli lain dan admin mendapat 404 yang sama dengan id ngawur", async () => {
    await setup();
    const { orderId } = (await gatewayCheckout()).body;
    expect((await request(ctx.app).post(`/api/orders/${orderId}/payment/gateway`)).status).toBe(401);
    const other = api(ctx, await ctx.buyerCookie());
    const notFound = { code: "ORDER_NOT_FOUND" };
    expect((await payLink(orderId, other).expect(404)).body).toMatchObject(notFound);
    expect((await payLink(orderId, a).expect(404)).body).toMatchObject(notFound);
    expect((await payLink("bukan-uuid").expect(404)).body).toMatchObject(notFound);
  });

  it("pesanan manual: 409 NOT_GATEWAY_ORDER dan gateway tidak dipanggil", async () => {
    await setup();
    await digitalCart();
    const { orderId } = (await checkout({ expectedTotal: 75000 }).expect(201)).body;
    expect((await payLink(orderId).expect(409)).body).toMatchObject({ code: "NOT_GATEWAY_ORDER" });
    expect(ctx.gateway.requests).toEqual([]);
  });

  it.each([["LUNAS"], ["DIBATALKAN"], ["KEDALUWARSA"], ["MENUNGGU_VERIFIKASI"]])("pesanan berstatus %s: 409 ORDER_NOT_PAYABLE", async (status) => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const { orderId } = (await gatewayCheckout()).body;
    ctx.gateway.error = undefined;
    await ctx.db.execute(sql`update orders set status = ${status} where id = ${orderId}`);
    expect((await payLink(orderId).expect(409)).body).toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    expect(ctx.gateway.requests).toHaveLength(1);
  });

  it("batas bayar sudah lewat walau tugas kedaluwarsa belum jalan: 409 ORDER_NOT_PAYABLE", async () => {
    await setup();
    ctx.gateway.error = new Error("mati");
    const { orderId } = (await gatewayCheckout()).body;
    ctx.gateway.error = undefined;
    ctx.clock.advance(25 * 3600_000);
    expect((await payLink(orderId).expect(409)).body).toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    expect(ctx.gateway.requests).toHaveLength(1);
  });

  it("unggah bukti ke pesanan gateway ditolak 409 (bukan jalur transfer manual)", async () => {
    await setup();
    const { orderId } = (await gatewayCheckout()).body;
    const res = await b.upload(`/api/orders/${orderId}/proof`, PNG, "image/png").expect(409);
    expect(res.body).toMatchObject({ code: "GATEWAY_ORDER" });
    expect(await rows(sql`select id from payment_proofs`)).toEqual([]);
  });
});

describe("halaman bayar dan email", () => {
  it("GET /payment pesanan gateway: method, tautan, tanpa rekening, tidak bisa unggah bukti; pesanan manual tetap method manual", async () => {
    await setup();
    await setting("bankAccount", BANK);
    const g = (await gatewayCheckout()).body;
    const res = (await b.get(`/api/orders/${g.orderId}/payment`).expect(200)).body;
    expect(res).toMatchObject({ method: "gateway", paymentUrl: g.paymentUrl, canUploadProof: false, bankAccount: null });
    await digitalCart(50000);
    const m = (await checkout({ expectedTotal: 50000 }).expect(201)).body;
    expect((await b.get(`/api/orders/${m.orderId}/payment`).expect(200)).body).toMatchObject({ method: "manual", paymentUrl: null, canUploadProof: true, bankAccount: BANK });
  });

  it("email pesanan gateway: tanpa rekening dan tanpa 'transfer', mengajak bayar online, tautan ke halaman pesanan; email manual tidak berubah", async () => {
    await setup();
    await setting("bankAccount", BANK);
    const g = (await gatewayCheckout()).body;
    await digitalCart(50000);
    await checkout({ expectedTotal: 50000 }).expect(201);
    const mails = (await ctx.emails()).filter((m) => /Pesananmu sudah dibuat/.test(m.subject));
    expect(mails).toHaveLength(2);
    const [gw, manual] = mails;
    expect(gw.text).not.toContain(BANK.number);
    expect(gw.text).not.toMatch(/Transfer ke|transfer/);
    expect(gw.text).toMatch(/bayar online/i);
    expect(gw.text).toContain(`${APP_URL}/pesanan/${g.orderId}`);
    expect(manual.text).toContain(BANK.number);
  });
});

describe("gangguan gateway tidak mematikan yang lain (N26)", () => {
  it("gateway mati: katalog, keranjang, dan checkout manual tetap jalan", async () => {
    await setup();
    ctx.gateway.error = new Error("seluruh gateway mati");
    const p = await publish({ price: 60000 });
    expect((await request(ctx.app).get("/api/catalog")).status).toBe(200);
    await b.post("/api/cart/items", { productId: p.id }).expect(201);
    expect((await b.get("/api/cart")).status).toBe(200);
    await checkout({ expectedTotal: 60000 }).expect(201);
    expect(ctx.gateway.requests).toEqual([]);
  });
});
