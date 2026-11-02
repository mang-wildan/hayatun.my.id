import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { sweepOrders } from "../jobs/expiry.js";

// T65 (F14.2-F14.7, N24, N36): webhook gateway. Penyedia tiruan menandatangani badan mentah dengan HMAC-SHA256 (header x-signature) memakai
// PAYMENT_GATEWAY_WEBHOOK_SECRET; format penyedia sungguhan ditambah saat penyedia dipilih.
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
afterEach(async () => {
  const p = new pg.Pool({ connectionString: ctx.config.databaseMigrationUrl });
  await p.query("drop trigger if exists t65_boom on orders; drop function if exists t65_boom()");
  await p.end();
  await ctx.close();
});

const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const sign = (raw: string, secret = ctx.config.gateway.webhookSecret) => createHmac("sha256", secret).update(raw).digest("hex");
const post = (raw: string, signature: string | null = sign(raw)) => {
  const r = request(ctx.app).post("/api/webhooks/gateway").set("content-type", "application/json");
  return (signature === null ? r : r.set("x-signature", signature)).send(raw);
};
interface Order { orderId: string; reference: string; total: number }
let seq = 0;
const evt = (o: { reference: string; total: number }, over: Record<string, unknown> = {}) => ({ eventId: `evt-${++seq}-${Date.now()}`, type: "payment.succeeded", reference: o.reference, amount: o.total, ...over });
const send = (event: object) => post(JSON.stringify(event));
const pay = (o: Order, over: Record<string, unknown> = {}) => send(evt(o, over));

async function publish(over: Record<string, unknown> = {}, codes?: string) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  if (codes) await a.post(`/api/admin/products/${p.id}/licenses`, { codes }).expect(200);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
async function toOrder(orderId: string, total: number): Promise<Order> {
  const [r] = await rows<{ gateway_reference: string }>(sql`select gateway_reference from orders where id = ${orderId}`);
  return { orderId, reference: r.gateway_reference, total };
}
const gatewayOrder = async (price = 75000, over: Record<string, unknown> = {}, codes?: string): Promise<Order> => {
  const p = await publish({ price, ...over }, codes);
  await b.post("/api/cart/items", { productId: p.id }).expect(201);
  const res = (await b.post("/api/checkout", { expectedTotal: price, paymentMethod: "gateway" }).expect(201)).body;
  return { ...(await toOrder(res.orderId, price)), productId: p.id } as Order & { productId: string };
};
async function physicalGatewayOrder(): Promise<Order & { productId: string }> {
  const p = await publish({ ...PHYSICAL, price: 120000 });
  await b.post("/api/cart/items", { productId: p.id }).expect(201);
  const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
  const q = (await b.post("/api/checkout/quote", { addressId, courier: "SiCepat", service: "REG" }).expect(200)).body;
  const res = (await b.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: q.total, paymentMethod: "gateway" }).expect(201)).body;
  return { ...(await toOrder(res.orderId, q.total)), productId: p.id };
}
const orderRow = async (id: string) => (await rows<{ status: string; digital_status: string; physical_status: string; paid_at: string | null; verified_by: string | null; review_reason: string | null }>(sql`select status, digital_status, physical_status, paid_at, verified_by, review_reason from orders where id = ${id}`))[0];
const events = () => rows<{ gateway_event_id: string; order_id: string | null; outcome: string; payload: Record<string, unknown>; processed_at: string | null }>(sql`select gateway_event_id, order_id, outcome, payload, processed_at from payment_events order by received_at, id`);
const subjects = async () => (await ctx.emails()).map((m) => m.subject);
const PAID_MAIL = "Pembayaranmu sudah kami terima";
const REVIEW_MAIL = "Pembayaran gateway perlu diperiksa";
const auditActions = async (id: string) => (await rows<{ action: string; actor_id: string | null }>(sql`select action, actor_id from audit_logs where entity_id = ${id} order by id`));

describe("keaslian (F14.3)", () => {
  it("tanda tangan benar: 200 {status: ok} dan pesanan menjadi Lunas", async () => {
    await setup();
    const o = await gatewayOrder();
    const res = await pay(o).expect(200);
    expect(res.body).toEqual({ status: "ok" });
    expect((await orderRow(o.orderId)).status).toBe("LUNAS");
  });

  it.each([
    ["tanpa header tanda tangan", () => null],
    ["tanda tangan salah (kunci lain)", (raw: string) => sign(raw, "kunci-lain-yang-panjangnya-cukup-cukup-aman")],
    ["tanda tangan potongan/ngawur", () => "zzzz"],
    ["tanda tangan kosong", () => ""],
    ["tanda tangan panjang sekali", () => "a".repeat(5000)],
  ])("%s: 401 tanpa menyimpan apa pun dan pesanan tidak berubah", async (_n, make) => {
    await setup();
    const o = await gatewayOrder();
    const raw = JSON.stringify(evt(o));
    const res = await post(raw, make(raw)).expect(401);
    expect(res.body).toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(await events()).toEqual([]);
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_PEMBAYARAN");
  });

  it("badan diubah setelah ditandatangani (nominal atau referensi): 401", async () => {
    await setup();
    const o = await gatewayOrder();
    const signed = JSON.stringify(evt(o, { amount: 1000 }));
    const tampered = signed.replace('"amount":1000', `"amount":${o.total}`);
    expect(tampered).not.toBe(signed);
    await post(tampered, sign(signed)).expect(401);
    expect(await events()).toEqual([]);
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_PEMBAYARAN");
  });

  it("penyedia 'none': rute tidak ada (404), walau tanda tangannya benar", async () => {
    await setup({ PAYMENT_GATEWAY_PROVIDER: "none" });
    const raw = JSON.stringify({ eventId: "e1", type: "payment.succeeded", reference: "R", amount: 1 });
    expect((await request(ctx.app).post("/api/webhooks/gateway").set("content-type", "application/json").set("x-signature", sign(raw, "x".repeat(40))).send(raw)).status).toBe(404);
  });
});

describe("pembayaran sukses (F14.2)", () => {
  it("digital: Lunas dan terkirim, paid_at terisi, tanpa admin pemverifikasi, tercatat 'Lunas via gateway', pembeli diberi email", async () => {
    await setup();
    const o = await gatewayOrder();
    await pay(o).expect(200);
    const row = await orderRow(o.orderId);
    expect(row).toMatchObject({ status: "LUNAS", digital_status: "TERKIRIM", physical_status: "TIDAK_ADA", verified_by: null });
    expect(new Date(row.paid_at!).getTime()).toBe(ctx.clock.now.getTime());
    expect(await auditActions(o.orderId)).toEqual([{ action: "payment.gateway_paid", actor_id: null }]);
    expect((await subjects()).filter((s) => s === PAID_MAIL)).toHaveLength(1);
    const [ev] = await events();
    expect(ev).toMatchObject({ order_id: o.orderId, outcome: "paid" });
    expect(ev.processed_at).not.toBeNull();
  });

  it("produk berlisensi: kode ditetapkan ke pesanan dan ikut di email pembeli", async () => {
    await setup();
    const o = await gatewayOrder(50000, { isLicensed: true, name: "Aplikasi Kasir" }, "KODE-AAA\nKODE-BBB");
    await pay(o).expect(200);
    expect((await rows<{ status: string }>(sql`select status from license_codes order by status`)).map((r) => r.status)).toEqual(["assigned", "available"]);
    expect((await ctx.emails()).find((m) => m.subject === PAID_MAIL)!.text).toMatch(/KODE-(AAA|BBB)/);
    expect((await orderRow(o.orderId)).digital_status).toBe("TERKIRIM");
  });

  it("produk fisik: stok ditahan menjadi terjual dan status fisik Diproses", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    await pay(o).expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "LUNAS", physical_status: "DIPROSES" });
    expect((await rows<{ stock_qty: number; stock_reserved: number; stock_sold: number }>(sql`select stock_qty, stock_reserved, stock_sold from products where id = ${(o as unknown as { productId: string }).productId}`))[0]).toEqual({ stock_qty: 9, stock_reserved: 0, stock_sold: 1 });
  });

  it("pesanan yang batas bayarnya terlewat tetapi belum disapu (masih Menunggu Pembayaran) tetap diterima: stok masih ditahan", async () => {
    await setup();
    const o = await gatewayOrder();
    ctx.clock.advance(26 * 3600_000);
    await pay(o).expect(200);
    expect((await orderRow(o.orderId)).status).toBe("LUNAS");
  });
});

describe("tepat satu kali (F14.4)", () => {
  it("kejadian yang sama dua kali: dua-duanya 200, satu catatan, satu email, stok dan paid_at tidak berubah", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    const e = evt(o);
    await send(e).expect(200);
    const first = await orderRow(o.orderId);
    ctx.clock.advance(60_000);
    await send(e).expect(200);
    expect(await orderRow(o.orderId)).toEqual(first);
    expect(await events()).toHaveLength(1);
    expect((await subjects()).filter((s) => s === PAID_MAIL)).toHaveLength(1);
    expect((await rows<{ stock_sold: number }>(sql`select stock_sold from products where id = ${(o as unknown as { productId: string }).productId}`))[0].stock_sold).toBe(1);
    expect(await auditActions(o.orderId)).toHaveLength(1);
  });

  it("lima kiriman yang sama bersamaan: semuanya 200, diproses sekali", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    const e = evt(o);
    const res = await Promise.all(Array.from({ length: 5 }, () => send(e)));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await events()).toHaveLength(1);
    expect((await rows<{ stock_sold: number }>(sql`select stock_sold from products where id = ${(o as unknown as { productId: string }).productId}`))[0].stock_sold).toBe(1);
    expect((await subjects()).filter((s) => s === PAID_MAIL)).toHaveLength(1);
  });

  it("kejadian lain (ID berbeda) untuk pesanan yang sudah Lunas: tidak mengubah apa pun selain menandai 'perlu diperiksa' (kemungkinan bayar dua kali)", async () => {
    await setup();
    const o = await gatewayOrder();
    await pay(o).expect(200);
    const before = await orderRow(o.orderId);
    await pay(o).expect(200);
    const after = await orderRow(o.orderId);
    expect(after).toMatchObject({ status: "LUNAS", paid_at: before.paid_at });
    expect(after.review_reason).toMatch(/dua kali|sudah lunas/i);
    expect((await events()).map((e) => e.outcome)).toEqual(["paid", "review"]);
    expect((await subjects()).filter((s) => s === PAID_MAIL)).toHaveLength(1);
    expect((await subjects()).filter((s) => s === REVIEW_MAIL)).toHaveLength(1);
  });

  it("gagal di tengah pemrosesan: tidak ada yang tersimpan (kejadian ikut dibatalkan) dan kiriman ulang gateway berhasil", async () => {
    await setup();
    const o = await gatewayOrder();
    const e = evt(o);
    const dba = new pg.Pool({ connectionString: ctx.config.databaseMigrationUrl });
    await dba.query(`create function t65_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
      create trigger t65_boom before update on orders for each row when (new.status = 'LUNAS') execute function t65_boom()`);
    try {
      expect((await send(e)).status).toBe(500);
      expect(await events()).toEqual([]);
      expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_PEMBAYARAN");
    } finally {
      await dba.query("drop trigger t65_boom on orders; drop function t65_boom()");
      await dba.end();
    }
    await send(e).expect(200);
    expect((await orderRow(o.orderId)).status).toBe("LUNAS");
    expect(await events()).toHaveLength(1);
  });
});

describe("nominal tidak sama (F14.5)", () => {
  it.each([["kurang", (t: number) => t - 1000], ["lebih", (t: number) => t + 1000]])("nominal %s: tidak Lunas, ditandai untuk admin, stok tetap ditahan, admin diberi email", async (_n, amount) => {
    await setup();
    const o = await physicalGatewayOrder();
    await pay(o, { amount: amount(o.total) }).expect(200);
    const row = await orderRow(o.orderId);
    expect(row.status).toBe("MENUNGGU_PEMBAYARAN");
    expect(row.paid_at).toBeNull();
    expect(row.review_reason).toMatch(/nominal/i);
    expect((await rows<{ stock_reserved: number; stock_sold: number }>(sql`select stock_reserved, stock_sold from products where id = ${(o as unknown as { productId: string }).productId}`))[0]).toEqual({ stock_reserved: 1, stock_sold: 0 });
    expect((await events()).map((e) => e.outcome)).toEqual(["review"]);
    expect((await auditActions(o.orderId)).map((x) => x.action)).toEqual(["payment.gateway_review"]);
    const mails = await ctx.emails();
    expect(mails.filter((m) => m.subject === REVIEW_MAIL)).toHaveLength(1);
    expect(mails.map((m) => m.subject)).not.toContain(PAID_MAIL);
  });

  it("email admin memuat nomor invoice dan alasan, tanpa nama, HP, atau alamat pembeli", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    await pay(o, { amount: 1 }).expect(200);
    const mail = (await ctx.emails()).find((m) => m.subject === REVIEW_MAIL)!;
    const [{ invoice_number }] = await rows<{ invoice_number: string }>(sql`select invoice_number from orders where id = ${o.orderId}`);
    expect(mail.text).toContain(invoice_number);
    expect(mail.text).toMatch(/nominal/i);
    for (const secret of [ADDRESS.recipient, ADDRESS.phone, "Pajajaran"]) expect(mail.text).not.toContain(secret);
  });

  it("nominal bukan bilangan bulat rupiah yang sah (desimal, string, nol, negatif): 400, tidak disimpan", async () => {
    await setup();
    const o = await gatewayOrder();
    for (const amount of [75000.5, "75000", 0, -75000, null]) {
      expect((await pay(o, { amount })).status, JSON.stringify(amount)).toBe(400);
    }
    expect(await events()).toEqual([]);
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_PEMBAYARAN");
  });

  it("nominal salah lalu kiriman benar dengan ID berbeda: Lunas, dan catatan 'perlu diperiksa' tetap ada sebagai riwayat", async () => {
    await setup();
    const o = await gatewayOrder();
    await pay(o, { amount: o.total - 1 }).expect(200);
    await pay(o).expect(200);
    const row = await orderRow(o.orderId);
    expect(row.status).toBe("LUNAS");
    expect(row.review_reason).toMatch(/nominal/i);
  });
});

describe("tiba setelah kedaluwarsa atau batal (F14.6)", () => {
  it("sudah disapu jadi Kedaluwarsa: tetap Kedaluwarsa, stok dan kode TIDAK ditetapkan, ditandai, admin diberi email, pembeli tidak diberi email 'diterima'", async () => {
    await setup();
    const o = await gatewayOrder(50000, { isLicensed: true, name: "Aplikasi Kasir" }, "KODE-AAA\nKODE-BBB");
    ctx.clock.advance(25 * 3600_000);
    await sweepOrders({ db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now });
    expect((await orderRow(o.orderId)).status).toBe("KEDALUWARSA");
    await pay(o).expect(200);
    const row = await orderRow(o.orderId);
    expect(row).toMatchObject({ status: "KEDALUWARSA", paid_at: null });
    expect(row.review_reason).toMatch(/kedaluwarsa/i);
    expect((await rows<{ status: string }>(sql`select status from license_codes order by id`)).every((r) => r.status === "available")).toBe(true);
    const subs = await subjects();
    expect(subs).toContain(REVIEW_MAIL);
    expect(subs).not.toContain(PAID_MAIL);
  });

  it("fisik: stok tidak berubah (sudah dilepas saat kedaluwarsa, tidak diambil lagi)", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    ctx.clock.advance(25 * 3600_000);
    await sweepOrders({ db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now });
    const stock = () => rows(sql`select stock_qty, stock_reserved, stock_sold from products where id = ${(o as unknown as { productId: string }).productId}`);
    const released = await stock();
    await pay(o).expect(200);
    expect(await stock()).toEqual(released);
    expect(released[0]).toMatchObject({ stock_reserved: 0, stock_sold: 0 });
  });

  it("dibatalkan pembeli: tetap Dibatalkan dan ditandai (alasan menyebut dibatalkan)", async () => {
    await setup();
    const o = await gatewayOrder();
    await b.post(`/api/orders/${o.orderId}/cancel`).expect(200);
    await pay(o).expect(200);
    const row = await orderRow(o.orderId);
    expect(row.status).toBe("DIBATALKAN");
    expect(row.review_reason).toMatch(/dibatalkan/i);
  });
});

describe("konfirmasi tidak datang (F14.7)", () => {
  it("pesanan gateway tanpa konfirmasi kedaluwarsa seperti pesanan manual: stok dilepas dan kode dikembalikan", async () => {
    await setup();
    const o = await physicalGatewayOrder();
    ctx.clock.advance(25 * 3600_000);
    await sweepOrders({ db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now });
    expect((await orderRow(o.orderId)).status).toBe("KEDALUWARSA");
    expect((await rows<{ stock_reserved: number }>(sql`select stock_reserved from products where id = ${(o as unknown as { productId: string }).productId}`))[0].stock_reserved).toBe(0);
    expect(await subjects()).toContain("Pesananmu kedaluwarsa");
  });
});

describe("kejadian lain dan bentuk badan", () => {
  it("referensi tidak dikenal: 200 (gateway berhenti mengulang), dicatat tanpa pesanan, tidak ada yang berubah", async () => {
    await setup();
    const o = await gatewayOrder();
    await send(evt({ reference: "REF-TIDAK-ADA", total: 1 })).expect(200);
    expect(await events()).toEqual([expect.objectContaining({ order_id: null, outcome: "unknown_order" })]);
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_PEMBAYARAN");
  });

  it.each(["payment.failed", "payment.expired", "payment.pending"])("jenis %s: dicatat dan diabaikan; pesanan tidak berubah dan tidak ada email", async (type) => {
    await setup();
    const o = await gatewayOrder();
    await pay(o, { type }).expect(200);
    expect((await events()).map((e) => e.outcome)).toEqual(["ignored"]);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "MENUNGGU_PEMBAYARAN", review_reason: null });
    const subs = await subjects();
    expect(subs).not.toContain(PAID_MAIL);
    expect(subs).not.toContain(REVIEW_MAIL);
  });

  it("kejadian 'sukses' untuk pesanan manual (referensi menempel di pesanan manual): tidak pernah Lunas, ditandai", async () => {
    await setup();
    const p = await publish({ price: 40000 });
    await b.post("/api/cart/items", { productId: p.id }).expect(201);
    const { orderId } = (await b.post("/api/checkout", { expectedTotal: 40000 }).expect(201)).body;
    await ctx.db.execute(sql`update orders set gateway_reference = 'REF-MANUAL' where id = ${orderId}`);
    await pay({ orderId, reference: "REF-MANUAL", total: 40000 }).expect(200);
    const row = await orderRow(orderId);
    expect(row.status).toBe("MENUNGGU_PEMBAYARAN");
    expect(row.review_reason).toMatch(/bukan pesanan gateway|transfer/i);
  });

  it.each([
    ["bukan JSON", "{bukan json"],
    ["tanpa eventId", JSON.stringify({ type: "payment.succeeded", reference: "R", amount: 1000 })],
    ["tanpa referensi", JSON.stringify({ eventId: "e", type: "payment.succeeded", amount: 1000 })],
    ["jenis tak dikenal", JSON.stringify({ eventId: "e", type: "payment.aneh", reference: "R", amount: 1000 })],
    ["eventId kosong", JSON.stringify({ eventId: "", type: "payment.succeeded", reference: "R", amount: 1000 })],
    ["badan kosong", ""],
    ["array", "[]"],
  ])("badan salah (%s) walau tanda tangan benar: 400 dan tidak disimpan", async (_n, raw) => {
    await setup();
    const res = await post(raw).expect(400);
    expect(res.body).toMatchObject({ code: "INVALID_EVENT" });
    expect(await events()).toEqual([]);
  });

  it("yang disimpan hanya bidang yang dinormalisasi: data pembeli dari gateway tidak ikut tersimpan", async () => {
    await setup();
    const o = await gatewayOrder();
    const e = evt(o, { customer: { name: "Budi Santoso", phone: "081234567890", email: "budi@contoh.id" }, va: "8808123456789" });
    await send(e).expect(200);
    const [ev] = await events();
    expect(ev.payload).toEqual({ eventId: e.eventId, type: "payment.succeeded", reference: o.reference, amount: o.total });
  });

  it("jawaban sama untuk semua hasil ({status: ok}): tidak membocorkan keadaan pesanan ke pemanggil", async () => {
    await setup();
    const o = await gatewayOrder();
    const bodies = [
      (await send(evt({ reference: "NOPE", total: 1 })).expect(200)).body,
      (await pay(o, { amount: 1 }).expect(200)).body,
      (await pay(o).expect(200)).body,
    ];
    expect(bodies).toEqual([{ status: "ok" }, { status: "ok" }, { status: "ok" }]);
  });
});

describe("tampilan admin", () => {
  it("daftar pesanan admin memuat metode bayar dan alasan 'perlu diperiksa'", async () => {
    await setup();
    const o = await gatewayOrder();
    await pay(o, { amount: 5 }).expect(200);
    const list = (await a.get("/api/admin/orders").expect(200)).body.orders as { orderId: string; paymentMethod: string; reviewReason: string | null }[];
    expect(list.find((x) => x.orderId === o.orderId)).toMatchObject({ paymentMethod: "gateway", reviewReason: expect.stringMatching(/nominal/i) });
  });
});
