import { describe, expect, it } from "vitest";
import { formatRupiah } from "./money.js";

describe("formatRupiah", () => {
  it("memakai titik sebagai pemisah ribuan tanpa spasi", () => {
    expect(formatRupiah(150000)).toBe("Rp150.000");
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(1234567)).toBe("Rp1.234.567");
  });
  it("menolak desimal, negatif, dan bukan angka", () => {
    expect(() => formatRupiah(1.5)).toThrow();
    expect(() => formatRupiah(-1)).toThrow();
    expect(() => formatRupiah(NaN)).toThrow();
  });
});
