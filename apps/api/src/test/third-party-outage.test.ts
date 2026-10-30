import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../modules/auth/sessions.js";
import type { Mailer } from "../modules/notifications/mailer.js";
import { createTestContext, type TestContext } from "./context.js";
import { PHYSICAL, api, makeProduct } from "./products.js";

// N26: ekspedisi atau email yang mati tidak boleh membuat katalog, akun, atau unduhan produk digital ikut mati.
// Tiap mode kerusakan menjalankan seluruh jalur inti yang sama.
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(500)]);
const PASSWORD = "rahasia-hayatun-1";
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };
const SHIPPING_DOWN = { code: "SHIPPING_UNAVAILABLE", message: "Ongkir belum bisa dihitung, coba lagi beberapa saat" }; // F3.6, persis
const SLOW_MS = 400;

const contexts: TestContext[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });
const make = async (mailer?: Mailer) => { const c = await createTestContext({ mailer }); contexts.push(c); return c; };

const hang = () => new Promise<never>(() => {}); // tidak pernah menjawab dan mengabaikan sinyal batal
const SHIPPING_MODES: [string, () => Promise<unknown>][] = [
  ["melempar galat", async () => { throw new Error("penyedia mati"); }],
  ["hanya memberi tarif tidak sah (Rp0)", async () => [{ courier: "JNE", service: "REG", price: 0, etdDays: "2-3" }]],
  ["menggantung melewati batas waktu dan mengabaikan sinyal batal", hang],
];
const MAIL_MODES: [string, Mailer][] = [
  ["melempar galat", { send: async () => { throw new Error("SMTP mati, penerima siti@hayatun.test"); } }],
  ["menggantung", { send: hang }],
];

interface World { ctx: TestContext; adminCookie: string; admin: ReturnType<typeof api>; siti: ReturnType<typeof api>; sitiId: string; ebook: { id: string; slug: string }; fileId: string; nastar: { id: string } }
async function world(ctx: TestContext): Promise<World> {
  const adminCookie = await ctx.adminCookie();
  const admin = api(ctx, adminCookie);
  const sitiId = await ctx.createUser({ email: "siti@hayatun.test", password: PASSWORD, name: "Siti Aminah" });
  const siti = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id: sitiId, role: "buyer" }, ctx.clock.now)).token}`);
  const ebook = await makeProduct(ctx, adminCookie, { name: "E-book Ramadan", price: 75000 });
  const fileId = (await admin.upload(`/api/admin/products/${ebook.id}/files?filename=ebook.pdf`, PDF, "application/pdf").expect(201)).body.id as string;
  await admin.post(`/api/admin/products/${ebook.id}/activate`).expect(200);
  const nastar = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Nastar", stockQty: 10 });
  await admin.post(`/api/admin/products/${nastar.id}/activate`).expect(200);
  return { ctx, adminCookie, admin, siti, sitiId, ebook, fileId, nastar };
}

// Jalur inti yang harus tetap hidup apa pun yang terjadi pada layanan luar
async function coreWorks(w: World, tag: string) {
  const { ctx, admin, siti } = w;
  const t = (label: string) => `${tag}: ${label}`;

  // katalog (publik)
  expect((await ctx.get("/api/catalog").expect(200)).body.products.length, t("katalog")).toBeGreaterThan(0);
  await ctx.get(`/api/catalog/${w.ebook.slug}`).expect(200);
  await ctx.get("/api/store").expect(200);
  await ctx.get("/api/health").expect(200);

  // akun: daftar, masuk, dan lihat akun sendiri
  await ctx.post("/api/auth/register", { name: `Baru ${tag}`.slice(0, 40), email: `baru-${Math.random().toString(36).slice(2, 8)}@hayatun.test`, password: PASSWORD }).expect(202);
  const login = await ctx.post("/api/auth/login", { email: "siti@hayatun.test", password: PASSWORD }).expect(200);
  expect(login.headers["set-cookie"], t("masuk memberi sesi")).toBeDefined();
  expect((await siti.get("/api/auth/me").expect(200)).body.email, t("akun sendiri")).toBe("siti@hayatun.test");

  // belanja produk digital sampai lunas, tanpa ekspedisi
  await siti.post("/api/cart/items", { productId: w.ebook.id }).expect(201);
  const order = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
  await siti.upload(`/api/orders/${order.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.get("/api/admin/payments").expect(200);
  await admin.post(`/api/admin/payments/${order.orderId}/accept`).expect(200);
  const mine = (await siti.get("/api/orders").expect(200)).body;
  expect(JSON.stringify(mine), t("daftar pesanan")).toContain(order.orderId);
  await siti.get(`/api/invoices/${order.orderId}`).expect(200);

  // unduhan produk digital: daftar file, tautan, lalu file sungguhan
  expect((await siti.get(`/api/orders/${order.orderId}/files`).expect(200)).body, t("daftar file")).toBeDefined();
  const url = (await siti.post(`/api/orders/${order.orderId}/files/${w.fileId}/download`).expect(200)).body.url as string;
  const file = await siti.get(url).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
  expect(file.status, t("unduhan")).toBe(200);
  expect((file.body as Buffer).equals(PDF), t("isi unduhan utuh")).toBe(true);
  return order.orderId;
}

const orders = async (ctx: TestContext) => Number((await ctx.db.execute(sql`select count(*)::int as n from orders`)).rows[0].n);

describe.each(SHIPPING_MODES)("ekspedisi %s", (_name, mode) => {
  it("katalog, akun, belanja digital, dan unduhan tetap jalan", async () => {
    const ctx = await make();
    ctx.config.shipping.timeoutMs = 150;
    ctx.shipping.rates = mode as never;
    await coreWorks(await world(ctx), "ekspedisi mati");
  });

  it("hanya ongkir produk fisik yang gagal: 503 persis seperti F3.6, tanpa pesanan dan tanpa stok tertahan", async () => {
    const ctx = await make();
    ctx.config.shipping.timeoutMs = 150;
    const w = await world(ctx);
    const addressId = (await w.siti.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
    await w.siti.post("/api/cart/items", { productId: w.nastar.id }).expect(201);
    ctx.shipping.rates = mode as never;
    const before = await orders(ctx);
    for (const [path, body] of [["/api/checkout/quote", { addressId }], ["/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 135000 }]] as const) {
      const t0 = Date.now();
      const res = await w.siti.post(path, body).expect(503);
      expect(res.body).toMatchObject(SHIPPING_DOWN);
      expect(Date.now() - t0, `${path} dibatasi waktu`).toBeLessThan(1500);
    }
    expect(await orders(ctx)).toBe(before);
    expect((await w.admin.get(`/api/admin/products/${w.nastar.id}`).expect(200)).body.stock).toMatchObject({ available: 10, reserved: 0 });
    expect(JSON.stringify((await w.siti.get("/api/cart").expect(200)).body)).toContain("Nastar"); // keranjang utuh
  });
});

describe("ekspedisi menggantung tidak menyeret permintaan lain", () => {
  it("selama hitung ongkir menunggu, katalog dan akun tetap cepat", async () => {
    const ctx = await make();
    ctx.config.shipping.timeoutMs = 1500;
    const w = await world(ctx);
    const addressId = (await w.siti.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
    await w.siti.post("/api/cart/items", { productId: w.nastar.id }).expect(201);
    ctx.shipping.rates = hang as never;
    const stuck = w.siti.post("/api/checkout/quote", { addressId }).then((r) => r.status);
    await new Promise((r) => setTimeout(r, 100)); // pastikan permintaan ongkir sudah menggantung
    const t0 = Date.now();
    await ctx.get("/api/catalog").expect(200);
    await w.siti.get("/api/auth/me").expect(200);
    await w.siti.get("/api/orders").expect(200);
    expect(Date.now() - t0, "permintaan lain tidak menunggu ekspedisi").toBeLessThan(SLOW_MS);
    expect(await stuck).toBe(503);
  });
});

describe.each(MAIL_MODES)("email %s", (_name, mailer) => {
  it("katalog, akun, belanja digital, dan unduhan tetap jalan; permintaan tidak menunggu email", async () => {
    const ctx = await make(mailer);
    const w = await world(ctx);
    const t0 = Date.now();
    const orderId = await coreWorks(w, "email mati");
    expect(Date.now() - t0, "email dikirim lewat antrean, bukan di dalam permintaan").toBeLessThan(20_000);
    const [o] = (await ctx.db.execute(sql`select status from orders where id = ${orderId}`)).rows;
    expect(o.status, "status pesanan tetap berubah (F11.4)").toBe("LUNAS");
  });

  it("pembatalan oleh pembeli dan penolakan bukti tetap mengubah status", async () => {
    const ctx = await make(mailer);
    const w = await world(ctx);
    await w.siti.post("/api/cart/items", { productId: w.ebook.id }).expect(201);
    const a = (await w.siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body.orderId as string;
    await w.siti.post(`/api/orders/${a}/cancel`).expect(200);
    await w.siti.post("/api/cart/items", { productId: w.ebook.id }).expect(201);
    const b = (await w.siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body.orderId as string;
    await w.siti.upload(`/api/orders/${b}/proof`, PDF, "application/pdf").expect(201);
    await w.admin.post(`/api/admin/payments/${b}/reject`, { reason: "Foto buram" }).expect(200);
    const st = async (id: string) => (await ctx.db.execute(sql`select status from orders where id = ${id}`)).rows[0].status;
    expect(await st(a)).toBe("DIBATALKAN");
    expect(await st(b)).toBe("MENUNGGU_PEMBAYARAN");
  });
});

describe("kebijakan ulang email (F11.4)", () => {
  it("tiap email diantrekan dengan minimal 3 percobaan ulang dalam 30 menit", async () => {
    const ctx = await make();
    const sent: { name: string; opts?: { retryLimit?: number; retryDelaySec?: number } }[] = [];
    const original = ctx.queue.send;
    ctx.queue.send = (async (name: string, data: object, opts?: { retryLimit?: number; retryDelaySec?: number }) => { sent.push({ name, opts }); return original.call(ctx.queue, name, data); }) as typeof ctx.queue.send;
    await ctx.post("/api/auth/register", { name: "Baru", email: "baru@hayatun.test", password: PASSWORD }).expect(202);
    const mail = sent.filter((s) => s.name === "email.send");
    expect(mail.length).toBeGreaterThan(0);
    for (const m of mail) {
      expect(m.opts?.retryLimit).toBeGreaterThanOrEqual(3);
      expect(m.opts!.retryLimit! * m.opts!.retryDelaySec!).toBeLessThanOrEqual(30 * 60);
    }
  });
});

describe("kegagalan email tidak bocor dan layanan yang pulih mengirim yang tertunda", () => {
  it("galat pengiriman tidak memuat alamat penerima; setelah SMTP pulih email tertunda terkirim", async () => {
    let down = true;
    const sent: string[] = [];
    const mailer: Mailer = { send: async (m) => { if (down) throw new Error(`SMTP mati, penerima ${m.to}`); sent.push(m.to); } };
    const ctx = await make(mailer);
    await ctx.post("/api/auth/register", { name: "Baru", email: "baru@hayatun.test", password: PASSWORD }).expect(202);
    const err = await ctx.queue.runAll().then(() => null, (e: Error) => e);
    expect(err?.message).toBe("Gagal mengirim email");
    expect(JSON.stringify(err)).not.toContain("baru@hayatun.test");
    expect(sent).toEqual([]);

    down = false; // SMTP pulih; pg-boss mengulang pekerjaan yang sama, di sini diulang lewat pendaftaran ulang
    await ctx.post("/api/auth/register", { name: "Baru", email: "baru@hayatun.test", password: PASSWORD }).expect(202);
    await ctx.queue.runAll();
    expect(sent.length, "email terkirim setelah pulih").toBeGreaterThan(0);
  });
});

describe("keduanya mati sekaligus", () => {
  it("jalur inti tetap hidup", async () => {
    const ctx = await make({ send: async () => { throw new Error("SMTP mati"); } });
    ctx.config.shipping.timeoutMs = 150;
    ctx.shipping.rates = hang as never;
    await coreWorks(await world(ctx), "ekspedisi dan email mati");
  });
});

