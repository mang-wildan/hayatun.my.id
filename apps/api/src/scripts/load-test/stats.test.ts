import { describe, expect, it } from "vitest";
import { emailLagViolations, percentile, summarize, violations, type Sample } from "./stats.js";

const s = (action: string, ms: number, ok = true): Sample => ({ action, ms, ok });
const many = (action: string, n: number, ms: number) => Array.from({ length: n }, () => s(action, ms));

describe("percentile (peringkat terdekat)", () => {
  it("p95 dari 1..100 adalah 95, p50 adalah 50, p100 adalah maksimum", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 100)).toBe(100);
  });
  it("urutan masukan tidak berpengaruh dan masukan asli tidak diubah", () => {
    const v = [30, 10, 20];
    expect(percentile(v, 50)).toBe(20);
    expect(v).toEqual([30, 10, 20]);
  });
  it("satu nilai dan daftar kosong", () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBeNull();
  });
  it("p95 dari 20 nilai mengambil nilai ke-19, bukan yang terbesar", () => {
    const v = [...Array.from({ length: 19 }, () => 10), 900];
    expect(percentile(v, 95)).toBe(10);
  });
});

describe("summarize", () => {
  it("ringkasan per aksi (urut nama) dan keseluruhan, galat dihitung terpisah dari latensi", () => {
    const r = summarize([s("b", 10), s("b", 30), s("a", 5), s("b", 20, false)]);
    expect(r.actions.map((a) => a.action)).toEqual(["a", "b"]);
    expect(r.actions[1]).toEqual({ action: "b", count: 3, errors: 1, p50: 20, p95: 30, max: 30 });
    expect(r.overall).toEqual({ action: "keseluruhan", count: 4, errors: 1, p50: 10, p95: 30, max: 30 });
  });
  it("tanpa sampel: nol permintaan dan persentil kosong", () => {
    expect(summarize([]).overall).toEqual({ action: "keseluruhan", count: 0, errors: 0, p50: null, p95: null, max: null });
  });
});

describe("violations (N18: p95 ≤ 500 ms pada 50 pengguna)", () => {
  const good = [...many("katalog", 200, 80), ...many("detail", 200, 120)];
  it("beban yang sehat tidak melanggar apa pun", () => {
    expect(violations(summarize(good))).toEqual([]);
  });
  it("tepat 500 ms lolos, 501 ms melanggar", () => {
    expect(violations(summarize([...many("a", 400, 500)]))).toEqual([]);
    expect(violations(summarize([...many("a", 400, 501)]))).toEqual([
      "aksi \"a\": p95 501 ms melebihi 500 ms",
      "keseluruhan: p95 501 ms melebihi 500 ms",
    ]);
  });
  it("satu aksi lambat melanggar walau keseluruhan masih baik", () => {
    const v = violations(summarize([...many("cepat", 900, 50), ...many("lambat", 100, 800)]));
    expect(v).toEqual(["aksi \"lambat\": p95 800 ms melebihi 500 ms"]);
  });
  it("permintaan gagal (5xx, galat jaringan, atau status tak terduga) melanggar", () => {
    const v = violations(summarize([...good, s("katalog", 10, false), s("katalog", 10, false)]));
    expect(v).toEqual(["aksi \"katalog\": 2 permintaan gagal"]);
  });
  it("sampel terlalu sedikit membuat hasil tidak sah, bukan lolos", () => {
    expect(violations(summarize(many("a", 50, 10)))).toEqual(["hanya 50 permintaan terukur, minimal 300"]);
    expect(violations(summarize([]))).toEqual(["hanya 0 permintaan terukur, minimal 300"]);
  });
  it("anggaran dan batas sampel bisa diubah", () => {
    expect(violations(summarize(many("a", 10, 150)), { budgetMs: 100, minSamples: 5 })).toEqual([
      "aksi \"a\": p95 150 ms melebihi 100 ms",
      "keseluruhan: p95 150 ms melebihi 100 ms",
    ]);
  });
});

describe("emailLagViolations (N20: p95 ≤ 5 menit)", () => {
  const min = 60_000;
  it("semua email datang cepat: lolos", () => {
    expect(emailLagViolations([1000, 5000, 20_000], 3)).toEqual([]);
  });
  it("p95 lebih dari 5 menit melanggar, tepat 5 menit lolos", () => {
    expect(emailLagViolations(Array.from({ length: 20 }, () => 5 * min), 20)).toEqual([]);
    expect(emailLagViolations([...Array.from({ length: 10 }, () => 1000), 5 * min + 1], 11)).toEqual(["email: p95 300001 ms melebihi 300000 ms"]);
  });
  it("email yang tidak pernah tiba melanggar, tidak dilewati diam-diam", () => {
    expect(emailLagViolations([1000, 2000], 5)).toEqual(["email: hanya 2 dari 5 email tiba"]);
    expect(emailLagViolations([], 0)).toEqual(["email: tidak ada email yang diukur"]);
  });
});
