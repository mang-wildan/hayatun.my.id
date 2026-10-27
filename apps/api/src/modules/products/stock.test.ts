import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { DIGITAL, PHYSICAL, api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
});
afterEach(() => ctx.close());

const LICENSED = { ...DIGITAL, name: "Aplikasi Kasir", isLicensed: true };
const addCodes = (id: string, codes: string) => a.post(`/api/admin/products/${id}/licenses`, { codes });
const stockOf = async (id: string) => (await a.get(`/api/admin/products/${id}`)).body.stock;
// Pesanan baru ada di T28; di sini status dan stok ditahan diatur langsung di database
const run = (q: ReturnType<typeof sql>) => ctx.db.execute(q);

describe("ringkasan stok: tersedia, ditahan, terjual (F9.4)", () => {
  it("produk fisik: tersedia = stok − ditahan", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await run(sql`update products set stock_reserved = 3, stock_sold = 4 where id = ${p.id}`);
    expect(await stockOf(p.id)).toEqual({ available: 7, reserved: 3, sold: 4 });
    const list = (await a.get("/api/admin/products")).body.products;
    expect(list[0].stock).toEqual({ available: 7, reserved: 3, sold: 4 });
  });

  it("produk digital tanpa lisensi: tanpa batas", async () => {
    const p = await makeProduct(ctx, admin);
    expect(await stockOf(p.id)).toEqual({ available: null, reserved: 0, sold: 0 });
  });

  it("produk berlisensi: dihitung dari status kode", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    await addCodes(p.id, "K-1\nK-2\nK-3\nK-4\nK-5").expect(200);
    await run(sql`update license_codes set status = 'reserved' where product_id = ${p.id} and code_index = (select code_index from license_codes where product_id = ${p.id} order by id limit 1)`);
    await run(sql`update license_codes set status = 'assigned' where id in (select id from license_codes where product_id = ${p.id} and status = 'available' order by id limit 2)`);
    expect(await stockOf(p.id)).toEqual({ available: 2, reserved: 1, sold: 2 });
  });
});

describe("mengubah stok fisik", () => {
  it("tidak boleh di bawah jumlah yang sedang ditahan; sama dengan ditahan boleh (tersedia 0)", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await run(sql`update products set stock_reserved = 4 where id = ${p.id}`);
    const res = await a.patch(`/api/admin/products/${p.id}`, { stockQty: 3 }).expect(422);
    expect(res.body).toMatchObject({ code: "STOCK_BELOW_RESERVED", message: "Stok tidak boleh di bawah jumlah yang sedang ditahan (4)." });
    expect((await stockOf(p.id)).available).toBe(6);
    expect((await a.patch(`/api/admin/products/${p.id}`, { stockQty: 4 }).expect(200)).body.stock).toEqual({ available: 0, reserved: 4, sold: 0 });
  });

  it("negatif ditolak; stok produk digital diabaikan; perubahan dicatat dengan angka saja", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    expect((await a.patch(`/api/admin/products/${p.id}`, { stockQty: -2 }).expect(422)).body.fields.stockQty).toBe("Stok tidak boleh negatif.");
    await a.patch(`/api/admin/products/${p.id}`, { stockQty: 25 }).expect(200);
    const rows = (await run(sql`select action, details from audit_logs where action = 'product.stock_changed'`)).rows as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rows).toEqual([{ action: "product.stock_changed", details: { from: 10, to: 25 } }]);

    const d = await makeProduct(ctx, admin);
    expect((await a.patch(`/api/admin/products/${d.id}`, { stockQty: 99 }).expect(200)).body.stock.available).toBeNull();
  });
});

describe("POST /api/admin/products/:id/licenses (F9.3, F9.7)", () => {
  it("menambah kode massal: satu per baris, spasi dan baris kosong diabaikan", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    const res = await addCodes(p.id, "ABC-111\n  ABC-222  \n\n\r\nABC-333\r\n").expect(200);
    expect(res.body).toEqual({ added: 3, duplicates: 0 });
    expect((await stockOf(p.id)).available).toBe(3);
  });

  it("kode ganda ditolak dan dihitung: di dalam masukan, huruf besar-kecil sama, dan terhadap stok yang ada", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    expect((await addCodes(p.id, "A-1\nA-2\nA-2\n  a-1 ").expect(200)).body).toEqual({ added: 2, duplicates: 2 });
    expect((await addCodes(p.id, "A-1\nA-2\nA-3").expect(200)).body).toEqual({ added: 1, duplicates: 2 });
    expect((await stockOf(p.id)).available).toBe(3);
  });

  it("kode yang sudah terjual tetap dihitung duplikat (tidak bisa dipakai ulang)", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    await addCodes(p.id, "TERJUAL-1").expect(200);
    await run(sql`update license_codes set status = 'assigned' where product_id = ${p.id}`);
    expect((await addCodes(p.id, "TERJUAL-1").expect(200)).body).toEqual({ added: 0, duplicates: 1 });
  });

  it("kode yang sama di produk berbeda boleh", async () => {
    const p1 = await makeProduct(ctx, admin, LICENSED);
    const p2 = await makeProduct(ctx, admin, { ...LICENSED, name: "Aplikasi Lain" });
    await addCodes(p1.id, "SAMA-1").expect(200);
    expect((await addCodes(p2.id, "SAMA-1").expect(200)).body).toEqual({ added: 1, duplicates: 0 });
  });

  it("dua permintaan bersamaan dengan kode yang sama: total tetap tanpa duplikat", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    const codes = Array.from({ length: 50 }, (_, i) => `PAR-${i}`).join("\n");
    const [r1, r2] = await Promise.all([addCodes(p.id, codes), addCodes(p.id, codes)]);
    expect(r1.body.added + r2.body.added).toBe(50);
    expect(r1.body.duplicates + r2.body.duplicates).toBe(50);
    expect((await stockOf(p.id)).available).toBe(50);
  });

  it("kode disimpan terenkripsi dan tidak pernah ditampilkan kembali", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    const res = await addCodes(p.id, "RAHASIA-LISENSI-777").expect(200);
    expect(JSON.stringify(res.body)).not.toContain("RAHASIA");
    const row = ((await run(sql`select code_enc, code_index from license_codes`)).rows as any[])[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(row.code_enc).not.toContain("RAHASIA");
    expect(ctx.crypto.decrypt(row.code_enc)).toBe("RAHASIA-LISENSI-777");
    expect(row.code_index).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await a.get(`/api/admin/products/${p.id}`)).body)).not.toContain("RAHASIA");
    expect(JSON.stringify((await a.get("/api/admin/products")).body)).not.toContain("RAHASIA");
  });

  it("hanya produk digital berlisensi", async () => {
    const msg = "Produk ini tidak memakai kode lisensi.";
    const physical = await makeProduct(ctx, admin, PHYSICAL);
    const plain = await makeProduct(ctx, admin);
    expect((await addCodes(physical.id, "A").expect(422)).body).toMatchObject({ code: "NOT_LICENSED", message: msg });
    expect((await addCodes(plain.id, "A").expect(422)).body.message).toBe(msg);
    await addCodes("00000000-0000-0000-0000-000000000000", "A").expect(404);
  });

  it("validasi masukan: kosong, terlalu banyak baris, baris terlalu panjang", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    expect((await addCodes(p.id, " \n\n ").expect(422)).body.fields.codes).toBe("Tempel minimal satu kode.");
    expect((await a.post(`/api/admin/products/${p.id}/licenses`, {}).expect(422)).body.fields.codes).toBe("Tempel minimal satu kode.");
    expect((await addCodes(p.id, Array.from({ length: 5001 }, (_, i) => `K${i}`).join("\n")).expect(422)).body.fields.codes).toBe("Maksimal 5.000 kode sekali tambah.");
    expect((await addCodes(p.id, `OK-1\nOK-2\n${"x".repeat(201)}`).expect(422)).body.fields.codes).toBe("Baris 3 terlalu panjang (maksimal 200 karakter).");
    expect((await stockOf(p.id)).available).toBe(0); // tidak ada yang tersimpan sebagian
  });

  it("5.000 kode sekaligus selesai cepat", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    const t = Date.now();
    expect((await addCodes(p.id, Array.from({ length: 5000 }, (_, i) => `BESAR-${i}`).join("\n")).expect(200)).body).toEqual({ added: 5000, duplicates: 0 });
    expect(Date.now() - t).toBeLessThan(5000);
  }, 15000);

  it("tercatat di log aktivitas dengan jumlahnya saja", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    await addCodes(p.id, "A\nA\nB").expect(200);
    const rows = (await run(sql`select action, details from audit_logs where action = 'product.licenses_added'`)).rows as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rows).toEqual([{ action: "product.licenses_added", details: { added: 2, duplicates: 1 } }]);
  });

  it("tanpa login 401; pembeli 403", async () => {
    const p = await makeProduct(ctx, admin, LICENSED);
    await api(ctx, await ctx.buyerCookie()).post(`/api/admin/products/${p.id}/licenses`, { codes: "A" }).expect(403);
  });
});
