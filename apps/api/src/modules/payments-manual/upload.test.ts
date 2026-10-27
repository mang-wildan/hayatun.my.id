import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { JPG, MB, PNG, api, filesOnDisk, makeProduct } from "../../test/products.js";

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
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2000)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), randomBytes(64)]);
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");
const FILE_TYPE = { code: "FILE_TYPE", message: "Jenis file tidak didukung. Pakai JPG, PNG, atau PDF ya." };
const TOO_LARGE = { code: "FILE_TOO_LARGE", message: "Filenya kebesaran nih, maksimal 5 MB ya. Coba kecilkan dulu." };
const EXPIRED = { code: "ORDER_EXPIRED", message: "Batas waktu pembayaran pesanan ini sudah lewat. Silakan checkout ulang ya." };

async function order(who = b) {
  const d = await makeProduct(ctx, admin, { name: "E-book", price: 75000 });
  await a.post(`/api/admin/products/${d.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${d.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: d.id }).expect(201);
  return (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body.orderId as string;
}
const upload = (id: string, data: Buffer, type = "application/octet-stream", who = b) => who.upload(`/api/orders/${id}/proof`, data, type);
const status = async (id: string) => ((await ctx.db.execute(sql`select status from orders where id = ${id}`)).rows[0] as { status: string }).status;
const proofs = async (id: string) => (await ctx.db.execute(sql`select storage_key, mime, size_bytes, status from payment_proofs where order_id = ${id}`)).rows as { storage_key: string; mime: string; size_bytes: number; status: string }[];

describe("unggah bukti (F4.3)", () => {
  it.each([["JPG", JPG, "image/jpeg"], ["PNG", PNG, "image/png"], ["PDF", PDF, "application/pdf"]])("%s diterima: status menjadi Menunggu Verifikasi", async (_label, file, mime) => {
    const id = await order();
    const res = await upload(id, file, mime).expect(201);
    expect(res.body).toEqual({ proofId: expect.any(String), status: "MENUNGGU_VERIFIKASI" });
    expect(await status(id)).toBe("MENUNGGU_VERIFIKASI");
    expect(await proofs(id)).toEqual([{ storage_key: expect.stringMatching(/^proofs\//), mime, size_bytes: file.length, status: "pending" }]);
    expect((await b.get(`/api/orders/${id}/payment`).expect(200)).body.canUploadProof).toBe(false);
  });

  it("jenis dari isi file, bukan dari Content-Type kiriman", async () => {
    const id = await order();
    await upload(id, PDF, "image/png").expect(201);
    expect((await proofs(id))[0].mime).toBe("application/pdf");
  });

  it("file di disk terenkripsi dan bisa dibuka kembali hanya dengan kunci (N2)", async () => {
    const id = await order();
    await upload(id, PDF, "application/pdf").expect(201);
    const [p] = await proofs(id);
    const stored = await ctx.storage.read(p.storage_key);
    expect(stored.equals(PDF)).toBe(false);
    expect(stored.includes(Buffer.from("%PDF"))).toBe(false);
    expect(ctx.crypto.decryptBuffer(stored).equals(PDF)).toBe(true);
    expect(p.storage_key).not.toContain(".pdf"); // nama file tidak membocorkan jenis atau nama asli
  });

  it("5 MB tepat masih diterima, dan diproses jauh di bawah 10 detik (N21)", async () => {
    const id = await order();
    const file = Buffer.concat([PDF, randomBytes(5 * MB - PDF.length)]);
    const t = performance.now();
    await upload(id, file, "application/pdf").expect(201);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe("file ditolak dengan alasannya; status pesanan tidak berubah (F4.7)", () => {
  it.each([
    ["HTML yang mengaku JPG", HTML, "image/jpeg", FILE_TYPE],
    ["WebP (bukan jenis yang diizinkan)", WEBP, "image/webp", FILE_TYPE],
    ["file kosong", Buffer.alloc(0), "application/pdf", FILE_TYPE],
    ["5 MB + 1 byte", Buffer.concat([PDF, randomBytes(5 * MB + 1 - PDF.length)]), "application/pdf", TOO_LARGE],
  ])("%s", async (_label, file, mime, error) => {
    const id = await order();
    expect((await upload(id, file, mime).expect(422)).body).toMatchObject(error);
    expect(await status(id)).toBe("MENUNGGU_PEMBAYARAN");
    expect(await proofs(id)).toEqual([]);
    expect(await filesOnDisk(ctx, "proofs")).toEqual([]);
  });
});

describe("batas waktu (F4.8)", () => {
  it("1 ms sebelum batas 24 jam masih diterima", async () => {
    const id = await order();
    ctx.clock.advance(DAY - 1);
    await upload(id, PDF, "application/pdf").expect(201);
  });

  it("tepat 24 jam: ditolak walau tugas kedaluwarsa belum mengubah statusnya; file tidak disimpan", async () => {
    const id = await order();
    ctx.clock.advance(DAY);
    expect((await upload(id, PDF, "application/pdf").expect(409)).body).toMatchObject(EXPIRED);
    expect(await status(id)).toBe("MENUNGGU_PEMBAYARAN");
    expect(await filesOnDisk(ctx, "proofs")).toEqual([]);
  });

  it("pesanan Kedaluwarsa: ditolak dengan saran checkout ulang", async () => {
    const id = await order();
    await ctx.db.execute(sql`update orders set status = 'KEDALUWARSA' where id = ${id}`);
    expect((await upload(id, PDF, "application/pdf").expect(409)).body).toMatchObject(EXPIRED);
  });
});

describe("status lain tidak menerima bukti", () => {
  it.each(["MENUNGGU_VERIFIKASI", "LUNAS", "DIBATALKAN", "DIKEMBALIKAN"])("%s ditolak dan status tetap", async (s) => {
    const id = await order();
    await ctx.db.execute(sql`update orders set status = ${s} where id = ${id}`);
    expect((await upload(id, PDF, "application/pdf").expect(409)).body).toMatchObject({ code: "PROOF_NOT_ALLOWED", message: "Pesanan ini tidak sedang menunggu bukti bayar." });
    expect(await status(id)).toBe(s);
    expect(await proofs(id)).toEqual([]);
  });
});

describe("dua unggahan bersamaan", () => {
  it("tepat satu diterima; file pihak yang kalah tidak tertinggal di disk", async () => {
    const id = await order();
    // baris pesanan dikunci dari koneksi lain sampai kedua permintaan tertahan, supaya benar-benar tumpang tindih
    const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select id from orders where id = $1 for update", [id]);
      const running = Promise.all([upload(id, PDF, "application/pdf"), upload(id, JPG, "image/jpeg")]);
      for (let i = 0; i < 150; i++) {
        const { rows } = await client.query<{ n: number }>("select count(distinct pid)::int as n from pg_locks where not granted");
        if (rows[0].n >= 2) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await client.query("commit");
      const results = await running;
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe("PROOF_NOT_ALLOWED");
    } finally {
      await client.end();
    }
    expect(await proofs(id)).toHaveLength(1);
    expect(await filesOnDisk(ctx, "proofs")).toHaveLength(1);
  });
});

describe("akses", () => {
  it("tanpa login: 401", async () => {
    const id = await order();
    const res = await request(ctx.app).post(`/api/orders/${id}/proof`).set("Content-Type", "application/pdf").send(PDF);
    expect(res.status).toBe(401);
  });

  it("pembeli lain, admin, id tidak ada, dan id ngawur: 404 yang sama; tidak ada file tersimpan", async () => {
    const id = await order();
    const other = api(ctx, await ctx.buyerCookie());
    const notFound = { code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan." };
    expect((await upload(id, PDF, "application/pdf", other).expect(404)).body).toEqual(notFound);
    expect((await upload(id, PDF, "application/pdf", a).expect(404)).body).toEqual(notFound); // admin tidak mengunggah atas nama pembeli
    expect((await upload("00000000-0000-0000-0000-000000000000", PDF, "application/pdf").expect(404)).body).toEqual(notFound);
    expect((await upload("ngawur", PDF, "application/pdf").expect(404)).body).toEqual(notFound);
    expect(await status(id)).toBe("MENUNGGU_PEMBAYARAN");
    expect(await filesOnDisk(ctx, "proofs")).toEqual([]);
  });
});
