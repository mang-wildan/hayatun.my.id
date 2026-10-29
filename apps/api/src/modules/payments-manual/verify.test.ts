import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let adminCookie: string;
let a: ReturnType<typeof api>;
let b: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie();
  a = api(ctx, adminCookie);
  b = api(ctx, await ctx.buyerCookie());
});
afterEach(() => ctx.close());

const MIN = 60_000;
const DAY = 24 * 3600_000;
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(1500)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const ACCEPTED_SUBJECT = "Pembayaranmu sudah kami terima";
const REJECTED_SUBJECT = "Bukti bayarmu belum bisa diterima";
const PROCESSED = { code: "ALREADY_PROCESSED", message: "Pesanan ini sudah diproses admin lain." };

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const orderRow = async (id: string) => (await rows<Record<string, unknown>>(sql`select * from orders where id = ${id}`))[0];
const proofRows = async (id: string) => rows<{ status: string; reject_reason: string | null }>(sql`select status, reject_reason from payment_proofs where order_id = ${id} order by uploaded_at, id`);
const audit = async (action: string) => rows<{ actor_id: string; entity_type: string; entity_id: string; details: object }>(sql`select actor_id, entity_type, entity_id, details from audit_logs where action = ${action}`);
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);
const accept = (id: string, who = a) => who.post(`/api/admin/payments/${id}/accept`);
const reject = (id: string, reason?: string, who = a) => who.post(`/api/admin/payments/${id}/reject`, reason === undefined ? {} : { reason });

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, adminCookie, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
async function upload(orderId: string, who = b, file = PDF) {
  return who.upload(`/api/orders/${orderId}/proof`, file, "application/pdf").expect(201);
}

// pesanan digital Rp75.000 dengan bukti sudah diunggah
async function paidDigital(who = b) {
  const d = await publish({ name: "E-book", price: 75000 });
  await who.post("/api/cart/items", { productId: d.id }).expect(201);
  const o = (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await upload(o.orderId, who);
  return o;
}

// pesanan campuran: kode lisensi + 2 barang fisik; bukti sudah diunggah
async function paidMixed() {
  const lic = await publish({ name: "Aplikasi Kasir", price: 50000, isLicensed: true });
  await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "KODE-1\nKODE-2" }).expect(200);
  const f = await publish({ ...PHYSICAL, name: "Nastar", price: 120000, stockQty: 10 });
  await b.post("/api/cart/items", { productId: lic.id }).expect(201);
  await b.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await b.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const o = (await b.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 305000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await upload(o.orderId);
  return { lic, f, ...o };
}

// Memastikan permintaan benar-benar tumpang tindih: baris pesanan dikunci dari koneksi lain sampai semuanya tertahan
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

describe("antrean verifikasi (F5.1)", () => {
  it("hanya Menunggu Verifikasi, paling lama menunggu dulu, tanpa data pribadi selain yang perlu", async () => {
    const first = await paidDigital();
    ctx.clock.advance(10 * MIN);
    const second = await paidDigital(api(ctx, await ctx.buyerCookie()));
    ctx.clock.advance(10 * MIN);
    const third = await paidDigital(api(ctx, await ctx.buyerCookie()));
    await accept(second.orderId).expect(200); // sudah diproses: keluar dari antrean
    const res = (await a.get("/api/admin/payments").expect(200)).body;
    expect(res.items.map((i: { orderId: string }) => i.orderId)).toEqual([first.orderId, third.orderId]);
    expect(res.items[0]).toEqual({ orderId: first.orderId, invoiceNumber: first.invoiceNumber, buyerName: expect.any(String), total: 75000, uploadedAt: expect.any(String), mime: "application/pdf" });
    expect(JSON.stringify(res)).not.toMatch(/Pajajaran|0812|@hayatun\.test/);
  });

  it("antrean kosong: daftar kosong", async () => {
    expect((await a.get("/api/admin/payments").expect(200)).body).toEqual({ items: [] });
  });

  it("pesanan yang ditolak kembali menunggu pembayaran dan keluar dari antrean", async () => {
    const o = await paidDigital();
    await reject(o.orderId, "Nominal tidak sesuai").expect(200);
    expect((await a.get("/api/admin/payments").expect(200)).body.items).toEqual([]);
  });
});

describe("membuka bukti dicatat (N28, F15.3)", () => {
  it("isi file sama dengan yang diunggah, dengan header aman; pembukaan tercatat siapa, pesanan mana", async () => {
    const o = await paidDigital();
    const res = await a.get(`/api/admin/payments/${o.orderId}/proof`).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c)).on("end", () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    expect((res.body as Buffer).equals(PDF)).toBe(true);
    expect(res.headers).toMatchObject({ "content-type": "application/pdf", "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
    const [log, ...rest] = await audit("payment_proof.viewed");
    expect(rest).toEqual([]);
    expect(log).toMatchObject({ entity_type: "order", entity_id: o.orderId, details: {} }); // isi bukti tidak masuk log
    expect(log.actor_id).toBeTruthy();
  });

  it("setiap pembukaan tercatat, termasuk yang berulang", async () => {
    const o = await paidDigital();
    for (let i = 0; i < 3; i++) await a.get(`/api/admin/payments/${o.orderId}/proof`).expect(200);
    expect(await audit("payment_proof.viewed")).toHaveLength(3);
  });

  it("tidak ada bukti: 404 dan tidak ada catatan pembukaan", async () => {
    const d = await publish({ price: 75000 });
    await b.post("/api/cart/items", { productId: d.id }).expect(201);
    const o = (await b.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body;
    expect((await a.get(`/api/admin/payments/${o.orderId}/proof`).expect(404)).body).toMatchObject({ code: "PROOF_NOT_FOUND", message: "Bukti bayar tidak ditemukan." });
    expect((await a.get("/api/admin/payments/ngawur/proof").expect(404)).body.code).toBe("PROOF_NOT_FOUND");
    expect(await audit("payment_proof.viewed")).toEqual([]);
  });
});

describe("terima bukti (F5.2)", () => {
  it("pesanan Lunas; siapa dan kapan tercatat; bagian fisik Diproses; digital Terkirim; stok dan lisensi berpindah", async () => {
    const o = await paidMixed();
    ctx.clock.advance(5 * MIN);
    expect((await accept(o.orderId).expect(200)).body).toEqual({ status: "LUNAS" });
    const row = await orderRow(o.orderId);
    expect(row).toMatchObject({ status: "LUNAS", digital_status: "TERKIRIM", physical_status: "DIPROSES" });
    expect(row.verified_by).toBeTruthy();
    expect(new Date(row.paid_at as string).toISOString()).toBe(ctx.clock.now.toISOString());
    expect(await proofRows(o.orderId)).toEqual([{ status: "accepted", reject_reason: null }]);

    const [p] = await rows<{ stock_qty: number; stock_reserved: number; stock_sold: number }>(sql`select stock_qty, stock_reserved, stock_sold from products where id = ${o.f.id}`);
    expect(p).toEqual({ stock_qty: 8, stock_reserved: 0, stock_sold: 2 });
    const codes = await rows<{ status: string }>(sql`select status from license_codes where product_id = ${o.lic.id} order by status`);
    expect(codes.map((c) => c.status)).toEqual(["assigned", "available"]);
  });

  it("invoice menjadi Lunas dengan tanggal lunas; isi item dan nominal tidak berubah (F6.5)", async () => {
    const o = await paidDigital();
    const before = (await b.get(`/api/invoices/${o.orderId}`).expect(200)).body;
    expect(before).toMatchObject({ status: "Belum Lunas", paidAt: null });
    ctx.clock.advance(5 * MIN);
    await accept(o.orderId).expect(200);
    const after = (await b.get(`/api/invoices/${o.orderId}`).expect(200)).body;
    expect(after).toMatchObject({ status: "Lunas", paidAt: ctx.clock.now.toISOString() });
    expect({ ...after, status: before.status, paidAt: null }).toEqual(before);
  });

  it("tercatat di log aktivitas; email ke pembeli tanpa data sensitif", async () => {
    await ctx.db.execute(sql`insert into store_settings (key, value) values ('bankAccount', ${JSON.stringify({ bank: "BCA", number: "9876543210", holder: "Hayatun" })}::jsonb)`);
    const o = await paidDigital();
    await accept(o.orderId).expect(200);
    expect(await audit("payment.accepted")).toEqual([{ actor_id: expect.any(String), entity_type: "order", entity_id: o.orderId, details: {} }]);
    const [mail, ...rest] = await mails(ACCEPTED_SUBJECT);
    expect(rest).toEqual([]);
    expect(mail.text).toContain(o.invoiceNumber);
    expect(mail.text).not.toContain("9876543210");
  });

  it("pesanan yang tidak menunggu verifikasi: 409; tidak ada perubahan ganda", async () => {
    const o = await paidDigital();
    await accept(o.orderId).expect(200);
    expect((await accept(o.orderId).expect(409)).body).toMatchObject(PROCESSED);
    expect(await mails(ACCEPTED_SUBJECT)).toHaveLength(1);
    expect(await audit("payment.accepted")).toHaveLength(1);
  });

  it("pesanan tidak ada atau id ngawur: 404", async () => {
    const notFound = { code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." };
    expect((await accept("00000000-0000-0000-0000-000000000000").expect(404)).body).toMatchObject(notFound);
    expect((await accept("ngawur").expect(404)).body).toMatchObject(notFound);
  });
});

describe("tolak bukti (F5.3, F5.4, F5.5, F5.7)", () => {
  it("alasan wajib: kosong, spasi, atau terlalu panjang ditolak dan tidak ada yang tersimpan", async () => {
    const o = await paidDigital();
    expect((await reject(o.orderId).expect(422)).body.fields.reason).toBe("Alasan penolakan wajib diisi.");
    expect((await reject(o.orderId, "   ").expect(422)).body.fields.reason).toBe("Alasan penolakan wajib diisi.");
    expect((await reject(o.orderId, "x".repeat(501)).expect(422)).body.fields.reason).toBe("Alasan maksimal 500 karakter.");
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_VERIFIKASI");
    expect(await proofRows(o.orderId)).toEqual([{ status: "pending", reject_reason: null }]);
    expect(await mails(REJECTED_SUBJECT)).toEqual([]);
  });

  it("sebelum batas 24 jam: status kembali, batas tidak berubah, pembeli bisa unggah ulang", async () => {
    const o = await paidDigital();
    const expiresAt = (await orderRow(o.orderId)).expires_at as string;
    ctx.clock.advance(2 * 3600_000);
    const res = await reject(o.orderId, "Nominal tidak sesuai").expect(200);
    expect(res.body).toEqual({ status: "MENUNGGU_PEMBAYARAN", expiresAt: new Date(expiresAt).toISOString() });
    expect(await proofRows(o.orderId)).toEqual([{ status: "rejected", reject_reason: "Nominal tidak sesuai" }]);
    await upload(o.orderId); // F5.4
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_VERIFIKASI");
    expect((await proofRows(o.orderId)).map((p) => p.status)).toEqual(["rejected", "pending"]);
  });

  it("setelah batas 24 jam lewat: tambahan 24 jam sejak penolakan (F5.5), dan unggah ulang berhasil", async () => {
    const o = await paidDigital();
    ctx.clock.advance(DAY + 3600_000); // verifikasi lambat: batas sudah lewat
    const res = await reject(o.orderId, "Foto buram").expect(200);
    expect(res.body.expiresAt).toBe(new Date(ctx.clock.now.getTime() + DAY).toISOString());
    ctx.clock.advance(DAY - 1);
    await upload(o.orderId);
  });

  it("tepat di batas 24 jam sudah dianggap lewat; 1 ms sebelumnya belum", async () => {
    const before = await paidDigital();
    const expiresAt = new Date((await orderRow(before.orderId)).expires_at as string);
    ctx.clock.now = new Date(expiresAt.getTime() - 1);
    expect((await reject(before.orderId, "Alasan").expect(200)).body.expiresAt).toBe(expiresAt.toISOString());

    const exact = await paidDigital(api(ctx, await ctx.buyerCookie()));
    const exactExpires = new Date((await orderRow(exact.orderId)).expires_at as string);
    ctx.clock.now = exactExpires;
    expect((await reject(exact.orderId, "Alasan").expect(200)).body.expiresAt).toBe(new Date(exactExpires.getTime() + DAY).toISOString());
  });

  it("pengingat 3 jam diatur ulang supaya batas yang baru bisa diingatkan lagi", async () => {
    const o = await paidDigital();
    await ctx.db.execute(sql`update orders set reminder_sent_at = now() where id = ${o.orderId}`);
    await reject(o.orderId, "Foto buram").expect(200);
    expect((await orderRow(o.orderId)).reminder_sent_at).toBeNull();
  });

  it("alasan tampil ke pembeli di instruksi bayar sampai ia mengunggah ulang; email memuat alasan", async () => {
    const o = await paidDigital();
    ctx.clock.advance(MIN);
    await reject(o.orderId, "Nominal tidak sesuai").expect(200);
    expect((await b.get(`/api/orders/${o.orderId}/payment`).expect(200)).body).toMatchObject({
      canUploadProof: true,
      lastRejection: { reason: "Nominal tidak sesuai", at: ctx.clock.now.toISOString() },
    });
    const [mail, ...rest] = await mails(REJECTED_SUBJECT);
    expect(rest).toEqual([]);
    expect(mail.text).toContain("Nominal tidak sesuai");
    expect(mail.text).toContain(o.invoiceNumber);
    await upload(o.orderId);
    expect((await b.get(`/api/orders/${o.orderId}/payment`).expect(200)).body.lastRejection).toBeNull();
  });

  it("tanpa penolakan: lastRejection null", async () => {
    const o = await paidDigital();
    expect((await b.get(`/api/orders/${o.orderId}/payment`).expect(200)).body.lastRejection).toBeNull();
  });

  it("stok dan lisensi tetap ditahan saat ditolak (pembeli masih bisa membayar)", async () => {
    const o = await paidMixed();
    await reject(o.orderId, "Foto buram").expect(200);
    const [p] = await rows<{ stock_qty: number; stock_reserved: number; stock_sold: number }>(sql`select stock_qty, stock_reserved, stock_sold from products where id = ${o.f.id}`);
    expect(p).toEqual({ stock_qty: 10, stock_reserved: 2, stock_sold: 0 });
  });

  it("tercatat di log aktivitas tanpa isi alasan; sudah diproses: 409", async () => {
    const o = await paidDigital();
    await reject(o.orderId, "Foto buram").expect(200);
    expect(await audit("payment.rejected")).toEqual([{ actor_id: expect.any(String), entity_type: "order", entity_id: o.orderId, details: {} }]);
    expect((await reject(o.orderId, "Lagi").expect(409)).body).toMatchObject(PROCESSED);
  });
});

describe("dua admin bersamaan (F5.6, N24)", () => {
  it("terima bersamaan: tepat satu menang; stok dan lisensi berpindah sekali; satu email", async () => {
    const o = await paidMixed();
    const second = api(ctx, await ctx.adminCookie());
    const results = await overlapped(o.orderId, 2, () => Promise.all([accept(o.orderId), accept(o.orderId, second)]));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body).toMatchObject(PROCESSED);
    const [p] = await rows<{ stock_qty: number; stock_reserved: number; stock_sold: number }>(sql`select stock_qty, stock_reserved, stock_sold from products where id = ${o.f.id}`);
    expect(p).toEqual({ stock_qty: 8, stock_reserved: 0, stock_sold: 2 });
    expect(await mails(ACCEPTED_SUBJECT)).toHaveLength(1);
    expect(await audit("payment.accepted")).toHaveLength(1);
  });

  it("terima dan tolak bersamaan: tepat satu menang", async () => {
    const o = await paidMixed();
    const second = api(ctx, await ctx.adminCookie());
    const [x, y] = await overlapped(o.orderId, 2, () => Promise.all([accept(o.orderId), reject(o.orderId, "Foto buram", second)]));
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const status = (await orderRow(o.orderId)).status;
    expect(status).toBe(x.status === 200 ? "LUNAS" : "MENUNGGU_PEMBAYARAN");
    expect(await audit("payment.accepted")).toHaveLength(x.status === 200 ? 1 : 0);
    expect(await audit("payment.rejected")).toHaveLength(x.status === 200 ? 0 : 1);
  });
});

describe("akses", () => {
  it("semua rute: tanpa login 401, pembeli 403", async () => {
    const o = await paidDigital();
    for (const [method, path, body] of [
      ["get", "/api/admin/payments", undefined],
      ["get", `/api/admin/payments/${o.orderId}/proof`, undefined],
      ["post", `/api/admin/payments/${o.orderId}/accept`, {}],
      ["post", `/api/admin/payments/${o.orderId}/reject`, { reason: "x" }],
    ] as const) {
      const anon = await request(ctx.app)[method](path).send(body);
      expect(anon.status, `${method} ${path}`).toBe(401);
      const buyer = method === "get" ? await b.get(path) : await b.post(path, body);
      expect(buyer.status, `${method} ${path}`).toBe(403);
    }
    expect((await orderRow(o.orderId)).status).toBe("MENUNGGU_VERIFIKASI");
    expect(await audit("payment_proof.viewed")).toEqual([]); // pembeli tidak bisa membuka bukti
  });
});
