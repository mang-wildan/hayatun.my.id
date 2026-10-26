import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCrypto } from "./index.js";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const blindIndexKey = randomBytes(32);
const c1 = createCrypto({ keys: { k1 }, activeKeyId: "k1", blindIndexKey });
const c2 = createCrypto({ keys: { k1, k2 }, activeKeyId: "k2", blindIndexKey });

// ganti satu karakter base64url di bagian ke-n token "v1:keyId:iv:tag:ct"
const flip = (token: string, part: number) => {
  const p = token.split(":");
  p[part] = (p[part][0] === "A" ? "B" : "A") + p[part].slice(1);
  return p.join(":");
};

describe("encrypt / decrypt", () => {
  it("menyembunyikan isi, memakai IV acak, dan bisa dibuka kembali", () => {
    const t = c1.encrypt("Budi Santoso");
    expect(t.startsWith("v1:k1:")).toBe(true);
    expect(t).not.toContain("Budi");
    expect(c1.encrypt("Budi Santoso")).not.toBe(t);
    expect(c1.decrypt(t)).toBe("Budi Santoso");
  });

  it("string kosong dan Unicode kembali utuh", () => {
    expect(c1.decrypt(c1.encrypt(""))).toBe("");
    const alamat = "Jl. Merdeka No. 1, Bandung — ج ✓ 日本";
    expect(c1.decrypt(c1.encrypt(alamat))).toBe(alamat);
  });

  it("setelah rotasi, data kunci lama tetap terbuka dan data baru memakai kunci aktif", () => {
    const lama = c1.encrypt("rahasia");
    expect(c2.decrypt(lama)).toBe("rahasia");
    expect(c2.encrypt("x").startsWith("v1:k2:")).toBe(true);
  });

  it("menolak ciphertext atau tag yang diubah", () => {
    const t = c1.encrypt("Budi Santoso");
    expect(() => c1.decrypt(flip(t, 4))).toThrow();
    expect(() => c1.decrypt(flip(t, 3))).toThrow();
    expect(() => c1.decrypt(flip(t, 2))).toThrow();
  });

  it("menolak format rusak dan versi yang tidak dikenal", () => {
    expect(() => c1.decrypt("bukan-token")).toThrow();
    expect(() => c1.decrypt("v1:k1:abc")).toThrow();
    expect(() => c1.decrypt(c1.encrypt("x").replace(/^v1:/, "v9:"))).toThrow();
  });

  it("menolak ID kunci yang tidak dikenal dan menyebut ID-nya", () => {
    const dariK2 = c2.encrypt("x");
    expect(() => c1.decrypt(dariK2)).toThrow(/k2/);
  });

  it("menolak konfigurasi yang kunci aktifnya tidak ada atau bukan 32 byte", () => {
    expect(() => createCrypto({ keys: { k1 }, activeKeyId: "k9", blindIndexKey })).toThrow(/k9/);
    expect(() => createCrypto({ keys: { k1: randomBytes(16) }, activeKeyId: "k1", blindIndexKey })).toThrow(/32/);
  });
});

describe("encryptBuffer / decryptBuffer", () => {
  it("bolak-balik utuh dan tidak memuat isi asli", () => {
    const isi = Buffer.from("%PDF-1.7 bukti transfer Rp150.000");
    const enc = c1.encryptBuffer(isi);
    expect(enc.includes(Buffer.from("bukti transfer"))).toBe(false);
    expect(c1.decryptBuffer(enc)).toEqual(isi);
  });

  it("buffer dari kunci lama tetap terbuka setelah rotasi", () => {
    const isi = randomBytes(1000);
    expect(c2.decryptBuffer(c1.encryptBuffer(isi))).toEqual(isi);
  });

  it("menolak buffer yang diubah atau terpotong", () => {
    const enc = c1.encryptBuffer(Buffer.from([1, 2, 3, 4, 5]));
    const ubah = Buffer.from(enc);
    ubah[ubah.length - 1] ^= 0xff;
    expect(() => c1.decryptBuffer(ubah)).toThrow();
    expect(() => c1.decryptBuffer(enc.subarray(0, 10))).toThrow();
  });
});

describe("blindIndex", () => {
  it("sama untuk email yang hanya beda spasi dan huruf besar", () => {
    expect(c1.blindIndex("  Budi@Mail.COM ")).toBe(c1.blindIndex("budi@mail.com"));
  });

  it("menormalkan Unicode (NFKC)", () => {
    expect(c1.blindIndex("ｂｕｄｉ@mail.com")).toBe(c1.blindIndex("budi@mail.com"));
  });

  it("berupa 64 karakter hex dan tidak memuat isi asli", () => {
    const h = c1.blindIndex("budi@mail.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("budi");
  });

  it("berbeda untuk kunci blind index berbeda", () => {
    const lain = createCrypto({ keys: { k1 }, activeKeyId: "k1", blindIndexKey: randomBytes(32) });
    expect(lain.blindIndex("budi@mail.com")).not.toBe(c1.blindIndex("budi@mail.com"));
  });

  it("tidak terpengaruh rotasi kunci enkripsi", () => {
    expect(c2.blindIndex("budi@mail.com")).toBe(c1.blindIndex("budi@mail.com"));
  });
});
