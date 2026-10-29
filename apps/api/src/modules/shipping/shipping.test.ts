import { describe, expect, it } from "vitest";
import { createLogger } from "../../logger.js";
import { testConfig } from "../../test/context.js";
import { createFakeShipping } from "./fake.js";
import { createShippingProvider, getRates, type ShippingProvider } from "./index.js";

const UNAVAILABLE = { status: 503, code: "SHIPPING_UNAVAILABLE", message: "Ongkir belum bisa dihitung, coba lagi beberapa saat" }; // F3.6, persis
const NOT_SERVED = { status: 422, code: "AREA_NOT_SERVED", message: "Alamat tujuan ini belum dilayani ekspedisi. Coba pakai alamat lain ya." };
const DEST = { areaId: "area-bandung-cicendo", postalCode: "40172", weightG: 1200 };

const config = (over: Record<string, string> = {}) => testConfig({ SHIPPING_PROVIDER: "fake", SHIPPING_ORIGIN_AREA_ID: "area-cimahi", SHIPPING_TIMEOUT_MS: "100", ...over });
const deps = (shipping: ShippingProvider, over: Record<string, string> = {}) => ({ shipping, config: config(over), logger: createLogger({ logLevel: "silent" }) });

describe("getRates (F3.2)", () => {
  it("mengembalikan pilihan layanan, termurah dulu", async () => {
    const fake = createFakeShipping({
      rates: [
        { courier: "JNE", service: "REG", price: 18000, etdDays: "2-3" },
        { courier: "SiCepat", service: "REG", price: 15000, etdDays: "1-2" },
        { courier: "J&T", service: "EZ", price: 17000, etdDays: null },
      ],
    });
    expect(await getRates(deps(fake), DEST)).toEqual([
      { courier: "SiCepat", service: "REG", price: 15000, etdDays: "1-2" },
      { courier: "J&T", service: "EZ", price: 17000, etdDays: null },
      { courier: "JNE", service: "REG", price: 18000, etdDays: "2-3" },
    ]);
  });

  it("tiruan bawaan punya tarif, supaya pengembangan dan e2e bisa jalan tanpa penyedia sungguhan", async () => {
    const rates = await getRates(deps(createFakeShipping()), DEST);
    expect(rates.length).toBeGreaterThan(0);
    expect(rates.every((r) => Number.isInteger(r.price) && r.price > 0)).toBe(true);
  });
});

describe("data yang dikirim ke penyedia terbatas (N27)", () => {
  it("hanya area asal, area tujuan, kode pos, dan berat", async () => {
    const fake = createFakeShipping();
    await getRates(deps(fake), DEST);
    expect(fake.requests).toEqual([{ originAreaId: "area-cimahi", destinationAreaId: "area-bandung-cicendo", postalCode: "40172", weightG: 1200 }]);
  });

  it("data pribadi yang ikut terbawa pemanggil tidak diteruskan", async () => {
    const fake = createFakeShipping();
    const withPersonal = { ...DEST, recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran 12" };
    await getRates(deps(fake), withPersonal);
    expect(Object.keys(fake.requests[0]).sort()).toEqual(["destinationAreaId", "originAreaId", "postalCode", "weightG"]);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Budi|81234567890|Pajajaran/);
  });
});

describe("gagal mengambil tarif: checkout ditahan, tidak pernah Rp0 (F3.6, N19)", () => {
  it("lewat batas waktu: ditolak dan permintaan ke penyedia dibatalkan", async () => {
    const fake = createFakeShipping({ delayMs: 1000 });
    const t = performance.now();
    await expect(getRates(deps(fake), DEST)).rejects.toMatchObject(UNAVAILABLE);
    expect(performance.now() - t).toBeLessThan(500); // batas 100 ms di konfigurasi tes
    expect(fake.lastSignal?.aborted).toBe(true);
  });

  it("penyedia yang mengabaikan sinyal batal tetap dihentikan tepat waktu", async () => {
    const fake = createFakeShipping({ delayMs: 1000, ignoreAbort: true });
    const t = performance.now();
    await expect(getRates(deps(fake), DEST)).rejects.toMatchObject(UNAVAILABLE);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("error dari penyedia (jaringan, 5xx, kunci API salah): ditolak dengan pesan yang sama", async () => {
    const fake = createFakeShipping({ error: new Error("ECONNRESET") });
    await expect(getRates(deps(fake), DEST)).rejects.toMatchObject(UNAVAILABLE);
  });

  it("tarif Rp0, negatif, pecahan, atau bukan angka dibuang; bila tidak tersisa, ditolak", async () => {
    const bad = [0, -5000, 1500.5, Number.NaN].map((price) => ({ courier: "X", service: "Y", price, etdDays: null }));
    const mixed = createFakeShipping({ rates: [...bad, { courier: "JNE", service: "REG", price: 18000, etdDays: null }] });
    expect((await getRates(deps(mixed), DEST)).map((r) => r.price)).toEqual([18000]);
    await expect(getRates(deps(createFakeShipping({ rates: bad })), DEST)).rejects.toMatchObject(UNAVAILABLE);
  });

  it("penyedia none: selalu ditolak (produksi sebelum penyedia dipilih)", async () => {
    const none = createShippingProvider(config({ SHIPPING_PROVIDER: "none" }));
    await expect(getRates(deps(none), DEST)).rejects.toMatchObject(UNAVAILABLE);
  });
});

describe("wilayah tidak dilayani (F3.7)", () => {
  it("penyedia tidak memberi satu layanan pun: pesan khusus, bukan error umum", async () => {
    await expect(getRates(deps(createFakeShipping({ rates: [] })), DEST)).rejects.toMatchObject(NOT_SERVED);
  });
});

describe("konfigurasi", () => {
  it("bawaan: penyedia none dan batas 5 detik (N19)", () => {
    const c = testConfig();
    expect(c.shipping).toMatchObject({ provider: "none", timeoutMs: 5000 });
  });

  it.each(["5001", "0", "-1", "abc"])("SHIPPING_TIMEOUT_MS=%s ditolak", (ms) => {
    expect(() => testConfig({ SHIPPING_TIMEOUT_MS: ms })).toThrow(/SHIPPING_TIMEOUT_MS/);
  });

  it("penyedia yang tidak dikenal ditolak", () => {
    expect(() => testConfig({ SHIPPING_PROVIDER: "ngawur" })).toThrow(/SHIPPING_PROVIDER/);
  });

  it("tiruan ditolak di produksi", () => {
    expect(() => testConfig({ NODE_ENV: "production", SHIPPING_PROVIDER: "fake" })).toThrow(/SHIPPING_PROVIDER/);
  });

  it("createShippingProvider memilih sesuai konfigurasi", async () => {
    const fake = createShippingProvider(config({ SHIPPING_PROVIDER: "fake" }));
    expect((await getRates(deps(fake), DEST)).length).toBeGreaterThan(0);
  });
});
