import { sql } from "drizzle-orm";
import request from "supertest";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../logger.js";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";

let ctx: TestContext;
let buyer: string;
let b: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  buyer = await ctx.buyerCookie();
  b = api(ctx, buyer);
});
afterEach(() => ctx.close());

const VALID = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "area-bandung-cicendo", postalCode: "40172" };
const create = (over: Record<string, unknown> = {}, who = b) => who.post("/api/addresses", { ...VALID, ...over });
const list = async (who = b) => (await who.get("/api/addresses").expect(200)).body.addresses as Array<Record<string, string>>;

describe("akses", () => {
  it("semua rute butuh login", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    for (const res of [
      await request(ctx.app).get("/api/addresses"),
      await request(ctx.app).post("/api/addresses").send(VALID),
      await request(ctx.app).patch(`/api/addresses/${id}`).send({ postalCode: "40111" }),
      await request(ctx.app).delete(`/api/addresses/${id}`),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("alamat milik orang lain tidak terlihat, tidak bisa diubah, dan tidak bisa dihapus (jawabannya sama dengan tidak ada)", async () => {
    const id = (await create().expect(201)).body.id;
    const other = api(ctx, await ctx.buyerCookie());
    expect(await list(other)).toEqual([]);
    const gone = { code: "ADDRESS_NOT_FOUND", message: "Alamat tidak ditemukan." };
    expect((await other.patch(`/api/addresses/${id}`, { postalCode: "40111" }).expect(404)).body).toMatchObject(gone);
    expect((await other.del(`/api/addresses/${id}`).expect(404)).body).toMatchObject(gone);
    expect((await other.del("/api/addresses/ngawur").expect(404)).body).toMatchObject(gone);
    expect((await list())[0].postalCode).toBe("40172"); // tidak berubah
  });
});

describe("menyimpan dan membaca alamat (F12.1, N27)", () => {
  it("API mengembalikan teks asli dengan nomor HP dinormalisasi", async () => {
    const res = await create().expect(201);
    expect(res.body).toEqual({ id: expect.any(String), ...VALID, phone: "+6281234567890" });
    expect(await list()).toEqual([res.body]);
  });

  it("di database nama, nomor HP, dan alamat terenkripsi; wilayah dan kode pos terbuka (hanya itu yang dikirim ke penyedia ongkir)", async () => {
    await create().expect(201);
    const [row] = (await ctx.db.execute(sql`select * from addresses`)).rows as Array<Record<string, string>>;
    for (const col of ["recipient_enc", "phone_enc", "address_enc"]) expect(row[col], col).not.toMatch(/Budi|8123|Pajajaran/);
    expect(ctx.crypto.decrypt(row.recipient_enc)).toBe("Budi Santoso");
    expect(ctx.crypto.decrypt(row.phone_enc)).toBe("+6281234567890");
    expect(ctx.crypto.decrypt(row.address_enc)).toBe(VALID.address);
    expect(row).toMatchObject({ area_id: "area-bandung-cicendo", postal_code: "40172" });
  });

  it("daftar berurutan dari yang paling lama", async () => {
    await create({ recipient: "Pertama" }).expect(201);
    ctx.clock.advance(1000);
    await create({ recipient: "Kedua" }).expect(201);
    expect((await list()).map((a) => a.recipient)).toEqual(["Pertama", "Kedua"]);
  });

  it("mengubah sebagian kolom; yang lain tetap", async () => {
    const id = (await create().expect(201)).body.id;
    const res = await b.patch(`/api/addresses/${id}`, { postalCode: "40111", phone: "+62 812-9999-0000" }).expect(200);
    expect(res.body).toEqual({ id, ...VALID, postalCode: "40111", phone: "+6281299990000" });
    const [row] = (await ctx.db.execute(sql`select phone_enc, recipient_enc from addresses`)).rows as Array<Record<string, string>>;
    expect(ctx.crypto.decrypt(row.phone_enc)).toBe("+6281299990000");
    expect(ctx.crypto.decrypt(row.recipient_enc)).toBe("Budi Santoso");
  });

  it("menghapus alamat", async () => {
    const id = (await create().expect(201)).body.id;
    await b.del(`/api/addresses/${id}`).expect(204);
    expect(await list()).toEqual([]);
    await b.del(`/api/addresses/${id}`).expect(404);
  });
});

describe("validasi dengan pesan per kolom (N15)", () => {
  it("kolom kosong", async () => {
    const res = await b.post("/api/addresses", {}).expect(422);
    expect(res.body.fields).toEqual({
      recipient: "Nama penerima diisi dulu ya.",
      phone: "Nomor HP diisi dulu ya.",
      address: "Alamat lengkap diisi dulu ya.",
      areaId: "Pilih wilayah tujuan dulu ya.",
      postalCode: "Kode pos terdiri dari 5 angka.",
    });
    expect(await list()).toEqual([]);
  });

  it.each([
    [{ phone: "12345" }, "phone", "Format nomor HP belum benar. Contoh: 081234567890."],
    [{ phone: "0812abc" }, "phone", "Format nomor HP belum benar. Contoh: 081234567890."],
    [{ phone: "0812345678901234567" }, "phone", "Format nomor HP belum benar. Contoh: 081234567890."],
    [{ address: "Jl. Pendek" }, "address", "Alamat terlalu pendek, tulis jalan, nomor, RT/RW, dan kelurahan."],
    [{ address: "x".repeat(301) }, "address", "Alamat maksimal 300 karakter."],
    [{ recipient: "x".repeat(101) }, "recipient", "Nama penerima maksimal 100 karakter."],
    [{ postalCode: "4017" }, "postalCode", "Kode pos terdiri dari 5 angka."],
    [{ postalCode: "40a72" }, "postalCode", "Kode pos terdiri dari 5 angka."],
  ])("%j", async (over, field, message) => {
    expect((await create(over).expect(422)).body.fields[field]).toBe(message);
  });

  it.each([["081234567890"], ["+6281234567890"], ["6281234567890"], ["0812-3456-7890"], ["+62 812 3456 7890"]])("nomor HP %s dinormalisasi", async (phone) => {
    expect((await create({ phone }).expect(201)).body.phone).toBe("+6281234567890");
  });

  it("ubah dengan nilai tidak sah ditolak dan tidak mengubah apa pun", async () => {
    const id = (await create().expect(201)).body.id;
    expect((await b.patch(`/api/addresses/${id}`, { postalCode: "1" }).expect(422)).body.fields.postalCode).toBeTruthy();
    expect((await list())[0].postalCode).toBe("40172");
  });
});

describe("batas 5 alamat per akun", () => {
  it("alamat ke-6 ditolak; setelah satu dihapus bisa lagi", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await create({ recipient: `Penerima ${i}` }).expect(201)).body.id);
    expect((await create().expect(422)).body).toMatchObject({ code: "TOO_MANY_ADDRESSES", message: "Maksimal 5 alamat. Hapus yang tidak dipakai dulu ya." });
    await b.del(`/api/addresses/${ids[0]}`).expect(204);
    await create().expect(201);
  });

  it("batas dihitung per akun", async () => {
    for (let i = 0; i < 5; i++) await create().expect(201);
    await create({}, api(ctx, await ctx.buyerCookie())).expect(201);
  });

  it("penambahan bersamaan tidak bisa melewati batas", async () => {
    for (let i = 0; i < 3; i++) await create().expect(201);
    const results = await Promise.all(Array.from({ length: 6 }, () => create()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await list()).toHaveLength(5);
  });
});

describe("alamat tidak diminta untuk keranjang digital (F3.3)", () => {
  const admin = () => ctx.adminCookie();
  async function publish(over: Record<string, unknown> = {}) {
    const a = api(ctx, await admin());
    const p = await makeProduct(ctx, await admin(), over);
    if ((over.type ?? "digital") === "digital") await a.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await a.post(`/api/admin/products/${p.id}/activate`).expect(200);
    return p;
  }
  const requires = async () => (await b.get("/api/cart").expect(200)).body.requiresAddress;

  it("keranjang kosong dan keranjang digital: tidak perlu alamat atau nomor HP", async () => {
    expect(await requires()).toBe(false);
    await b.post("/api/cart/items", { productId: (await publish()).id }).expect(201);
    expect(await requires()).toBe(false);
  });

  it("ada produk fisik, termasuk dalam keranjang campuran: perlu alamat", async () => {
    await b.post("/api/cart/items", { productId: (await publish()).id }).expect(201);
    await b.post("/api/cart/items", { productId: (await publish({ ...PHYSICAL })).id }).expect(201);
    expect(await requires()).toBe(true);
  });

  it("hanya produk fisik: perlu alamat; dihapus lagi: tidak perlu", async () => {
    const f = await publish({ ...PHYSICAL });
    await b.post("/api/cart/items", { productId: f.id }).expect(201);
    expect(await requires()).toBe(true);
    await b.del(`/api/cart/items/${f.id}`).expect(204);
    expect(await requires()).toBe(false);
  });
});

describe("log tidak memuat data alamat (N30, N27)", () => {
  it("nama penerima, nomor HP, dan alamat disamarkan", () => {
    let out = "";
    const logger = createLogger({ logLevel: "info" }, new Writable({ write(chunk, _e, done) { out += chunk; done(); } }));
    logger.info({ recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran 12", body: { recipient: "Budi Santoso", phone: "0812", address: "Jl. Pajajaran 12" } }, "alamat");
    expect(out).not.toMatch(/Budi|0812|Pajajaran/);
  });
});
