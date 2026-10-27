import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let admin: string;
let buyer: string;
let a: ReturnType<typeof api>; // admin
let b: ReturnType<typeof api>; // pembeli
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie();
  buyer = await ctx.buyerCookie();
  a = api(ctx, admin);
  b = api(ctx, buyer);
});
afterEach(() => ctx.close());

type Item = { productId: string; slug: string; name: string; type: string; price: number; qty: number; maxQty: number; lineTotal: number; coverUrl: string | null; status: string };
type Cart = { items: Item[]; subtotal: number; canCheckout: boolean; requiresAddress: boolean };

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
const physical = (over: Record<string, unknown> = {}) => publish({ ...PHYSICAL, ...over });
const cart = async (who = b) => (await who.get("/api/cart").expect(200)).body as Cart;
const add = (productId: string, qty?: number, who = b) => who.post("/api/cart/items", qty === undefined ? { productId } : { productId, qty });

describe("akses (F3.1)", () => {
  it("semua rute keranjang butuh login", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    for (const res of [
      await request(ctx.app).get("/api/cart"),
      await request(ctx.app).post("/api/cart/items").send({ productId: id }),
      await request(ctx.app).patch(`/api/cart/items/${id}`).send({ qty: 1 }),
      await request(ctx.app).delete(`/api/cart/items/${id}`),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("keranjang baru kosong dan belum bisa checkout", async () => {
    expect(await cart()).toEqual({ items: [], subtotal: 0, canCheckout: false, requiresAddress: false });
  });

  it("keranjang milik masing-masing akun", async () => {
    const p = await publish();
    await add(p.id).expect(201);
    const other = api(ctx, await ctx.buyerCookie());
    expect((await cart(other)).items).toEqual([]);
    expect((await cart()).items).toHaveLength(1);
  });
});

describe("POST /api/cart/items", () => {
  it("produk digital dan fisik dalam satu keranjang; bentuk item tidak membocorkan data internal", async () => {
    const d = await publish({ name: "E-book", price: 75000 });
    const f = await physical({ name: "Nastar", price: 120000 });
    await add(d.id).expect(201);
    const res = await add(f.id, 2).expect(201);
    const c = res.body as Cart;
    expect(c.items.map((i) => i.name).sort()).toEqual(["E-book", "Nastar"]);
    expect(c.subtotal).toBe(75000 + 2 * 120000);
    expect(c.canCheckout).toBe(true);
    const nastar = c.items.find((i) => i.name === "Nastar")!;
    expect(nastar).toMatchObject({ productId: f.id, slug: f.slug, type: "physical", price: 120000, qty: 2, lineTotal: 240000, status: "ok" });
    expect(Object.keys(nastar).sort()).toEqual(["coverUrl", "lineTotal", "maxQty", "name", "price", "productId", "qty", "slug", "status", "type"]);
    expect(await cart()).toEqual(c);
  });

  it("jumlah bawaan 1; menambah lagi produk fisik menambah jumlahnya", async () => {
    const f = await physical();
    expect(((await add(f.id).expect(201)).body as Cart).items[0].qty).toBe(1);
    expect(((await add(f.id, 2).expect(201)).body as Cart).items[0].qty).toBe(3);
  });

  it("produk digital selalu satu: menambah lagi tidak melipatgandakan", async () => {
    const d = await publish();
    await add(d.id).expect(201);
    const c = (await add(d.id).expect(201)).body as Cart;
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ qty: 1, maxQty: 1 });
    expect((await add(d.id, 3).expect(422)).body).toMatchObject({ code: "DIGITAL_QTY", message: "Produk digital cukup dibeli satu kali." });
  });

  it("melewati stok ditolak dengan sisa stok; keranjang tidak berubah", async () => {
    const f = await physical({ stockQty: 4 });
    await add(f.id, 3).expect(201);
    const res = await add(f.id, 2).expect(422);
    expect(res.body).toMatchObject({ code: "STOCK_LIMIT", message: "Stok tersisa 4, jadi jumlahnya tidak bisa lebih dari itu." });
    expect((await cart()).items[0].qty).toBe(3);
    expect((await add(f.id, 1).expect(201)).body.items[0].qty).toBe(4);
  });

  it("produk habis ditolak dengan pesan jelas, termasuk lisensi tanpa kode", async () => {
    const f = await physical({ stockQty: 0 });
    expect((await add(f.id).expect(422)).body).toMatchObject({ code: "OUT_OF_STOCK", message: "Maaf, produk ini sedang habis." });
    const lic = await publish({ name: "Aplikasi", isLicensed: true });
    expect((await add(lic.id).expect(422)).body.code).toBe("OUT_OF_STOCK");
    await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "AAA" }).expect(200);
    await add(lic.id).expect(201);
    expect(await cart()).toMatchObject({ canCheckout: true });
  });

  it("produk nonaktif atau tidak ada: 404 yang sama", async () => {
    const off = await makeProduct(ctx, admin, { name: "Belum aktif" });
    for (const id of [off.id, "00000000-0000-0000-0000-000000000000"]) {
      expect((await add(id).expect(404)).body).toMatchObject({ code: "PRODUCT_NOT_FOUND", message: "Produk tidak ditemukan." });
    }
    expect((await cart()).items).toEqual([]);
  });

  it("validasi input dengan pesan per kolom", async () => {
    const f = await physical();
    expect((await b.post("/api/cart/items", { productId: "ngawur" }).expect(422)).body.fields.productId).toBeTruthy();
    expect((await b.post("/api/cart/items", {}).expect(422)).body.fields.productId).toBeTruthy();
    for (const [qty, message] of [[0, "Jumlah minimal 1."], [1.5, "Jumlah harus bilangan bulat."], [100, "Jumlah maksimal 99."]] as const) {
      expect((await add(f.id, qty).expect(422)).body.fields.qty).toBe(message);
    }
  });

  it("dua penambahan bersamaan untuk stok terakhir: tepat satu berhasil (N24)", async () => {
    const f = await physical({ stockQty: 1 });
    const results = await Promise.all([add(f.id), add(f.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await cart()).items[0].qty).toBe(1);
  });

  it("penambahan bersamaan di bawah batas semuanya masuk", async () => {
    const f = await physical({ stockQty: 10 });
    await Promise.all([add(f.id), add(f.id), add(f.id)]);
    expect((await cart()).items[0].qty).toBe(3);
  });
});

describe("PATCH dan DELETE /api/cart/items/:productId", () => {
  it("mengubah jumlah produk fisik; batas stok dan jumlah tetap berlaku", async () => {
    const f = await physical({ stockQty: 5 });
    await add(f.id).expect(201);
    const c = (await b.patch(`/api/cart/items/${f.id}`, { qty: 4 }).expect(200)).body as Cart;
    expect(c.items[0]).toMatchObject({ qty: 4, lineTotal: 480000 });
    expect(c.subtotal).toBe(480000);
    expect((await b.patch(`/api/cart/items/${f.id}`, { qty: 6 }).expect(422)).body.code).toBe("STOCK_LIMIT");
    expect((await b.patch(`/api/cart/items/${f.id}`, { qty: 0 }).expect(422)).body.fields.qty).toBe("Jumlah minimal 1.");
    expect((await cart()).items[0].qty).toBe(4);
  });

  it("produk digital tidak bisa diubah jadi lebih dari satu", async () => {
    const d = await publish();
    await add(d.id).expect(201);
    expect((await b.patch(`/api/cart/items/${d.id}`, { qty: 2 }).expect(422)).body.code).toBe("DIGITAL_QTY");
  });

  it("produk yang tidak ada di keranjang: 404", async () => {
    const f = await physical();
    expect((await b.patch(`/api/cart/items/${f.id}`, { qty: 1 }).expect(404)).body).toMatchObject({ code: "ITEM_NOT_IN_CART", message: "Produk ini tidak ada di keranjangmu." });
  });

  it("menghapus item; menghapus yang sudah tidak ada tetap 204; keranjang orang lain aman", async () => {
    const f = await physical();
    await add(f.id).expect(201);
    const other = api(ctx, await ctx.buyerCookie());
    await add(f.id, 1, other).expect(201);
    await b.del(`/api/cart/items/${f.id}`).expect(204);
    await b.del(`/api/cart/items/${f.id}`).expect(204);
    await b.del("/api/cart/items/ngawur").expect(204);
    expect((await cart()).items).toEqual([]);
    expect((await cart(other)).items).toHaveLength(1);
  });
});

describe("item yang tidak bisa dibeli ditandai (F2.4)", () => {
  it("produk dinonaktifkan: ditandai, tidak ikut subtotal, checkout dicegah; aktif lagi kembali normal", async () => {
    const d = await publish({ name: "E-book", price: 75000 });
    const f = await physical({ name: "Nastar", price: 120000 });
    await add(d.id).expect(201);
    await add(f.id).expect(201);
    await a.post(`/api/admin/products/${d.id}/deactivate`).expect(200);

    const c = await cart();
    expect(c.items.find((i) => i.productId === d.id)).toMatchObject({ status: "inactive", maxQty: 0, name: "E-book" });
    expect(c.subtotal).toBe(120000);
    expect(c.canCheckout).toBe(false);

    await a.post(`/api/admin/products/${d.id}/activate`).expect(200);
    expect(await cart()).toMatchObject({ canCheckout: true, subtotal: 195000 });
  });

  it("stok habis setelah masuk keranjang: out_of_stock", async () => {
    const f = await physical({ stockQty: 5 });
    await add(f.id, 2).expect(201);
    await a.patch(`/api/admin/products/${f.id}`, { stockQty: 0 }).expect(200);
    const c = await cart();
    expect(c.items[0]).toMatchObject({ status: "out_of_stock", maxQty: 0, qty: 2 });
    expect(c).toMatchObject({ subtotal: 0, canCheckout: false });
  });

  it("stok turun di bawah jumlah di keranjang: exceeds_stock dengan sisa stok", async () => {
    const f = await physical({ stockQty: 5 });
    await add(f.id, 4).expect(201);
    await a.patch(`/api/admin/products/${f.id}`, { stockQty: 2 }).expect(200);
    const c = await cart();
    expect(c.items[0]).toMatchObject({ status: "exceeds_stock", maxQty: 2, qty: 4 });
    expect(c.canCheckout).toBe(false);
    await b.patch(`/api/cart/items/${f.id}`, { qty: 2 }).expect(200);
    expect(await cart()).toMatchObject({ canCheckout: true });
  });

  it("jumlah yang melebihi stok bisa dikurangi selangkah demi selangkah, tapi tidak dinaikkan", async () => {
    const f = await physical({ stockQty: 5 });
    await add(f.id, 4).expect(201);
    await a.patch(`/api/admin/products/${f.id}`, { stockQty: 2 }).expect(200);
    expect(((await b.patch(`/api/cart/items/${f.id}`, { qty: 3 }).expect(200)).body as Cart).items[0]).toMatchObject({ qty: 3, status: "exceeds_stock" });
    expect((await b.patch(`/api/cart/items/${f.id}`, { qty: 4 }).expect(422)).body.code).toBe("STOCK_LIMIT");
    await a.patch(`/api/admin/products/${f.id}`, { stockQty: 0 }).expect(200);
    expect(((await b.patch(`/api/cart/items/${f.id}`, { qty: 2 }).expect(200)).body as Cart).items[0].qty).toBe(2); // yang habis pun boleh dikurangi
  });

  it("kode lisensi: keranjang tidak menahan kode, jadi dua pembeli bisa memasukkan kode terakhir", async () => {
    const lic = await publish({ isLicensed: true });
    await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "AAA" }).expect(200);
    await add(lic.id).expect(201);
    const other = api(ctx, await ctx.buyerCookie());
    await add(lic.id, 1, other).expect(201); // kode belum ditahan sebelum checkout, jadi keduanya masuk
    expect((await cart(other)).items[0].status).toBe("ok");
  });

  it("harga yang tampil selalu harga terbaru; harga baru dikunci saat checkout (T28)", async () => {
    const d = await publish({ price: 75000 });
    await add(d.id).expect(201);
    await a.patch(`/api/admin/products/${d.id}`, { price: 90000 }).expect(200);
    expect(await cart()).toMatchObject({ subtotal: 90000 });
  });

  it("sampul memakai alamat publik katalog", async () => {
    const d = await publish();
    await a.put(`/api/admin/products/${d.id}/cover`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]), "image/png").expect(200);
    await add(d.id).expect(201);
    expect((await cart()).items[0].coverUrl).toMatch(new RegExp(`^/api/catalog/${d.slug}/cover\\?v=\\d+$`));
  });
});
