import { describe, expect, it } from "vitest";
import { hashPassword, isCommonPassword, verifyPassword } from "./password.js";

describe("hashPassword / verifyPassword (N3)", () => {
  it("memakai Argon2id dengan parameter minimal OWASP", async () => {
    const h = await hashPassword("rahasia-hayatun-1");
    expect(h.startsWith("$argon2id$")).toBe(true);
    const [, m, t, p] = h.match(/m=(\d+),t=(\d+),p=(\d+)/)!.map(Number);
    expect(m).toBeGreaterThanOrEqual(19456);
    expect(t).toBeGreaterThanOrEqual(2);
    expect(p).toBeGreaterThanOrEqual(1);
  });

  it("hash berbeda untuk password yang sama (salt acak)", async () => {
    expect(await hashPassword("rahasia-hayatun-1")).not.toBe(await hashPassword("rahasia-hayatun-1"));
  });

  it("menerima password yang benar dan menolak yang salah", async () => {
    const h = await hashPassword("rahasia-hayatun-1");
    expect(await verifyPassword(h, "rahasia-hayatun-1")).toBe(true);
    expect(await verifyPassword(h, "rahasia-hayatun-2")).toBe(false);
    expect(await verifyPassword(h, " rahasia-hayatun-1")).toBe(false);
  });

  it("mengembalikan false, bukan error, untuk hash yang rusak", async () => {
    expect(await verifyPassword("bukan-hash", "apa-saja")).toBe(false);
    expect(await verifyPassword("", "apa-saja")).toBe(false);
  });
});

describe("isCommonPassword (N3)", () => {
  it("mengenali password umum tanpa peduli huruf besar", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword("12345678")).toBe(true);
  });

  it("tidak menandai password yang unik", () => {
    expect(isCommonPassword("rahasia-hayatun-1")).toBe(false);
  });

  it("tidak menganggap baris komentar sebagai password", () => {
    expect(isCommonPassword("#")).toBe(false);
  });
});
