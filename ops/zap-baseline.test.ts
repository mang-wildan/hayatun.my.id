import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// ops/zap-baseline.sh menjalankan ZAP lewat Docker. Di sini `docker` ditiru lewat PATH: ia menulis laporan JSON tiruan ke folder yang
// dipasang (-v DIR:/zap/wrk), sehingga logika keputusan (tinggi/sedang/diabaikan, kode keluar, daftar URL) teruji tanpa daemon Docker.
// ZAP sungguhan baru berjalan di CI (job `zap`) dan di staging; itu tidak bisa dibuktikan oleh berkas ini.
const SCRIPT = join(__dirname, "zap-baseline.sh");

interface Alert { pluginid: string; alert: string; riskcode: string }
const alert = (pluginid: string, name: string, riskcode: string): Alert => ({ pluginid, alert: name, riskcode });
const HIGH = alert("40018", "SQL Injection", "3");
const MEDIUM = alert("10038", "Content Security Policy (CSP) Header Not Set", "2");
const LOW = alert("10020", "Missing Anti-clickjacking Header", "1");
const report = (...alerts: Alert[]) => JSON.stringify({ "@version": "2.16.0", site: [{ "@name": "http://127.0.0.1:3000", alerts: alerts.map((a) => ({ ...a, riskdesc: "x", instances: [{ uri: "http://127.0.0.1:3000/" }] })) }] });

interface Opts { report?: string | null; dockerExit?: number; noDocker?: boolean; ignore?: string | null; env?: Record<string, string> }
function run(url: string | undefined, o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zap-"));
  const bin = join(dir, "bin"), out = join(dir, "laporan"), log = join(dir, "docker.log");
  mkdirSync(bin);
  if (!o.noDocker) {
    // mencatat argumen satu per baris, lalu menulis laporan ke folder yang dipasang
    writeFileSync(join(bin, "docker"), `#!/bin/bash
printf '%s\\n' "$@" > "${log}"
for a in "$@"; do case "$a" in *:/zap/wrk*) wrk="\${a%%:/zap/wrk*}";; esac; done
${o.report === null || o.report === undefined ? "" : `printf '%s' '${o.report.replace(/'/g, `'\\''`)}' > "$wrk/zap.json"`}
echo "ZAP selesai (tiruan)"
exit ${o.dockerExit ?? 0}
`);
    chmodSync(join(bin, "docker"), 0o755);
  }
  const ignore = join(dir, "zap-ignore.txt");
  if (o.ignore !== null && o.ignore !== undefined) writeFileSync(ignore, o.ignore);
  const r = spawnSync("bash", [SCRIPT, ...(url === undefined ? [] : [url])], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, ZAP_REPORT_DIR: out, ZAP_IGNORE_FILE: ignore, ...o.env },
  });
  const args = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", args, dockerCalled: existsSync(log), reportDir: out };
}
const LOCAL = "http://127.0.0.1:3000";

describe("hasil pemindaian", () => {
  it("tanpa temuan: keluar 0 dan ringkasan 0 tinggi", () => {
    const r = run(LOCAL, { report: report() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Hasil: 0 tinggi, 0 sedang/);
  });
  it("temuan tinggi (riskcode 3): keluar 1 dan menyebut id serta nama temuannya", () => {
    const r = run(LOCAL, { report: report(HIGH, MEDIUM) });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^TINGGI\s+40018\s+SQL Injection/m);
    expect(r.out).toMatch(/Hasil: 1 tinggi, 1 sedang/);
  });
  it("kritis (riskcode di atas 3, jaga-jaga bila format berubah) juga menggagalkan", () => {
    expect(run(LOCAL, { report: report(alert("1", "Kritis", "4")) }).code).toBe(1);
  });
  it("hanya sedang dan rendah: keluar 0, sedang tetap dicantumkan supaya dibaca", () => {
    const r = run(LOCAL, { report: report(MEDIUM, LOW) });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^SEDANG\s+10038\s+Content Security Policy/m);
    expect(r.out).not.toMatch(/^TINGGI/m);
  });
  it("beberapa situs/target dalam satu laporan dihitung semua", () => {
    const two = JSON.stringify({ site: [{ alerts: [MEDIUM] }, { alerts: [HIGH] }] });
    expect(run(LOCAL, { report: two }).code).toBe(1);
  });
  it("situs tanpa daftar alerts dianggap bersih, bukan galat", () => {
    expect(run(LOCAL, { report: JSON.stringify({ site: [{ "@name": LOCAL }] }) }).code).toBe(0);
  });
});

describe("daftar abaikan (zap-ignore.txt)", () => {
  it("temuan tinggi yang diabaikan dengan alasan tidak menggagalkan, tetapi tetap dicetak sebagai DIABAIKAN beserta alasannya", () => {
    const r = run(LOCAL, { report: report(HIGH), ignore: "# komentar\n40018 positif palsu: parameter tidak dipakai di kueri, dicek 2026-10-30\n" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^DIABAIKAN\s+40018\s+SQL Injection.*positif palsu/m);
    expect(r.out).toMatch(/Hasil: 0 tinggi, 0 sedang, 1 diabaikan/);
  });
  it("baris tanpa alasan ditolak (keluar 2) sebelum memindai", () => {
    const r = run(LOCAL, { report: report(HIGH), ignore: "40018\n" });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/alasan/);
    expect(r.dockerCalled).toBe(false);
  });
  it("id yang bukan angka ditolak", () => {
    expect(run(LOCAL, { report: report(), ignore: "semua karena malas\n" }).code).toBe(2);
  });
  it("mengabaikan satu id tidak mengabaikan id lain", () => {
    const r = run(LOCAL, { report: report(HIGH, alert("90001", "Lain", "3")), ignore: "40018 alasan yang jelas\n" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^TINGGI\s+90001/m);
  });
  it("tanpa berkas abaikan sama sekali, pemindaian tetap jalan", () => {
    expect(run(LOCAL, { report: report(), ignore: null }).code).toBe(0);
  });
});

describe("galat pemindaian (keluar 2, tidak pernah lulus diam-diam)", () => {
  it("docker tidak terpasang", () => {
    const r = run(LOCAL, { noDocker: true });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/docker/i);
  });
  it("ZAP berhasil dijalankan tetapi laporan tidak ada", () => {
    const r = run(LOCAL, { report: null });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/laporan/);
  });
  it("laporan rusak (bukan JSON)", () => {
    expect(run(LOCAL, { report: "<html>galat</html>" }).code).toBe(2);
  });
  it("laporan JSON tanpa daftar situs", () => {
    expect(run(LOCAL, { report: "{}" }).code).toBe(2);
  });
  it("ZAP sendiri galat (kode 3) walau ada laporan: tidak dipercaya", () => {
    expect(run(LOCAL, { report: report(), dockerExit: 3 }).code).toBe(2);
  });
  it("kode 1 dan 2 dari ZAP (peringatan/gagal aturan) bukan galat: keputusan tetap dari laporan", () => {
    expect(run(LOCAL, { report: report(MEDIUM), dockerExit: 2 }).code).toBe(0);
    expect(run(LOCAL, { report: report(HIGH), dockerExit: 1 }).code).toBe(1);
  });
  it("laporan lama di folder tidak dipakai: dihapus sebelum memindai", () => {
    const dir = mkdtempSync(join(tmpdir(), "zap-lama-"));
    writeFileSync(join(dir, "zap.json"), report());
    const r = run(LOCAL, { report: null, env: { ZAP_REPORT_DIR: dir } });
    expect(r.code).toBe(2);
  });
});

describe("daftar URL sasaran (tidak boleh memindai situs orang lain)", () => {
  const ok = ["https://hayatun.my.id", "https://hayatun.my.id/", "https://staging.hayatun.my.id", "https://www.hayatun.my.id/produk", "http://127.0.0.1:3000", "http://localhost:3000"];
  const bad = [
    "https://contoh.com", "https://hayatun.my.id.contoh.com", "https://contoh.com/hayatun.my.id", "https://hayatun.my.id@contoh.com",
    "https://contoh.com#hayatun.my.id", "https://nothayatun.my.id", "http://hayatun.my.id", "http://staging.hayatun.my.id",
    "ftp://hayatun.my.id", "hayatun.my.id", "http://127.0.0.1.contoh.com", "http://localhost@contoh.com", "", "https://hayatun.my.id:8443@contoh.com",
  ];
  for (const url of ok) it(`menerima ${url}`, () => {
    const r = run(url, { report: report() });
    expect(r.code, r.err).toBe(0);
    expect(r.args).toContain(url);
  });
  for (const url of bad) it(`menolak ${JSON.stringify(url)} tanpa menjalankan docker`, () => {
    const r = run(url, { report: report() });
    expect(r.code).toBe(2);
    expect(r.dockerCalled).toBe(false);
  });
  it("tanpa argumen: pemakaian ditampilkan, keluar 2", () => {
    const r = run(undefined, { report: report() });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Pemakaian/);
    expect(r.dockerCalled).toBe(false);
  });
  it("argumen berlebih ditolak", () => {
    const r = spawnSync("bash", [SCRIPT, LOCAL, "https://contoh.com"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(r.status).toBe(2);
  });
});

describe("perintah docker yang dijalankan", () => {
  const r = run(LOCAL, { report: report() });
  const has = (a: string) => r.args.includes(a);
  it("pemindaian baseline pasif saja: bukan full-scan atau mode aktif", () => {
    expect(has("zap-baseline.py")).toBe(true);
    expect(r.args.join(" ")).not.toMatch(/zap-full-scan|zap-api-scan|(^| )-a( |$)/);
  });
  it("sasaran persis URL yang diminta, laporan JSON dan HTML, ZAP tidak ikut gagal karena peringatan (-I)", () => {
    const i = r.args.indexOf("-t");
    expect(r.args[i + 1]).toBe(LOCAL);
    expect(r.args[r.args.indexOf("-J") + 1]).toBe("zap.json");
    expect(r.args[r.args.indexOf("-r") + 1]).toBe("zap.html");
    expect(has("-I")).toBe(true);
  });
  it("kontainer dibuang setelah selesai dan memakai jaringan host (agar 127.0.0.1 terjangkau)", () => {
    expect(has("--rm")).toBe(true);
    expect(r.args[r.args.indexOf("--network") + 1]).toBe("host");
  });
  it("citra ZAP dikunci dengan digest sha256, bukan tag yang bisa berpindah", () => {
    expect(r.args.some((a) => /^ghcr\.io\/zaproxy\/zaproxy@sha256:[0-9a-f]{64}$/.test(a))).toBe(true);
  });
  it("ZAP_IMAGE dapat diganti dari lingkungan (untuk menguji citra baru)", () => {
    const x = run(LOCAL, { report: report(), env: { ZAP_IMAGE: "contoh/zap:uji" } });
    expect(x.args).toContain("contoh/zap:uji");
  });
  it("folder laporan dipasang ke /zap/wrk dan dapat ditulis oleh pengguna zap di kontainer", () => {
    const mount = r.args[r.args.indexOf("-v") + 1];
    expect(mount).toBe(`${r.reportDir}:/zap/wrk:rw`);
    expect(existsSync(join(r.reportDir, "zap.json"))).toBe(true);
  });
});
