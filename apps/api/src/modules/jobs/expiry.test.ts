import { sql } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryQueue } from "../../jobs/queue.js";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { registerOrderJobs, sweepOrders } from "./expiry.js";

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

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const EXPIRED_SUBJECT = "Pesananmu kedaluwarsa";
const REMINDER_SUBJECT = "Batas bayar pesananmu tinggal 3 jam";
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const PDF = Buffer.from("%PDF-1.7\nbukti transfer");

const deps = () => ({ db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, now: () => ctx.clock.now });
const sweep = (opts?: { batchSize?: number }) => sweepOrders(deps(), opts);
const status = async (id: string) => ((await ctx.db.execute(sql`select status from orders where id = ${id}`)).rows[0] as { status: string }).status;
const reserved = async (productId: string) => ((await ctx.db.execute(sql`select stock_reserved from products where id = ${productId}`)).rows[0] as { stock_reserved: number }).stock_reserved;
const codes = async (productId: string) => (await ctx.db.execute(sql`select status, order_item_id from license_codes where product_id = ${productId} order by status`)).rows as { status: string; order_item_id: string | null }[];
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}

// pesanan digital Rp75.000
async function digitalOrder(who = b) {
  const d = await publish({ name: "E-book", price: 75000 });
  await who.post("/api/cart/items", { productId: d.id }).expect(201);
  return (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
}

// pesanan campuran: 1 kode lisensi + 2 barang fisik, stok dan kode tertahan
async function heldOrder() {
  const lic = await publish({ name: "Aplikasi Kasir", price: 50000, isLicensed: true });
  await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "KODE-1\nKODE-2" }).expect(200);
  const f = await publish({ ...PHYSICAL, name: "Nastar", price: 120000, stockQty: 10 });
  await b.post("/api/cart/items", { productId: lic.id }).expect(201);
  await b.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const order = (await b.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 50000 + 240000 + 15000 }).expect(201)).body;
  return { lic, f, orderId: order.orderId as string };
}

describe("kedaluwarsa otomatis (F4.4)", () => {
  it("1 ms sebelum 24 jam tetap menunggu; tepat 24 jam menjadi Kedaluwarsa", async () => {
    const { orderId } = await digitalOrder();
    ctx.clock.advance(DAY - 1);
    await sweep();
    expect(await status(orderId)).toBe("MENUNGGU_PEMBAYARAN");
    ctx.clock.advance(1);
    expect(await sweep()).toMatchObject({ expired: 1 });
    expect(await status(orderId)).toBe("KEDALUWARSA");
  });

  it("stok fisik dan kode lisensi yang ditahan dilepas", async () => {
    const { lic, f, orderId } = await heldOrder();
    expect(await reserved(f.id)).toBe(2);
    expect((await codes(lic.id)).map((c) => c.status)).toEqual(["available", "reserved"]);
    ctx.clock.advance(DAY);
    await sweep();
    expect(await status(orderId)).toBe("KEDALUWARSA");
    expect(await reserved(f.id)).toBe(0);
    expect(await codes(lic.id)).toEqual([{ status: "available", order_item_id: null }, { status: "available", order_item_id: null }]);
  });

  it("pembeli diberi tahu lewat email: nomor invoice dan ajakan checkout ulang, tanpa data sensitif", async () => {
    await ctx.db.execute(sql`insert into store_settings (key, value) values ('bankAccount', ${JSON.stringify({ bank: "BCA", number: "9876543210", holder: "Hayatun" })}::jsonb)`);
    const { orderId, invoiceNumber } = await digitalOrder();
    ctx.clock.advance(DAY);
    await sweep();
    const [mail, ...rest] = await mails(EXPIRED_SUBJECT);
    expect(rest).toEqual([]);
    expect(mail.text).toContain(invoiceNumber);
    expect(mail.text).toMatch(/checkout ulang/i);
    expect(mail.text).toContain(`${APP_URL}/pesanan/${orderId}`);
    expect(mail.text).not.toContain("9876543210"); // rekening
    expect(mail.text).not.toMatch(/Pajajaran|0812/); // alamat dan nomor HP
  });

  it("pesanan yang buktinya sudah diunggah tidak ikut kedaluwarsa", async () => {
    const { orderId } = await digitalOrder();
    await b.upload(`/api/orders/${orderId}/proof`, PDF, "application/pdf").expect(201);
    ctx.clock.advance(3 * DAY);
    await sweep();
    expect(await status(orderId)).toBe("MENUNGGU_VERIFIKASI");
    expect(await mails(EXPIRED_SUBJECT)).toEqual([]);
  });

  it("sapuan diulang: tidak ada email ganda dan stok tidak dilepas dua kali", async () => {
    const { f } = await heldOrder();
    ctx.clock.advance(DAY);
    await sweep();
    await sweep();
    expect(await sweep()).toMatchObject({ expired: 0 });
    expect(await reserved(f.id)).toBe(0);
    expect(await mails(EXPIRED_SUBJECT)).toHaveLength(1);
  });

  it("mengejar yang tertinggal setelah server mati (N25): satu sapuan menuntaskan semua, berapa pun banyaknya", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push((await digitalOrder(api(ctx, await ctx.buyerCookie()))).orderId);
      ctx.clock.advance(20 * 60_000); // dibuat di waktu yang berbeda-beda (di bawah 30 menit supaya sesi admin tidak habis)
    }
    ctx.clock.advance(3 * DAY); // server mati 3 hari
    expect(await sweep({ batchSize: 10 })).toMatchObject({ expired: 25 });
    for (const id of ids) expect(await status(id)).toBe("KEDALUWARSA");
    expect(await mails(EXPIRED_SUBJECT)).toHaveLength(25);
  });

  it("dua penyapu bersamaan: tiap pesanan diproses tepat sekali", async () => {
    const { f } = await heldOrder();
    for (let i = 0; i < 4; i++) await digitalOrder(api(ctx, await ctx.buyerCookie()));
    ctx.clock.advance(DAY);
    const [x, y] = await Promise.all([sweep({ batchSize: 2 }), sweep({ batchSize: 2 })]);
    expect(x.expired + y.expired).toBe(5);
    expect(await reserved(f.id)).toBe(0);
    expect(await mails(EXPIRED_SUBJECT)).toHaveLength(5);
  });
});

describe("pengingat 3 jam sebelum batas (F4.5)", () => {
  it("1 ms sebelum jendela 3 jam belum ada; tepat di jendela satu email; tidak dikirim ulang", async () => {
    const { orderId, invoiceNumber } = await digitalOrder();
    ctx.clock.advance(DAY - 3 * HOUR - 1);
    await sweep();
    expect(await mails(REMINDER_SUBJECT)).toEqual([]);
    ctx.clock.advance(1);
    expect(await sweep()).toMatchObject({ reminded: 1 });
    ctx.clock.advance(HOUR);
    await sweep();
    const sent = await mails(REMINDER_SUBJECT);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(invoiceNumber);
    expect(sent[0].text).toContain("Rp75.000");
    expect(sent[0].text).toContain("WIB"); // batas waktu ditulis sebagai jam dan tanggal yang jelas
    expect(sent[0].text).toContain(`${APP_URL}/pesanan/${orderId}`);
  });

  it("tidak dikirim bila bukti sudah diunggah", async () => {
    const { orderId } = await digitalOrder();
    await b.upload(`/api/orders/${orderId}/proof`, PDF, "application/pdf").expect(201);
    ctx.clock.advance(DAY - HOUR);
    await sweep();
    expect(await mails(REMINDER_SUBJECT)).toEqual([]);
  });

  it("pesanan yang sudah lewat batas tidak diingatkan, langsung dikabari kedaluwarsa", async () => {
    await digitalOrder();
    ctx.clock.advance(2 * DAY); // server mati melewati jendela pengingat
    await sweep();
    expect(await mails(REMINDER_SUBJECT)).toEqual([]);
    expect(await mails(EXPIRED_SUBJECT)).toHaveLength(1);
  });

  it("dua penyapu bersamaan: satu pengingat", async () => {
    await digitalOrder();
    ctx.clock.advance(DAY - 2 * HOUR);
    await Promise.all([sweep(), sweep()]);
    expect(await mails(REMINDER_SUBJECT)).toHaveLength(1);
  });
});

// Memastikan permintaan benar-benar tumpang tindih: baris pesanan dikunci dari koneksi lain sampai semuanya tertahan
async function overlapped<T>(orderId: string, waiting: number, fire: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select id from orders where id = $1 for update", [orderId]);
    const running = fire();
    for (let i = 0; i < 150; i++) {
      const { rows } = await client.query<{ n: number }>("select count(distinct pid)::int as n from pg_locks where not granted");
      if (rows[0].n >= waiting) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await client.query("commit");
    return await running;
  } finally {
    await client.end();
  }
}

describe("dibatalkan pembeli (F4.6)", () => {
  const cancel = (id: string, who = b) => who.post(`/api/orders/${id}/cancel`);

  it("stok langsung dilepas; pesanan tidak lagi dikabari kedaluwarsa", async () => {
    const { lic, f, orderId } = await heldOrder();
    expect((await cancel(orderId).expect(200)).body).toEqual({ status: "DIBATALKAN" });
    expect(await status(orderId)).toBe("DIBATALKAN");
    expect(await reserved(f.id)).toBe(0);
    expect((await codes(lic.id)).every((c) => c.status === "available" && c.order_item_id === null)).toBe(true);
    ctx.clock.advance(DAY);
    await sweep();
    expect(await status(orderId)).toBe("DIBATALKAN");
    expect(await mails(EXPIRED_SUBJECT)).toEqual([]);
  });

  it("batal kedua dan status selain Menunggu Pembayaran ditolak; stok tidak dilepas dua kali", async () => {
    const { f, orderId } = await heldOrder();
    await cancel(orderId).expect(200);
    expect((await cancel(orderId).expect(409)).body).toMatchObject({ code: "CANCEL_NOT_ALLOWED", message: "Pesanan ini sudah tidak bisa dibatalkan." });
    expect(await reserved(f.id)).toBe(0);
    const other = await digitalOrder();
    await b.upload(`/api/orders/${other.orderId}/proof`, PDF, "application/pdf").expect(201);
    expect((await cancel(other.orderId).expect(409)).body.code).toBe("CANCEL_NOT_ALLOWED");
    expect(await status(other.orderId)).toBe("MENUNGGU_VERIFIKASI");
  });

  it("sudah lewat batas: ditolak dengan pesan kedaluwarsa", async () => {
    const { orderId } = await digitalOrder();
    ctx.clock.advance(DAY);
    expect((await cancel(orderId).expect(409)).body).toMatchObject({ code: "ORDER_EXPIRED" });
  });

  it("pembeli lain, admin, dan id ngawur: 404 yang sama", async () => {
    const { orderId } = await digitalOrder();
    const notFound = { code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." };
    expect((await cancel(orderId, api(ctx, await ctx.buyerCookie())).expect(404)).body).toEqual(notFound);
    expect((await cancel(orderId, a).expect(404)).body).toEqual(notFound);
    expect((await cancel("ngawur").expect(404)).body).toEqual(notFound);
    expect(await status(orderId)).toBe("MENUNGGU_PEMBAYARAN");
  });

  it("klik batal ganda bersamaan: satu berhasil, yang lain ditolak; stok dilepas tepat sekali", async () => {
    const { f, orderId } = await heldOrder();
    const results = await overlapped(orderId, 2, () => Promise.all([cancel(orderId), cancel(orderId)]));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await reserved(f.id)).toBe(0);
  });

  it("batal dan unggah bukti bersamaan: tepat satu menang, stok tidak dilepas bila bukti yang menang", async () => {
    const { f, orderId } = await heldOrder();
    const [c, u] = await overlapped(orderId, 2, () => Promise.all([cancel(orderId), b.upload(`/api/orders/${orderId}/proof`, PDF, "application/pdf")]));
    // tepat satu menang: batal (200) atau unggah (201); yang kalah 409
    expect([c.status, u.status].sort()).toEqual(c.status === 200 ? [200, 409] : [201, 409]);
    const s = await status(orderId);
    expect(s).toBe(c.status === 200 ? "DIBATALKAN" : "MENUNGGU_VERIFIKASI");
    expect(await reserved(f.id)).toBe(s === "DIBATALKAN" ? 0 : 2);
  });

  it("batal dan kedaluwarsa bersamaan: stok dilepas tepat sekali", async () => {
    const { f, orderId } = await heldOrder();
    ctx.clock.advance(DAY - 1);
    const [res] = await Promise.all([cancel(orderId), (async () => { ctx.clock.advance(1); return sweep(); })()]);
    expect([200, 409]).toContain(res.status);
    expect(["DIBATALKAN", "KEDALUWARSA"]).toContain(await status(orderId));
    expect(await reserved(f.id)).toBe(0);
  });
});

describe("penjadwalan (N25)", () => {
  it("tugas sapu terdaftar tiap menit dan menjalankan kedaluwarsa", async () => {
    const queue = createMemoryQueue();
    await registerOrderJobs(queue, { ...deps(), queue });
    expect(queue.schedules).toContainEqual({ name: "orders.sweep", cron: "* * * * *" });
    const { orderId } = await digitalOrder();
    ctx.clock.advance(DAY);
    await queue.send("orders.sweep", {});
    await queue.runAll();
    expect(await status(orderId)).toBe("KEDALUWARSA");
  });
});
