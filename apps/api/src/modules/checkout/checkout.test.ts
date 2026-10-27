import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../auth/sessions.js";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";

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
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, admin, over);
  if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
const physical = (over: Record<string, unknown> = {}) => publish({ ...PHYSICAL, ...over });
const addToCart = (productId: string, qty?: number, who = b) => who.post("/api/cart/items", qty ? { productId, qty } : { productId }).expect(201);
const newAddress = async (who = b) => (await who.post("/api/addresses", ADDRESS).expect(201)).body.id as string;
const quote = (body: object = {}, who = b) => who.post("/api/checkout/quote", body);
const checkout = (body: object, who = b) => who.post("/api/checkout", body);
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const reserved = async (id: string) => (await rows<{ stock_reserved: number }>(sql`select stock_reserved from products where id = ${id}`))[0].stock_reserved;

// isi permintaan checkout fisik: alamat + layanan termurah dari tiruan ongkir (SiCepat REG Rp15.000), total dari rincian
async function physicalBody(who = b) {
  const addressId = await newAddress(who);
  const q = (await quote({ addressId, courier: "SiCepat", service: "REG" }, who).expect(200)).body;
  return { addressId, courier: "SiCepat", service: "REG", expectedTotal: q.total };
}
const physicalCheckout = async (who = b) => checkout(await physicalBody(who), who);

describe("syarat checkout (F1.1, F1.2)", () => {
  it("wajib login", async () => {
    for (const path of ["/api/checkout", "/api/checkout/quote"]) {
      const res = await request(ctx.app).post(path).send({ expectedTotal: 1 });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("email belum terverifikasi: ditolak dengan pesan jelas, tidak ada pesanan", async () => {
    const id = await ctx.createUser({ email: "belum@mail.com", password: "rahasia-hayatun-1", verified: false });
    const u = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
    const d = await publish({ price: 75000 });
    await addToCart(d.id, undefined, u);
    const unverified = { code: "EMAIL_NOT_VERIFIED", message: "Verifikasi emailmu dulu ya sebelum checkout. Cek kotak masuk atau minta tautan baru." };
    expect((await quote({}, u).expect(403)).body).toMatchObject(unverified);
    expect((await checkout({ expectedTotal: 75000 }, u).expect(403)).body).toMatchObject(unverified);
    expect(await rows(sql`select id from orders`)).toEqual([]);
  });

  it("keranjang kosong ditolak", async () => {
    const empty = { code: "CART_EMPTY", message: "Keranjangmu masih kosong." };
    expect((await quote().expect(409)).body).toMatchObject(empty);
    expect((await checkout({ expectedTotal: 0 }).expect(409)).body).toMatchObject(empty);
  });

  it("item yang tidak bisa dibeli: ditolak dengan daftar itemnya, tanpa pesanan sebagian (F3.8)", async () => {
    const d = await publish({ name: "E-book", price: 75000 });
    const f = await physical({ name: "Nastar", stockQty: 5 });
    await addToCart(d.id);
    await addToCart(f.id, 3);
    await a.post(`/api/admin/products/${d.id}/deactivate`).expect(200);
    await a.patch(`/api/admin/products/${f.id}`, { stockQty: 2 }).expect(200);
    const res = await checkout({ addressId: await newAddress(), courier: "SiCepat", service: "REG", expectedTotal: 1 }).expect(409);
    expect(res.body).toMatchObject({ code: "CART_NOT_READY", message: "Ada item yang tidak bisa dibeli. Cek keranjangmu dulu ya." });
    expect(res.body.items).toEqual(expect.arrayContaining([
      { productId: d.id, name: "E-book", status: "inactive" },
      { productId: f.id, name: "Nastar", status: "exceeds_stock" },
    ]));
    expect(await rows(sql`select id from orders`)).toEqual([]);
    expect(await reserved(f.id)).toBe(0);
  });
});

describe("rincian sebelum konfirmasi (F3.5)", () => {
  it("keranjang digital: tanpa alamat dan tanpa ongkir; total sama dengan subtotal (F3.3)", async () => {
    const d = await publish({ name: "E-book", price: 75000 });
    await addToCart(d.id);
    const res = (await quote().expect(200)).body;
    expect(res).toEqual({
      items: [{ productId: d.id, name: "E-book", type: "digital", price: 75000, qty: 1, lineTotal: 75000 }],
      subtotal: 75000,
      requiresAddress: false,
      shippingOptions: [],
      shippingCost: 0,
      total: 75000,
    });
  });

  it("ada produk fisik: alamat wajib, pilihan ongkir termurah dulu, total baru ada setelah layanan dipilih", async () => {
    const f = await physical({ name: "Nastar", price: 120000 });
    await addToCart(f.id, 2);
    expect((await quote().expect(422)).body.fields.addressId).toBe("Pilih alamat pengiriman dulu ya.");
    const addressId = await newAddress();
    const open = (await quote({ addressId }).expect(200)).body;
    expect(open).toMatchObject({ subtotal: 240000, requiresAddress: true, shippingCost: null, total: null });
    expect(open.shippingOptions.map((o: { courier: string; price: number }) => [o.courier, o.price])).toEqual([["SiCepat", 15000], ["JNE", 18000]]);
    expect((await quote({ addressId, courier: "JNE", service: "REG" }).expect(200)).body).toMatchObject({ shippingCost: 18000, total: 258000 });
  });

  it("melihat rincian tidak membuat pesanan dan tidak menahan stok", async () => {
    const f = await physical();
    await addToCart(f.id);
    await quote({ addressId: await newAddress() }).expect(200);
    expect(await rows(sql`select id from orders`)).toEqual([]);
    expect(await reserved(f.id)).toBe(0);
  });

  it("hanya berat dan wilayah yang dikirim ke penyedia ongkir (N27)", async () => {
    const f = await physical({ weightG: 600 });
    await addToCart(f.id, 2);
    await quote({ addressId: await newAddress() }).expect(200);
    expect(ctx.shipping.requests.at(-1)).toEqual({ originAreaId: "", destinationAreaId: "area-bandung-cicendo", postalCode: "40172", weightG: 1200 });
  });
});

describe("membuat pesanan (F3.4)", () => {
  it("pesanan campuran: harga terkunci, stok dan kode lisensi ditahan, alamat disalin terenkripsi, keranjang dikosongkan", async () => {
    const lic = await publish({ name: "Aplikasi Kasir", price: 350000, isLicensed: true });
    await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "KODE-1\nKODE-2" }).expect(200);
    const f = await physical({ name: "Nastar", price: 120000, stockQty: 10, weightG: 600 });
    await addToCart(lic.id);
    await addToCart(f.id, 2);

    const res = await physicalCheckout();
    expect(res.status).toBe(201);
    const total = 350000 + 240000 + 15000;
    expect(res.body).toEqual({ orderId: expect.any(String), invoiceNumber: "INV/2026/10/0001", total, expiresAt: new Date(ctx.clock.now.getTime() + DAY).toISOString() });

    const [o] = await rows<Record<string, unknown>>(sql`select * from orders where id = ${res.body.orderId}`);
    expect(o).toMatchObject({
      invoice_number: "INV/2026/10/0001", status: "MENUNGGU_PEMBAYARAN", digital_status: "MENUNGGU", physical_status: "MENUNGGU",
      payment_method: "manual", subtotal: 590000, shipping_cost: 15000, total, ship_area_id: "area-bandung-cicendo", ship_postal_code: "40172", courier: "SiCepat", courier_service: "REG",
    });
    for (const col of ["ship_recipient_enc", "ship_phone_enc", "ship_address_enc"]) expect(String(o[col])).not.toMatch(/Budi|8123|Pajajaran/);
    expect(ctx.crypto.decrypt(String(o.ship_recipient_enc))).toBe("Budi Santoso");
    expect(ctx.crypto.decrypt(String(o.ship_address_enc))).toBe(ADDRESS.address);

    const items = await rows(sql`select product_id, product_type, name_snapshot, unit_price, qty from order_items where order_id = ${res.body.orderId} order by unit_price`);
    expect(items).toEqual([
      { product_id: f.id, product_type: "physical", name_snapshot: "Nastar", unit_price: 120000, qty: 2 },
      { product_id: lic.id, product_type: "digital", name_snapshot: "Aplikasi Kasir", unit_price: 350000, qty: 1 },
    ]);
    expect(await reserved(f.id)).toBe(2);
    const codes = await rows<{ status: string; order_item_id: string | null }>(sql`select status, order_item_id from license_codes where product_id = ${lic.id}`);
    expect(codes.filter((c) => c.status === "reserved")).toHaveLength(1);
    expect(codes.find((c) => c.status === "reserved")!.order_item_id).toBeTruthy();
    expect((await b.get("/api/cart").expect(200)).body.items).toEqual([]);
  });

  it("pesanan digital: alamat tidak diminta dan tidak disalin walau dikirim (F3.3)", async () => {
    const d = await publish({ price: 75000 });
    await addToCart(d.id);
    const res = await checkout({ addressId: await newAddress(), expectedTotal: 75000 }).expect(201);
    const [o] = await rows<Record<string, unknown>>(sql`select * from orders where id = ${res.body.orderId}`);
    expect(o).toMatchObject({ shipping_cost: 0, total: 75000, physical_status: "TIDAK_ADA", digital_status: "MENUNGGU", ship_recipient_enc: null, ship_phone_enc: null, ship_address_enc: null, ship_area_id: null, courier: null });
  });

  it("harga yang diubah admin setelah checkout tidak mengubah pesanan (F9.8)", async () => {
    const d = await publish({ price: 75000 });
    await addToCart(d.id);
    const { orderId } = (await checkout({ expectedTotal: 75000 }).expect(201)).body;
    await a.patch(`/api/admin/products/${d.id}`, { price: 99000, name: "Nama Baru" }).expect(200);
    expect(await rows(sql`select name_snapshot, unit_price from order_items where order_id = ${orderId}`)).toEqual([{ name_snapshot: expect.not.stringMatching("Nama Baru"), unit_price: 75000 }]);
  });

  it("total berubah sejak dilihat pembeli: ditolak dengan total baru, tidak ada pesanan", async () => {
    const d = await publish({ price: 75000 });
    await addToCart(d.id);
    await a.patch(`/api/admin/products/${d.id}`, { price: 80000 }).expect(200);
    const res = await checkout({ expectedTotal: 75000 }).expect(409);
    expect(res.body).toMatchObject({ code: "TOTAL_CHANGED", message: "Totalnya berubah sejak kamu lihat. Cek lagi rinciannya ya.", total: 80000 });
    expect(await rows(sql`select id from orders`)).toEqual([]);
  });

  it("expectedTotal wajib", async () => {
    const d = await publish();
    await addToCart(d.id);
    expect((await checkout({}).expect(422)).body.fields.expectedTotal).toBeTruthy();
  });

  it("nomor invoice berurutan; checkout yang gagal tidak menghabiskan nomor", async () => {
    const d = await publish({ price: 75000 });
    await addToCart(d.id);
    await checkout({ expectedTotal: 1 }).expect(409); // total salah
    expect((await checkout({ expectedTotal: 75000 }).expect(201)).body.invoiceNumber).toBe("INV/2026/10/0001");
    const other = api(ctx, await ctx.buyerCookie());
    await addToCart(d.id, undefined, other);
    expect((await checkout({ expectedTotal: 75000 }, other).expect(201)).body.invoiceNumber).toBe("INV/2026/10/0002");
  });

  it("stok tersisa turun ke ambang: admin diberi tahu (F9.5)", async () => {
    const f = await physical({ name: "Nastar", stockQty: 5 });
    await addToCart(f.id, 2);
    expect((await physicalCheckout()).status).toBe(201);
    expect((await ctx.emails()).map((m) => m.subject)).toContain("Stok produk hampir habis");
  });
});

describe("alamat dan ongkir saat membuat pesanan", () => {
  it("produk fisik tanpa alamat, alamat orang lain, atau tanpa layanan: ditolak", async () => {
    const f = await physical();
    await addToCart(f.id);
    expect((await checkout({ courier: "SiCepat", service: "REG", expectedTotal: 1 }).expect(422)).body.fields.addressId).toBe("Pilih alamat pengiriman dulu ya.");
    const notMine = await newAddress(api(ctx, await ctx.buyerCookie()));
    expect((await checkout({ addressId: notMine, courier: "SiCepat", service: "REG", expectedTotal: 1 }).expect(404)).body.code).toBe("ADDRESS_NOT_FOUND");
    expect((await checkout({ addressId: await newAddress(), expectedTotal: 1 }).expect(422)).body.fields.service).toBe("Pilih layanan pengiriman dulu ya.");
    expect(await rows(sql`select id from orders`)).toEqual([]);
  });

  it("layanan yang tidak ditawarkan penyedia ditolak; harga ongkir dari browser tidak dipakai", async () => {
    const f = await physical({ price: 120000 });
    await addToCart(f.id);
    const addressId = await newAddress();
    expect((await checkout({ addressId, courier: "Kurir Palsu", service: "GRATIS", expectedTotal: 120000 }).expect(409)).body).toMatchObject({
      code: "SHIPPING_CHANGED", message: "Layanan pengiriman yang dipilih sudah tidak tersedia. Pilih lagi ya.",
    });
    const res = await checkout({ addressId, courier: "SiCepat", service: "REG", shippingCost: 0, expectedTotal: 135000 }).expect(201);
    expect((await rows(sql`select shipping_cost from orders where id = ${res.body.orderId}`))[0]).toEqual({ shipping_cost: 15000 });
  });

  it("ongkir gagal diambil: checkout ditahan, tidak ada pesanan dan tidak ada stok yang ditahan (F3.6)", async () => {
    const f = await physical();
    await addToCart(f.id);
    const addressId = await newAddress();
    ctx.shipping.rates = async () => { throw new Error("penyedia mati"); };
    expect((await checkout({ addressId, courier: "SiCepat", service: "REG", expectedTotal: 135000 }).expect(503)).body.code).toBe("SHIPPING_UNAVAILABLE");
    expect(await rows(sql`select id from orders`)).toEqual([]);
    expect(await reserved(f.id)).toBe(0);
  });
});

// Memastikan permintaan benar-benar tumpang tindih: baris produk dikunci dari koneksi lain sampai semua permintaan
// tertahan di sebuah kunci, baru dilepas. Tanpa ini, permintaan "bersamaan" sering selesai satu per satu dan bug lolos.
async function overlapped<T>(productId: string, waiting: number, fire: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select id from products where id = $1 for update", [productId]);
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

describe("permintaan bersamaan (F3.9, N24)", () => {
  it("dua pembeli untuk stok fisik terakhir: tepat satu pesanan, yang lain diberi tahu habis", async () => {
    const f = await physical({ name: "Nastar Terakhir", stockQty: 1 });
    const other = api(ctx, await ctx.buyerCookie());
    await addToCart(f.id);
    await addToCart(f.id, undefined, other);
    const [bodyB, bodyO] = [await physicalBody(), await physicalBody(other)]; // rincian dulu, lalu checkout benar-benar bersamaan
    const results = await overlapped(f.id, 2, () => Promise.all([checkout(bodyB), checkout(bodyO, other)]));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.code).toBe("CART_NOT_READY");
    expect(lost.body.items).toEqual([{ productId: f.id, name: "Nastar Terakhir", status: "out_of_stock" }]);
    expect(await reserved(f.id)).toBe(1);
    expect(await rows(sql`select id from orders`)).toHaveLength(1);
  });

  it("dua pembeli untuk kode lisensi terakhir: kode ditahan untuk tepat satu pesanan", async () => {
    const lic = await publish({ isLicensed: true, price: 50000 });
    await a.post(`/api/admin/products/${lic.id}/licenses`, { codes: "SATU-SATUNYA" }).expect(200);
    const other = api(ctx, await ctx.buyerCookie());
    await addToCart(lic.id);
    await addToCart(lic.id, undefined, other);
    const results = await overlapped(lic.id, 2, () => Promise.all([checkout({ expectedTotal: 50000 }), checkout({ expectedTotal: 50000 }, other)]));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows(sql`select status from license_codes where status = 'reserved'`)).toHaveLength(1);
    expect(await rows(sql`select id from orders`)).toHaveLength(1);
  });

  it("klik ganda dari pembeli yang sama: satu pesanan", async () => {
    const d = await publish({ price: 75000 });
    await addToCart(d.id);
    const results = await overlapped(d.id, 5, () => Promise.all(Array.from({ length: 5 }, () => checkout({ expectedTotal: 75000 }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.body.code === "CART_EMPTY")).toBe(true);
    expect(await rows(sql`select id from orders`)).toHaveLength(1);
  });

  it("banyak checkout bersamaan pada stok terbatas: tidak pernah melebihi stok", async () => {
    const f = await physical({ stockQty: 3 });
    const buyers = await Promise.all(Array.from({ length: 6 }, async () => api(ctx, await ctx.buyerCookie())));
    const bodies: object[] = [];
    for (const who of buyers) { await addToCart(f.id, undefined, who); bodies.push(await physicalBody(who)); }
    const results = await Promise.all(buyers.map((who, i) => checkout(bodies[i], who)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await reserved(f.id)).toBe(3);
    const numbers = results.filter((r) => r.status === 201).map((r) => r.body.invoiceNumber).sort();
    expect(numbers).toEqual(["INV/2026/10/0001", "INV/2026/10/0002", "INV/2026/10/0003"]);
  });
});
