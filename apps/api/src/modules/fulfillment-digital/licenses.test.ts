import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { renderEmail } from "../notifications/templates.js";

const ACCEPTED = "Pembayaranmu sudah kami terima";
const PENDING = "Lisensi tertunda, stok kode perlu ditambah";
const DELIVERED = "Kode lisensimu sudah tersedia";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(500)]);
const MIN = 60_000;

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
let rina: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie(); // admin1@hayatun.test
  admin = api(ctx, adminCookie);
  await ctx.createUser({ email: "admin-dua@hayatun.test", password: "rahasia-hayatun-1", role: "admin", name: "Dewi" });
  await ctx.createUser({ email: "admin-mati@hayatun.test", password: "rahasia-hayatun-1", role: "admin", status: "disabled" });
  siti = await buyer("siti@hayatun.test", "Siti Aminah");
  rina = await buyer("rina@hayatun.test", "Rina Marlina");
});
afterEach(() => ctx.close());

async function buyer(email: string, name: string) {
  const id = await ctx.createUser({ email, password: "rahasia-hayatun-1", name });
  return api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
}
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const mails = async (to: string, subject: string) => (await ctx.emails()).filter((m) => m.to === to && m.subject === subject);
const orderRow = async (id: string) => (await rows<{ status: string; digital_status: string }>(sql`select status, digital_status from orders where id = ${id}`))[0];
const codeRows = async (productId: string) => rows<{ status: string; order_item_id: string | null; assigned_at: string | null }>(sql`select status, order_item_id, assigned_at from license_codes where product_id = ${productId} order by id`);
const accept = (id: string, who = admin) => who.post(`/api/admin/payments/${id}/accept`);
const addCodes = (productId: string, codes: string, who = admin) => who.post(`/api/admin/products/${productId}/licenses`, { codes });
const licenses = (id: string, who = siti) => who.get(`/api/orders/${id}/licenses`);
// menghapus n kode yang ditahan suatu produk: meniru kode yang hilang (jaring pengaman F7.7)
const dropReserved = (productId: string, n: number) => ctx.db.execute(sql`delete from license_codes where id in (select id from license_codes where product_id = ${productId} and status = 'reserved' order by id limit ${n})`);

async function product(over: Record<string, unknown> = {}, codes?: string) {
  const p = await makeProduct(ctx, adminCookie, { name: "Aplikasi Kasir", price: 50000, isLicensed: true, ...over });
  if (p.type === "digital") await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  if (codes) await addCodes(p.id, codes).expect(200);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
// pesanan berlisensi dengan bukti sudah diunggah, siap diterima
async function order(who: ReturnType<typeof api>, p: { id: string }, qty = 1, price = 50000) {
  await who.post("/api/cart/items", { productId: p.id, qty }).expect(201);
  const o = (await who.post("/api/checkout", { expectedTotal: price * qty }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await who.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  return o;
}

// beberapa produk berlisensi dalam satu pesanan; produk digital hanya boleh satu per baris, jadi "beberapa unit" berarti beberapa baris
async function orderMany(who: ReturnType<typeof api>, ps: { id: string }[], price = 50000) {
  for (const p of ps) await who.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await who.post("/api/checkout", { expectedTotal: price * ps.length }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await who.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  return o;
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

describe("penetapan saat lunas (F7.1)", () => {
  it("tepat satu kode untuk setiap unit: tiap produk dalam pesanan mendapat satu kode miliknya sendiri, sisa stok utuh", async () => {
    const a = await product({ name: "Aplikasi Kasir" }, "A-1\nA-2\nA-3");
    const b = await product({ name: "Aplikasi Stok" }, "B-1\nB-2");
    const o = await orderMany(siti, [a, b]);
    await accept(o.orderId).expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "LUNAS", digital_status: "TERKIRIM" });
    for (const [prod, left] of [[a, 2], [b, 1]] as const) {
      const codes = await codeRows(prod.id);
      expect(codes.filter((c) => c.status === "assigned")).toHaveLength(1);
      expect(codes.filter((c) => c.status === "available")).toHaveLength(left);
      expect(codes.filter((c) => c.status === "assigned").every((c) => c.assigned_at && c.order_item_id)).toBe(true);
    }
    const res = (await licenses(o.orderId).expect(200)).body;
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i: { name: string }) => i.name).sort()).toEqual(["Aplikasi Kasir", "Aplikasi Stok"]);
    for (const i of res.items) expect(i).toEqual({ name: i.name, codes: [expect.any(String)], missing: 0 });
    expect(res.items.find((i: { name: string }) => i.name === "Aplikasi Kasir").codes[0]).toMatch(/^A-/);
    expect(res.items.find((i: { name: string }) => i.name === "Aplikasi Stok").codes[0]).toMatch(/^B-/);
  });

  it("satu item dengan lebih dari satu unit (data langsung; checkout digital hanya 1): tiap unit satu kode berbeda", async () => {
    const p = await product({}, "KODE-1\nKODE-2\nKODE-3");
    const o = await order(siti, p);
    await ctx.db.execute(sql`update order_items set qty = 2 where order_id = ${o.orderId}`);
    await accept(o.orderId).expect(200);
    const codes = (await licenses(o.orderId).expect(200)).body.items[0];
    expect(codes.codes).toHaveLength(2);
    expect(new Set(codes.codes).size).toBe(2);
    expect(codes.missing).toBe(0);
    expect((await codeRows(p.id)).filter((c) => c.status === "available")).toHaveLength(1);
  });

  it("email Lunas ke pembeli memuat kode yang ditetapkan (F7.5)", async () => {
    const p = await product({}, "KODE-AAA\nKODE-BBB");
    const o = await order(siti, p);
    await accept(o.orderId).expect(200);
    const [m] = await mails("siti@hayatun.test", ACCEPTED);
    const [code] = (await licenses(o.orderId).expect(200)).body.items[0].codes;
    expect(m.text).toContain("Aplikasi Kasir");
    expect(m.text).toContain(code);
    expect(m.text).not.toMatch(/menyusul/);
    expect((await ctx.emails()).filter((x) => x.subject === PENDING)).toHaveLength(0);
  });

  it("produk digital tanpa lisensi: tidak ada kode, daftar lisensi kosong", async () => {
    const p = await product({ isLicensed: false });
    const o = await order(siti, p);
    await accept(o.orderId).expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
    expect((await licenses(o.orderId).expect(200)).body).toEqual({ items: [] });
  });

  it("dua pesanan diterima bersamaan: tidak ada kode dipakai dua kali, kode lebih tidak tersentuh", async () => {
    const p = await product({}, "K1\nK2\nK3");
    const [a, b] = [await order(siti, p), await order(rina, p)];
    const [ra, rb] = await Promise.all([accept(a.orderId), accept(b.orderId, api(ctx, adminCookie))]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const mine = (await licenses(a.orderId).expect(200)).body.items[0].codes as string[];
    const theirs = (await licenses(b.orderId, rina).expect(200)).body.items[0].codes as string[];
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0]).not.toBe(theirs[0]);
    expect((await codeRows(p.id)).filter((c) => c.status === "available")).toHaveLength(1);
  });
});

describe("stok kode kosong saat penetapan (F7.7)", () => {
  it("tetap Lunas, item ditandai tertunda, admin aktif dikabari, pembeli menerima kode yang ada dan kabar menyusul", async () => {
    const a = await product({ name: "Aplikasi Kasir" }, "KODE-1");
    const b = await product({ name: "Aplikasi Stok" }, "B-1");
    const o = await orderMany(siti, [a, b]);
    await dropReserved(a.id, 1);
    await accept(o.orderId).expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "LUNAS", digital_status: "LISENSI_TERTUNDA" });
    const res = (await licenses(o.orderId).expect(200)).body;
    expect(res.items.find((i: { name: string }) => i.name === "Aplikasi Kasir")).toEqual({ name: "Aplikasi Kasir", codes: [], missing: 1 });
    expect(res.items.find((i: { name: string }) => i.name === "Aplikasi Stok")).toEqual({ name: "Aplikasi Stok", codes: ["B-1"], missing: 0 });

    const all = await ctx.emails();
    const pending = all.filter((m) => m.subject === PENDING);
    expect(pending.map((m) => m.to).sort()).toEqual(["admin-dua@hayatun.test", "admin1@hayatun.test"]);
    for (const m of pending) {
      expect(m.text).toContain(o.invoiceNumber);
      expect(m.text).toContain("Aplikasi Kasir");
      expect(m.text).toMatch(/kurang 1|1 kode/);
      expect(m.text).toContain(`${APP_URL}/admin/produk/${a.id}`);
      expect(m.text + m.html).not.toMatch(/Siti|Aminah|siti@|KODE-|B-1/);
    }
    expect(pending).toHaveLength(2); // hanya untuk produk yang kurang
    const [lunas] = await mails("siti@hayatun.test", ACCEPTED);
    expect(lunas.text).toContain("B-1");
    expect(lunas.text).toContain("menyusul");
    expect(all.filter((m) => m.to === "siti@hayatun.test" && m.subject === PENDING)).toHaveLength(0);
  });

  it("kekurangan ditutup dulu dari kode tersedia milik produk yang sama, tanpa menandai tertunda", async () => {
    const p = await product({}, "KODE-1\nCADANGAN");
    const o = await order(siti, p);
    await dropReserved(p.id, 1);
    await accept(o.orderId).expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
    expect((await licenses(o.orderId).expect(200)).body.items[0]).toEqual({ name: "Aplikasi Kasir", codes: ["CADANGAN"], missing: 0 });
    expect((await ctx.emails()).filter((m) => m.subject === PENDING)).toHaveLength(0);
  });

  it("admin menambah kode: pembeli menerima semua kodenya lewat email, status Terkirim, tepat sekali", async () => {
    const a = await product({ name: "Aplikasi Kasir" }, "KODE-1");
    const b = await product({ name: "Aplikasi Stok" }, "B-1");
    const o = await orderMany(siti, [a, b]);
    await dropReserved(a.id, 1);
    await accept(o.orderId).expect(200);

    await addCodes(a.id, "BARU-1").expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "LUNAS", digital_status: "TERKIRIM" });
    const res = (await licenses(o.orderId).expect(200)).body.items;
    expect(res.find((i: { name: string }) => i.name === "Aplikasi Kasir")).toEqual({ name: "Aplikasi Kasir", codes: ["BARU-1"], missing: 0 });
    const delivered = await mails("siti@hayatun.test", DELIVERED);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].text).toContain(o.invoiceNumber);
    expect(delivered[0].text).toContain("BARU-1");
    expect(delivered[0].text).toContain("B-1"); // kode lengkap, termasuk yang sudah dikirim lebih dulu
    expect(delivered[0].text).toContain(`${APP_URL}/pesanan/${o.orderId}`);

    await addCodes(a.id, "BARU-2").expect(200); // tidak ada lagi yang menunggu
    expect(await mails("siti@hayatun.test", DELIVERED)).toHaveLength(1);
    expect((await codeRows(a.id)).filter((c) => c.status === "available")).toHaveLength(1);
  });

  it("kurang di lebih dari satu produk: ditetapkan sebagian, baru Terkirim dan diemail saat semuanya lengkap", async () => {
    const a = await product({ name: "Aplikasi Kasir" }, "KODE-1");
    const b = await product({ name: "Aplikasi Stok" }, "B-1");
    const o = await orderMany(siti, [a, b]);
    await dropReserved(a.id, 1);
    await dropReserved(b.id, 1);
    await accept(o.orderId).expect(200);
    expect(((await ctx.emails()).filter((m) => m.subject === PENDING))).toHaveLength(4); // dua produk x dua admin

    await addCodes(a.id, "BARU-A").expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ digital_status: "LISENSI_TERTUNDA" });
    const half = (await licenses(o.orderId).expect(200)).body.items;
    expect(half.find((i: { name: string }) => i.name === "Aplikasi Kasir")).toMatchObject({ codes: ["BARU-A"], missing: 0 });
    expect(half.find((i: { name: string }) => i.name === "Aplikasi Stok")).toMatchObject({ codes: [], missing: 1 });
    expect(await mails("siti@hayatun.test", DELIVERED)).toHaveLength(0);

    await addCodes(b.id, "BARU-B").expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
    expect(await mails("siti@hayatun.test", DELIVERED)).toHaveLength(1);
  });

  it("beberapa pesanan menunggu: yang paling lama dibayar mendapat kode lebih dulu", async () => {
    const p = await product({}, "K1\nK2");
    const first = await order(siti, p);
    const second = await order(rina, p);
    await dropReserved(p.id, 2);
    await accept(second.orderId).expect(200); // dibayar lebih dulu walau dipesan belakangan
    ctx.clock.advance(5 * MIN);
    admin = api(ctx, await ctx.adminCookie());
    await accept(first.orderId).expect(200);

    await addCodes(p.id, "BARU-1").expect(200);
    expect(await orderRow(second.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
    expect(await orderRow(first.orderId)).toMatchObject({ digital_status: "LISENSI_TERTUNDA" });
    await addCodes(p.id, "BARU-2").expect(200);
    expect(await orderRow(first.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
  });

  it("dua penambahan kode bersamaan untuk satu pesanan tertunda: ditetapkan sekali, satu email, kode lain tetap tersedia", async () => {
    const p = await product({}, "KODE-1");
    const o = await order(siti, p);
    await dropReserved(p.id, 1);
    await accept(o.orderId).expect(200);
    const [x, y] = await overlapped(o.orderId, 2, () => Promise.all([addCodes(p.id, "BARU-A"), addCodes(p.id, "BARU-B", api(ctx, adminCookie))]));
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(await orderRow(o.orderId)).toMatchObject({ digital_status: "TERKIRIM" });
    expect((await licenses(o.orderId).expect(200)).body.items[0].codes).toHaveLength(1);
    expect((await codeRows(p.id)).filter((c) => c.status === "assigned")).toHaveLength(1);
    expect((await codeRows(p.id)).filter((c) => c.status === "available")).toHaveLength(1);
    expect(await mails("siti@hayatun.test", DELIVERED)).toHaveLength(1);
  });

  it("antrean email mati: pesanan tetap Lunas dan kode tetap ditetapkan (F11.4)", async () => {
    const p = await product({}, "KODE-1");
    const o = await order(siti, p);
    await dropReserved(p.id, 1);
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await accept(o.orderId).expect(200);
    await addCodes(p.id, "BARU-1").expect(200);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "LUNAS", digital_status: "TERKIRIM" });
  });
});

describe("API kode lisensi pembeli (F7.5)", () => {
  it("hanya pemilik pesanan, hanya pesanan Lunas, dan harus masuk", async () => {
    const p = await product({}, "KODE-1");
    const o = await order(siti, p);
    await licenses(o.orderId, rina).expect(404); // bukan pemiliknya
    await licenses(o.orderId, admin).expect(404); // admin pun bukan pemilik
    await request(ctx.app).get(`/api/orders/${o.orderId}/licenses`).expect(401);
    expect((await licenses(o.orderId).expect(409)).body).toMatchObject({ code: "NOT_PAID" }); // masih menunggu verifikasi
    await accept(o.orderId).expect(200);
    await licenses(o.orderId).expect(200);
    await licenses("bukan-uuid").expect(404);
  });

  it("kode tidak bocor ke respons lain dan tanpa cache", async () => {
    const p = await product({}, "RAHASIA-KODE-1");
    const o = await order(siti, p);
    await accept(o.orderId).expect(200);
    const res = await licenses(o.orderId).expect(200);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    for (const path of [`/api/orders/${o.orderId}/payment`, `/api/invoices/${o.orderId}`]) {
      const r = await siti.get(path).expect(200);
      expect(JSON.stringify(r.body)).not.toContain("RAHASIA-KODE-1");
    }
    expect(JSON.stringify((await admin.get("/api/admin/payments")).body)).not.toContain("RAHASIA-KODE-1");
  });
});

describe("templat email lisensi", () => {
  const link = `${APP_URL}/pesanan/abc`;
  it("payment_accepted memuat kode dan di-escape; menyebut menyusul bila ada yang kurang", () => {
    const e = renderEmail("payment_accepted", { name: "Siti", invoiceNumber: "INV/1", link, licenses: [{ name: `<b>App</b>`, codes: ["AAA-111", "BBB-222"], missing: 1 }] });
    expect(e.text).toContain("AAA-111");
    expect(e.text).toContain("BBB-222");
    expect(e.text).toContain("menyusul");
    expect(e.html).not.toContain("<b>App</b>");
    expect(renderEmail("payment_accepted", { name: "Siti", invoiceNumber: "INV/1", link }).text).not.toMatch(/lisensi/i); // tanpa lisensi: tidak berubah
  });
  it("license_delivered dan license_pending: subjek tetap, data wajib", () => {
    const d = renderEmail("license_delivered", { name: "Siti", invoiceNumber: "INV/1", link, licenses: [{ name: "App", codes: ["AAA-111"] }] });
    expect(d.subject).toBe(DELIVERED);
    expect(d.text).toContain("AAA-111");
    const p = renderEmail("license_pending", { name: "Dewi", invoiceNumber: "INV/1", productName: "App", missing: 2, link });
    expect(p.subject).toBe(PENDING);
    expect(p.text).toMatch(/kurang 2/);
    expect(() => renderEmail("license_delivered", { name: "Siti", invoiceNumber: "INV/1", link })).toThrow(/licenses/);
    expect(() => renderEmail("license_pending", { name: "Dewi", invoiceNumber: "INV/1", link })).toThrow(/productName|missing/);
    expect((d.text + p.text + d.html + p.html)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
