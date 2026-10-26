import { describe, expect, it } from "vitest";
import { formatWIB } from "./datetime.js";

describe("formatWIB", () => {
  it("menampilkan tanggal dan jam WIB", () => {
    expect(formatWIB(new Date("2026-10-26T07:30:00Z"))).toBe("26 Okt 2026, 14.30 WIB");
  });
  it("berganti hari dan tahun mengikuti WIB, bukan UTC", () => {
    expect(formatWIB(new Date("2026-12-31T17:05:00Z"))).toBe("1 Jan 2027, 00.05 WIB");
  });
});
