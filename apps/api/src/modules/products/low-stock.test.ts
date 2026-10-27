import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { DIGITAL, PHYSICAL, api, makeProduct } from "../../test/products.js";
import { renderEmail } from "../notifications/templates.js";

const SUBJECT = "Stok produk hampir habis";
let ctx: TestContext;
let admin: string;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminCookie(); // admin1@hayatun.test, aktif
  a = api(ctx, admin);
  await ctx.createUser({ email: "admin-dua@hayatun.test", password: "rahasia-hayatun-1", role: "admin", name: "Siti" });
  await ctx.createUser({ email: "admin-mati@hayatun.test", password: "rahasia-hayatun-1", role: "admin", status: "disabled" });
  await ctx.createUser({ email: "admin-undangan@hayatun.test", role: "admin", status: "invited" });
  await ctx.createUser({ email: "pembeli@hayatun.test", password: "rahasia-hayatun-1" });
});
afterEach(() => ctx.close());

const setStock = (id: string, stockQty: number) => a.patch(`/api/admin/products/${id}`, { stockQty }).expect(200);
const lowStockMails = async () => (await ctx.emails()).filter((m) => m.subject === SUBJECT);

describe("templat low_stock", () => {
  const link = `${APP_URL}/admin/produk/abc`;
  it("subjek tetap; nama produk hanya di isi dan di-escape; tanpa emoji", () => {
    const e = renderEmail("low_stock", { name: "Siti", productName: `<script>alert(1)</script> "Nastar"`, available: 3, link });
    expect(e.subject).toBe(SUBJECT);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.text).toContain("tinggal 3");
    expect(e.text).toContain("Halo Siti");
    expect(e.html).toContain(`href="${link}"`);
    expect(e.text + e.html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("stok 0 ditulis 'sudah habis'; nama dengan baris baru tidak mengubah subjek", () => {
    const e = renderEmail("low_stock", { name: "Siti", productName: "Nastar\r\nBcc: x@y.id", available: 0, link });
    expect(e.text).toContain("sudah habis");
    expect(e.subject).toBe(SUBJECT);
  });

  it("butuh tautan dan jumlah stok", () => {
    expect(() => renderEmail("low_stock", { name: "Siti", productName: "X", available: 3 })).toThrow(/link/);
  });
});

describe("email saat stok turun ke ambang 3 (F9.5, F11.2)", () => {
  it("terkirim ke semua admin aktif saja, berisi nama produk, jumlah, dan tautan ke produk", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await setStock(p.id, 3);
    const mails = await lowStockMails();
    expect(mails.map((m) => m.to).sort()).toEqual(["admin-dua@hayatun.test", "admin1@hayatun.test"]);
    for (const m of mails) {
      expect(m.text).toContain("Kue Kering Nastar");
      expect(m.text).toContain("tinggal 3");
      expect(m.text).toContain(`${APP_URL}/admin/produk/${p.id}`);
    }
    expect(mails.find((m) => m.to === "admin-dua@hayatun.test")!.text).toContain("Halo Siti");
  });

  it("sekali per penurunan: turun lagi saat sudah di bawah ambang tidak mengirim ulang", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await setStock(p.id, 3);
    await setStock(p.id, 2);
    await setStock(p.id, 0);
    expect(await lowStockMails()).toHaveLength(2);
  });

  it("naik di atas ambang mengatur ulang; turun lagi mengirim lagi", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await setStock(p.id, 3);
    await setStock(p.id, 10);
    expect(await lowStockMails()).toHaveLength(2); // naik tidak mengirim
    await setStock(p.id, 3);
    expect(await lowStockMails()).toHaveLength(4);
  });

  it("naik tapi masih di bawah ambang tidak mengirim dan tidak mengatur ulang", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await setStock(p.id, 1);
    await setStock(p.id, 3); // masih ≤ 3
    await setStock(p.id, 2);
    expect(await lowStockMails()).toHaveLength(2); // hanya dari penurunan pertama
  });

  it("produk yang dibuat dengan stok rendah tidak langsung mengirim; penurunan setelahnya mengirim", async () => {
    const p = await makeProduct(ctx, admin, { ...PHYSICAL, stockQty: 2 });
    expect(await lowStockMails()).toHaveLength(0);
    await setStock(p.id, 1);
    expect(await lowStockMails()).toHaveLength(2);
  });

  it("menaikkan stok yang masih rendah (dan belum pernah dikabari) tidak mengirim apa pun", async () => {
    const p = await makeProduct(ctx, admin, { ...PHYSICAL, stockQty: 2 });
    await setStock(p.id, 3);
    expect(await lowStockMails()).toHaveLength(0);
  });

  it("stok tersedia dihitung setelah dikurangi yang ditahan", async () => {
    const p = await makeProduct(ctx, admin, PHYSICAL);
    await ctx.db.execute(sql`update products set stock_reserved = 6 where id = ${p.id}`);
    await setStock(p.id, 8); // tersedia 2
    const mails = await lowStockMails();
    expect(mails).toHaveLength(2);
    expect(mails[0].text).toContain("tinggal 2");
  });

  it("nama produk berbahaya di-escape di email yang terkirim", async () => {
    const p = await makeProduct(ctx, admin, { ...PHYSICAL, name: "<img src=x onerror=1>" });
    await setStock(p.id, 1);
    const [m] = await lowStockMails();
    expect(m.html).not.toContain("<img");
    expect(m.subject).toBe(SUBJECT);
  });

  it("produk digital tanpa lisensi tidak pernah mengirim", async () => {
    const p = await makeProduct(ctx, admin, DIGITAL);
    await a.patch(`/api/admin/products/${p.id}`, { stockQty: 1 }).expect(200);
    expect(await lowStockMails()).toHaveLength(0);
  });
});

describe("checkLowStock (dipakai juga oleh checkout di T28)", () => {
  it("produk berlisensi: terkirim sekali saat kode tersedia turun ke ≤ 3, diatur ulang saat kode ditambah", async () => {
    const { checkLowStock, LOW_STOCK_THRESHOLD } = await import("./low-stock.js");
    expect(LOW_STOCK_THRESHOLD).toBe(3);
    const deps = { db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, now: () => ctx.clock.now };
    const p = await makeProduct(ctx, admin, { ...DIGITAL, name: "Aplikasi Kasir", isLicensed: true });
    await a.post(`/api/admin/products/${p.id}/licenses`, { codes: "K1\nK2\nK3\nK4\nK5" }).expect(200);
    // menahan n kode yang masih tersedia (id berupa UUID acak, jadi tanpa `status = 'available'` kode yang sudah tertahan bisa ikut terpilih dan jumlahnya tidak pasti)
    const reserve = (n: number) => ctx.db.execute(sql`update license_codes set status = 'reserved' where id in (select id from license_codes where product_id = ${p.id} and status = 'available' order by id limit ${n})`);

    await reserve(2); // tersedia 3
    await checkLowStock(deps, p.id);
    expect(await lowStockMails()).toHaveLength(2);
    await checkLowStock(deps, p.id); // sudah dikabari
    expect(await lowStockMails()).toHaveLength(2);

    await a.post(`/api/admin/products/${p.id}/licenses`, { codes: "K6\nK7\nK8\nK9" }).expect(200); // tersedia 7
    await checkLowStock(deps, p.id);
    await reserve(3); // total tertahan 5, tersedia 4 → belum
    await checkLowStock(deps, p.id);
    expect(await lowStockMails()).toHaveLength(2);
    await reserve(3); // total tertahan 8, tersedia 1
    await checkLowStock(deps, p.id);
    expect(await lowStockMails()).toHaveLength(4);
  });
});
