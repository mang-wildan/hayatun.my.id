import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { createTestContext, type TestContext } from "../../test/context.js";
import { DIGITAL, HTML, JPG, MB, PHYSICAL, PNG, api, filesOnDisk, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  a = api(ctx, admin);
});
afterEach(() => ctx.close());

describe("akses hanya untuk admin (N6)", () => {
  const ROUTES: [string, string][] = [
    ["get", "/api/admin/products"],
    ["post", "/api/admin/products"],
    ["get", "/api/admin/products/00000000-0000-0000-0000-000000000000"],
    ["patch", "/api/admin/products/00000000-0000-0000-0000-000000000000"],
    ["post", "/api/admin/products/00000000-0000-0000-0000-000000000000/activate"],
    ["post", "/api/admin/products/00000000-0000-0000-0000-000000000000/deactivate"],
    ["put", "/api/admin/products/00000000-0000-0000-0000-000000000000/cover"],
    ["post", "/api/admin/products/00000000-0000-0000-0000-000000000000/files?filename=x.pdf"],
    ["post", "/api/admin/products/00000000-0000-0000-0000-000000000000/links"],
    ["delete", "/api/admin/products/00000000-0000-0000-0000-000000000000/files/00000000-0000-0000-0000-000000000000"],
  ];
  it.each(ROUTES)("%s %s: tanpa login 401, pembeli 403", async (method, path) => {
    const call = (cookie?: string) => {
      const r = (request(ctx.app) as any)[method](path); // eslint-disable-line @typescript-eslint/no-explicit-any
      return (cookie ? r.set("Cookie", cookie) : r).send({});
    };
    expect((await call()).status).toBe(401);
    expect((await call(await ctx.buyerCookie())).status).toBe(403);
  });
});

describe("POST /api/admin/products (F9.1)", () => {
  it("membuat produk digital: nonaktif, slug dari nama, tanpa berat dan stok", async () => {
    const res = await a.post("/api/admin/products", { ...DIGITAL, weightG: 500, stockQty: 9 }).expect(201);
    expect(res.body).toMatchObject({
      slug: "e-book-ramadan-ceria", name: "E-book Ramadan Ceria", description: DIGITAL.description, type: "digital",
      price: 75000, weightG: null, isLicensed: false, active: false, coverUrl: null, files: [],
      stock: { available: null, reserved: 0, sold: 0 },
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("membuat produk fisik dengan berat dan stok", async () => {
    const res = await a.post("/api/admin/products", PHYSICAL).expect(201);
    expect(res.body).toMatchObject({ type: "physical", weightG: 600, active: false, stock: { available: 10, reserved: 0, sold: 0 } });
  });

  it("slug unik dan bersih: aksen dibuang, nama kembar diberi nomor, simbol saja jadi 'produk'", async () => {
    expect((await makeProduct(ctx, admin, { name: "Kue Lebaran – Édisi Spesial!" })).slug).toBe("kue-lebaran-edisi-spesial");
    expect((await makeProduct(ctx, admin)).slug).toBe("e-book-ramadan-ceria");
    expect((await makeProduct(ctx, admin)).slug).toBe("e-book-ramadan-ceria-2");
    expect((await makeProduct(ctx, admin, { name: "!!!" })).slug).toMatch(/^produk(-\d+)?$/);
  });

  it("validasi: pesan per kolom (N10)", async () => {
    const res = await a.post("/api/admin/products", { name: "  ", description: "x".repeat(5001), type: "campur", price: 0 }).expect(422);
    expect(res.body.fields).toEqual({
      name: "Namanya diisi dulu ya.",
      description: "Deskripsi maksimal 5.000 karakter.",
      type: "Pilih jenis produknya: digital atau fisik.",
      price: "Harga minimal Rp1.",
    });
    expect((await a.post("/api/admin/products", { ...DIGITAL, name: "x".repeat(121) }).expect(422)).body.fields.name).toBe("Nama maksimal 120 karakter.");
    expect((await a.post("/api/admin/products", { ...DIGITAL, price: 1.5 }).expect(422)).body.fields.price).toBe("Harganya harus bilangan bulat Rupiah.");
    expect((await a.post("/api/admin/products", { ...DIGITAL, price: 100_000_001 }).expect(422)).body.fields.price).toBe("Harga maksimal Rp100.000.000.");
    expect((await a.post("/api/admin/products", { ...DIGITAL, price: "murah" }).expect(422)).body.fields.price).toBe("Harganya diisi angka ya.");
  });

  it("produk fisik wajib berat lebih dari 0, karena ongkir dihitung dari berat (F9.6)", async () => {
    const msg = "Berat wajib diisi untuk produk fisik (dalam gram), karena ongkir dihitung dari beratnya.";
    for (const weightG of [undefined, 0, -5, null]) {
      expect((await a.post("/api/admin/products", { ...PHYSICAL, weightG }).expect(422)).body.fields.weightG).toBe(msg);
    }
    expect((await a.post("/api/admin/products", { ...PHYSICAL, weightG: 100_001 }).expect(422)).body.fields.weightG).toBe("Berat maksimal 100.000 gram.");
  });

  it("hanya produk digital yang boleh berlisensi; stok tidak boleh negatif", async () => {
    expect((await a.post("/api/admin/products", { ...PHYSICAL, isLicensed: true }).expect(422)).body.fields.isLicensed).toBe("Hanya produk digital yang bisa memakai kode lisensi.");
    expect((await a.post("/api/admin/products", { ...PHYSICAL, stockQty: -1 }).expect(422)).body.fields.stockQty).toBe("Stok tidak boleh negatif.");
    expect((await a.post("/api/admin/products", { ...DIGITAL, isLicensed: true }).expect(201)).body.isLicensed).toBe(true);
  });

  it("tercatat di log aktivitas tanpa data produk (F15.3)", async () => {
    const p = await makeProduct(ctx, admin);
    const rows = (await ctx.db.execute(sql`select actor_id, action, entity_type, entity_id, details from audit_logs order by id`)).rows as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "product.created", entity_type: "product", entity_id: p.id, details: {} });
    expect(rows[0].actor_id).toBeTruthy();
  });
});

describe("GET /api/admin/products", () => {
  it("daftar terbaru dulu, termasuk yang nonaktif, tanpa deskripsi panjang", async () => {
    await makeProduct(ctx, admin, { name: "Pertama" });
    ctx.clock.advance(1000);
    const second = await makeProduct(ctx, admin, { ...PHYSICAL, name: "Kedua" });
    const res = await a.get("/api/admin/products").expect(200);
    expect(res.body.products.map((p: { name: string }) => p.name)).toEqual(["Kedua", "Pertama"]);
    expect(res.body.products[0]).toMatchObject({ id: second.id, type: "physical", price: 120000, active: false, fileCount: 0, stock: { available: 10, reserved: 0, sold: 0 } });
    expect(res.body.products[0].description).toBeUndefined();
  });

  it("detail satu produk; id tak dikenal 404", async () => {
    const p = await makeProduct(ctx, admin);
    expect((await a.get(`/api/admin/products/${p.id}`).expect(200)).body.name).toBe(p.name);
    const res = await a.get("/api/admin/products/00000000-0000-0000-0000-000000000000").expect(404);
    expect(res.body).toEqual({ code: "PRODUCT_NOT_FOUND", message: "Produk tidak ditemukan." });
    await a.get("/api/admin/products/bukan-uuid").expect(404);
  });
});

describe("PATCH /api/admin/products/:id", () => {
  it("mengubah sebagian kolom; slug tetap supaya alamat produk tidak berubah", async () => {
    const p = await makeProduct(ctx, admin);
    const res = await a.patch(`/api/admin/products/${p.id}`, { name: "Nama Baru", price: 90000 }).expect(200);
    expect(res.body).toMatchObject({ name: "Nama Baru", price: 90000, slug: p.slug, description: DIGITAL.description });
  });

  it("memakai aturan validasi yang sama; berat fisik tidak boleh dikosongkan (F9.6)", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    expect((await a.patch(`/api/admin/products/${p.id}`, { weightG: 0 }).expect(422)).body.fields.weightG).toContain("Berat wajib diisi");
    expect((await a.patch(`/api/admin/products/${p.id}`, { price: 0 }).expect(422)).body.fields.price).toBe("Harga minimal Rp1.");
    expect((await a.patch(`/api/admin/products/${p.id}`, { weightG: 750 }).expect(200)).body.weightG).toBe(750);
  });

  it("jenis produk tidak bisa diubah", async () => {
    const p = await makeProduct(ctx, admin);
    const res = await a.patch(`/api/admin/products/${p.id}`, { type: "physical" }).expect(422);
    expect(res.body.fields.type).toBe("Jenis produk tidak bisa diubah. Buat produk baru kalau perlu.");
  });

  it("harga yang diubah tidak mengubah harga yang sudah terkunci di pesanan (F9.8)", async () => {
    // Pesanan baru ada di T28; di sini cukup memastikan harga hanya dibaca dari produk saat dipakai, dan perubahan dicatat
    const p = await makeProduct(ctx, admin);
    await a.patch(`/api/admin/products/${p.id}`, { price: 50000 }).expect(200);
    const rows = (await ctx.db.execute(sql`select action, details from audit_logs order by id`)).rows as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rows.map((r) => r.action)).toEqual(["product.created", "product.updated"]);
    expect(rows[1].details).toEqual({ price: true });
  });
});

describe("tidak ada hapus permanen (F9.9)", () => {
  it("DELETE produk tidak ada; produk tetap ada", async () => {
    const p = await makeProduct(ctx, admin);
    await a.del(`/api/admin/products/${p.id}`).expect(404);
    await a.get(`/api/admin/products/${p.id}`).expect(200);
  });
});

describe("aktifkan dan nonaktifkan (F9.2)", () => {
  it("produk digital tanpa file atau tautan tidak bisa diaktifkan", async () => {
    const p = await makeProduct(ctx, admin);
    const res = await a.post(`/api/admin/products/${p.id}/activate`).expect(422);
    expect(res.body).toMatchObject({ code: "NO_FILES", message: "Produk digital perlu minimal satu file atau tautan sebelum dijual." });
    expect((await a.get(`/api/admin/products/${p.id}`)).body.active).toBe(false);
  });

  it("dengan satu tautan bisa diaktifkan; mengaktifkan lagi tidak error; lalu dinonaktifkan", async () => {
    const p = await makeProduct(ctx, admin);
    await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/ebook", label: "Unduh e-book" }).expect(201);
    expect((await a.post(`/api/admin/products/${p.id}/activate`).expect(200)).body.active).toBe(true);
    expect((await a.post(`/api/admin/products/${p.id}/activate`).expect(200)).body.active).toBe(true);
    expect((await a.post(`/api/admin/products/${p.id}/deactivate`).expect(200)).body.active).toBe(false);
    const actions = ((await ctx.db.execute(sql`select action from audit_logs order by id`)).rows as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(["product.created", "product.link_added", "product.activated", "product.deactivated"]);
  });

  it("produk fisik bisa diaktifkan tanpa file", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    expect((await a.post(`/api/admin/products/${p.id}/activate`).expect(200)).body.active).toBe(true);
  });
});

describe("file produk digital (F9.2, N5)", () => {
  it("mengunggah file lewat aliran langsung; tercatat dengan nama dan ukuran", async () => {
    const p = await makeProduct(ctx, admin);
    const data = Buffer.alloc(MB + 5, 7);
    const res = await a.upload(`/api/admin/products/${p.id}/files?filename=ebook-ramadan.pdf`, data, "application/pdf").expect(201);
    expect(res.body).toMatchObject({ kind: "file", filename: "ebook-ramadan.pdf", sizeBytes: MB + 5, url: null });
    const detail = (await a.get(`/api/admin/products/${p.id}`)).body;
    expect(detail.files).toHaveLength(1);
    expect(await filesOnDisk(ctx, "products")).toHaveLength(1);
  });

  it("nama file dibersihkan: tanpa path dan karakter kontrol; nama wajib", async () => {
    const p = await makeProduct(ctx, admin);
    expect((await a.upload(`/api/admin/products/${p.id}/files?filename=${encodeURIComponent("../../etc/passwd\r\nx.pdf")}`, Buffer.from("a")).expect(201)).body.filename).toBe("x.pdf");
    expect((await a.upload(`/api/admin/products/${p.id}/files`, Buffer.from("a")).expect(422)).body.message).toBe("Nama file wajib diisi.");
    expect((await a.upload(`/api/admin/products/${p.id}/files?filename=${"a".repeat(201)}`, Buffer.from("a")).expect(422)).body.message).toBe("Nama file maksimal 200 karakter.");
  });

  it("produk fisik tidak punya file unduhan", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    expect((await a.upload(`/api/admin/products/${p.id}/files?filename=x.pdf`, Buffer.from("a")).expect(422)).body.message).toBe("Produk fisik tidak punya file unduhan.");
    expect((await a.post(`/api/admin/products/${p.id}/links`, { url: "https://x.id", label: "x" }).expect(422)).body.message).toBe("Produk fisik tidak punya file unduhan.");
  });

  it("melewati batas ukuran ditolak dan tidak meninggalkan berkas", async () => {
    const p = await makeProduct(ctx, admin);
    ctx.config.productFileMaxBytes = 2 * MB;
    const res = await a.upload(`/api/admin/products/${p.id}/files?filename=besar.zip`, Buffer.alloc(3 * MB, 1)).expect(422);
    expect(res.body).toMatchObject({ code: "FILE_TOO_LARGE", message: "Filenya kebesaran nih, maksimal 2 MB ya. Coba kecilkan dulu." });
    expect(await filesOnDisk(ctx, "products")).toEqual([]);
    expect((await a.get(`/api/admin/products/${p.id}`)).body.files).toEqual([]);
  });

  it("batas bawaan 500 MB, diatur lewat PRODUCT_FILE_MAX_MB", () => {
    expect(ctx.config.productFileMaxBytes).toBe(500 * MB);
  });

  it("maksimal 20 file atau tautan per produk", async () => {
    const p = await makeProduct(ctx, admin);
    for (let i = 0; i < 20; i++) await a.post(`/api/admin/products/${p.id}/links`, { url: `https://x.id/${i}`, label: `Tautan ${i}` }).expect(201);
    expect((await a.post(`/api/admin/products/${p.id}/links`, { url: "https://x.id/21", label: "Terlalu banyak" }).expect(422)).body.message).toBe("Maksimal 20 file atau tautan per produk.");
  });

  it("menghapus file menghapus baris dan berkas; file produk lain tidak bisa dihapus lewat id ini", async () => {
    const p = await makeProduct(ctx, admin);
    const other = await makeProduct(ctx, admin, { name: "Produk Lain" });
    const f = (await a.upload(`/api/admin/products/${p.id}/files?filename=a.pdf`, Buffer.from("isi")).expect(201)).body;
    await a.del(`/api/admin/products/${other.id}/files/${f.id}`).expect(404);
    await a.del(`/api/admin/products/${p.id}/files/${f.id}`).expect(204);
    expect(await filesOnDisk(ctx, "products")).toEqual([]);
    await a.del(`/api/admin/products/${p.id}/files/${f.id}`).expect(404);
  });

  it("file terakhir produk yang sedang dijual tidak bisa dihapus", async () => {
    const p = await makeProduct(ctx, admin);
    const f = (await a.upload(`/api/admin/products/${p.id}/files?filename=a.pdf`, Buffer.from("isi")).expect(201)).body;
    await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
    const res = await a.del(`/api/admin/products/${p.id}/files/${f.id}`).expect(422);
    expect(res.body).toMatchObject({ code: "LAST_FILE", message: "Produk yang sedang dijual harus punya minimal satu file atau tautan. Nonaktifkan dulu." });
    expect(await filesOnDisk(ctx, "products")).toHaveLength(1);
  });

  it("tautan harus https dan punya nama", async () => {
    const p = await makeProduct(ctx, admin);
    const bad = async (body: object) => (await a.post(`/api/admin/products/${p.id}/links`, body).expect(422)).body.fields;
    expect((await bad({ url: "http://x.id", label: "x" })).url).toBe("Alamat tautan harus diawali https://");
    expect((await bad({ url: "javascript:alert(1)", label: "x" })).url).toBe("Alamat tautan harus diawali https://");
    expect((await bad({ url: "https://x.id", label: " " })).label).toBe("Nama tautan diisi dulu ya.");
    expect((await bad({ url: "https://x.id/" + "a".repeat(500), label: "x" })).url).toBe("Alamat tautan maksimal 500 karakter.");
    const ok = await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    expect(ok.body).toMatchObject({ kind: "link", filename: "Unduh", url: "https://contoh.id/unduh", sizeBytes: null });
  });
});

describe("sampul produk", () => {
  it("mengunggah JPG, PNG, atau WebP; bisa dilihat admin walau produk nonaktif", async () => {
    const p = await makeProduct(ctx, admin);
    const res = await a.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200);
    expect(res.body.coverUrl).toMatch(new RegExp(`^/api/admin/products/${p.id}/cover\\?v=\\d+$`));
    const img = await a.get(`/api/admin/products/${p.id}/cover`).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c)).on("end", () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    expect(img.body).toEqual(PNG);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["content-disposition"]).toMatch(/^inline/);
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("mengganti sampul menghapus berkas yang lama", async () => {
    const p = await makeProduct(ctx, admin);
    await a.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200);
    await a.put(`/api/admin/products/${p.id}/cover`, JPG, "image/jpeg").expect(200);
    expect(await filesOnDisk(ctx, "covers")).toHaveLength(1);
  });

  it("jenis dan ukuran diperiksa dari isi: HTML berpura-pura JPG, PDF, dan lebih dari 5 MB ditolak", async () => {
    const p = await makeProduct(ctx, admin);
    expect((await a.put(`/api/admin/products/${p.id}/cover`, HTML, "image/jpeg").expect(422)).body).toMatchObject({
      code: "FILE_TYPE", message: "Jenis file tidak didukung. Pakai JPG, PNG, atau WebP ya.",
    });
    await a.put(`/api/admin/products/${p.id}/cover`, Buffer.from("%PDF-1.7 x"), "application/pdf").expect(422);
    expect((await a.put(`/api/admin/products/${p.id}/cover`, Buffer.concat([PNG, Buffer.alloc(5 * MB)]), "image/png").expect(422)).body.code).toBe("FILE_TOO_LARGE");
    expect(await filesOnDisk(ctx, "covers")).toEqual([]);
  });

  it("produk tanpa sampul: 404", async () => {
    const p = await makeProduct(ctx, admin);
    await a.get(`/api/admin/products/${p.id}/cover`).expect(404);
  });
});
