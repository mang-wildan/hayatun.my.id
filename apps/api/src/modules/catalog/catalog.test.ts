import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { DIGITAL, JPG, PHYSICAL, PNG, api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
});
afterEach(() => ctx.close());

// membuat produk lalu mengaktifkannya (produk digital butuh minimal satu tautan)
async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
const catalog = () => request(ctx.app).get("/api/catalog"); // tanpa cookie: publik (F2.2)
const bySlug = (slug: string) => request(ctx.app).get(`/api/catalog/${slug}`);

describe("GET /api/catalog (F2.1, F2.2)", () => {
  it("tanpa login; katalog kosong menjawab daftar kosong", async () => {
    expect((await catalog().expect(200)).body).toEqual({ products: [] });
  });

  it("hanya produk aktif, terbaru dulu; dinonaktifkan langsung hilang", async () => {
    await makeProduct(ctx, admin, { name: "Belum Aktif" });
    const one = await publish({ name: "Satu" });
    ctx.clock.advance(1000);
    await publish({ ...PHYSICAL, name: "Dua" });
    expect((await catalog()).body.products.map((p: { name: string }) => p.name)).toEqual(["Dua", "Satu"]);
    await a.post(`/api/admin/products/${one.id}/deactivate`).expect(200);
    expect((await catalog()).body.products.map((p: { name: string }) => p.name)).toEqual(["Dua"]);
  });

  it("hanya kolom yang perlu untuk kartu produk: tanpa stok, file, berat, atau deskripsi", async () => {
    const p = await publish(PHYSICAL);
    await a.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200);
    const [item] = (await catalog()).body.products;
    expect(Object.keys(item).sort()).toEqual(["available", "coverUrl", "id", "name", "price", "slug", "type"]);
    expect(item).toMatchObject({ id: p.id, slug: "kue-kering-nastar", name: "Kue Kering Nastar", type: "physical", price: 120000, available: true });
    expect(item.coverUrl).toMatch(/^\/api\/catalog\/kue-kering-nastar\/cover\?v=\d+$/);
  });

  it("produk tanpa sampul: coverUrl null", async () => {
    await publish();
    expect((await catalog()).body.products[0].coverUrl).toBeNull();
  });

  it("tidak membocorkan angka stok, file, atau kode lisensi", async () => {
    const lic = await publish({ ...DIGITAL, name: "Aplikasi Kasir", isLicensed: true });
    await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "KODE-RAHASIA-1" }).expect(200);
    await publish(PHYSICAL);
    const text = JSON.stringify([(await catalog()).body, (await bySlug("aplikasi-kasir")).body, (await bySlug("kue-kering-nastar")).body]);
    expect(text).not.toMatch(/stock|reserved|sold|files|storage|RAHASIA|contoh\.id|isLicensed|active/i);
  });
});

describe("status tersedia atau Habis (F2.3)", () => {
  const availability = async () => Object.fromEntries((await catalog()).body.products.map((p: { name: string; available: boolean }) => [p.name, p.available]));

  it("produk fisik: tersedia bila stok dikurangi yang ditahan masih lebih dari 0", async () => {
    await publish({ ...PHYSICAL, name: "Ada", stockQty: 3 });
    await publish({ ...PHYSICAL, name: "Kosong", stockQty: 0 });
    const ditahan = await publish({ ...PHYSICAL, name: "Semua Ditahan", stockQty: 5 });
    await ctx.db.execute(sql`update products set stock_reserved = 5 where id = ${ditahan.id}`);
    expect(await availability()).toEqual({ Ada: true, Kosong: false, "Semua Ditahan": false });
  });

  it("produk berlisensi: tersedia bila ada kode yang belum terpakai", async () => {
    const kosong = await publish({ ...DIGITAL, name: "Lisensi Kosong", isLicensed: true });
    const ada = await publish({ ...DIGITAL, name: "Lisensi Ada", isLicensed: true });
    const habis = await publish({ ...DIGITAL, name: "Lisensi Terpakai", isLicensed: true });
    await a.post(`/api/admin/products/${ada.id}/licenses`, { codes: "A\nB" }).expect(200);
    await a.post(`/api/admin/products/${habis.id}/licenses`, { codes: "C" }).expect(200);
    await ctx.db.execute(sql`update license_codes set status = 'reserved' where product_id = ${habis.id}`);
    expect(await availability()).toEqual({ "Lisensi Kosong": false, "Lisensi Ada": true, "Lisensi Terpakai": false });
    void kosong;
  });

  it("produk digital tanpa lisensi selalu tersedia", async () => {
    await publish({ name: "Template" });
    expect(await availability()).toEqual({ Template: true });
  });
});

describe("GET /api/catalog/:slug", () => {
  it("detail: deskripsi lengkap; berat hanya untuk produk fisik", async () => {
    await publish(PHYSICAL);
    await publish({ ...DIGITAL, description: "x".repeat(4000) });
    const phys = (await bySlug("kue-kering-nastar").expect(200)).body;
    expect(phys).toMatchObject({ name: "Kue Kering Nastar", description: "Toples 500 gram.", type: "physical", price: 120000, weightG: 600, available: true });
    const dig = (await bySlug("e-book-ramadan-ceria").expect(200)).body;
    expect(dig.description).toHaveLength(4000);
    expect(dig.weightG).toBeNull();
  });

  it("produk nonaktif, tidak dikenal, atau slug aneh: 404 dengan pesan jelas", async () => {
    const hidden = await makeProduct(ctx, admin, { name: "Tersembunyi" });
    expect((await bySlug(hidden.slug).expect(404)).body).toEqual({ code: "PRODUCT_NOT_FOUND", message: "Produk tidak ditemukan." });
    await bySlug("tidak-ada").expect(404);
    await bySlug("..%2F..%2Fetc%2Fpasswd").expect(404);
    await bySlug("%27%3B%20drop%20table%20products%3B--").expect(404);
  });
});

describe("GET /api/catalog/:slug/cover", () => {
  const raw = (slug: string) =>
    request(ctx.app).get(`/api/catalog/${slug}/cover`).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c)).on("end", () => cb(null, Buffer.concat(parts)));
    });

  it("publik, ditampilkan langsung di halaman (inline), boleh di-cache sejam", async () => {
    const p = await publish();
    await a.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200);
    const res = await raw(p.slug).expect(200);
    expect(res.body).toEqual(PNG);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sampul diganti: gambar baru dan alamat ?v= berubah supaya cache tidak basi", async () => {
    const p = await publish();
    const first = (await a.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200)).body.coverUrl;
    const urlBefore = (await catalog()).body.products[0].coverUrl;
    ctx.clock.advance(5000);
    await a.put(`/api/admin/products/${p.id}/cover`, JPG, "image/jpeg").expect(200);
    const urlAfter = (await catalog()).body.products[0].coverUrl;
    expect(urlAfter).not.toBe(urlBefore);
    const res = await raw(p.slug).expect(200);
    expect(res.body).toEqual(JPG);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    void first;
  });

  it("produk nonaktif, tanpa sampul, atau tidak dikenal: 404", async () => {
    const hidden = await makeProduct(ctx, admin, { name: "Tersembunyi" });
    await a.put(`/api/admin/products/${hidden.id}/cover`, PNG, "image/png").expect(200);
    await raw(hidden.slug).expect(404); // nonaktif
    const noCover = await publish({ name: "Tanpa Sampul" });
    await raw(noCover.slug).expect(404);
    await raw("tidak-ada").expect(404);
  });
});

describe("performa (N18)", () => {
  it("daftar 40 produk menjawab di bawah 500 ms", async () => {
    for (let i = 0; i < 40; i++) await publish({ ...PHYSICAL, name: `Produk ${i}` });
    await catalog().expect(200); // pemanasan
    const t = performance.now();
    expect((await catalog().expect(200)).body.products).toHaveLength(40);
    expect(performance.now() - t).toBeLessThan(500);
  }, 60_000);
});
