import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// T60 (N30: log teknis disimpan 90 hari): ops/logrotate/hayatun dijalankan oleh logrotate sungguhan pada log sementara.
const CONF = join(__dirname, "logrotate", "hayatun");
const LR_ROOT = "/opt/logrotate-root";
const candidates = [process.env.LOGROTATE_BIN, "/usr/sbin/logrotate", "/usr/local/sbin/logrotate", join(LR_ROOT, "usr/sbin/logrotate")].filter(Boolean) as string[];
const BIN = candidates.find((c) => existsSync(c)) ?? spawnSync("sh", ["-c", "command -v logrotate"], { encoding: "utf8" }).stdout.trim();
if (!BIN && process.env.CI) throw new Error("logrotate wajib ada di CI (pasang paket logrotate)");
const suite = BIN ? describe : describe.skip;
const LIBS = BIN?.startsWith(LR_ROOT) ? `${LR_ROOT}/usr/lib/x86_64-linux-gnu:${LR_ROOT}/lib/x86_64-linux-gnu` : "";

const work = mkdtempSync(join(tmpdir(), "logrotate-"));
const killers: (() => void)[] = [];
afterAll(() => { for (const k of killers) k(); });

const day = (n: number) => { const d = new Date(Date.now() - n * 86400_000); return d.toISOString().slice(0, 10).replaceAll("-", ""); };

// konfigurasi produksi dengan jalur diarahkan ke folder sementara; "su hayatun hayatun" dibuang karena pengguna itu tidak ada di mesin uji
function setup(extra: { pidFile?: string } = {}) {
  const dir = mkdtempSync(join(work, "k-"));
  const logs = join(dir, "logs"), nginx = join(dir, "nginx");
  mkdirSync(logs); mkdirSync(nginx);
  let text = readFileSync(CONF, "utf8")
    .replaceAll("/srv/hayatun/shared/logs", logs)
    .replaceAll("/www/wwwlogs", nginx)
    .replace(/^\s*su\s+hayatun\s+hayatun\s*$/gm, "");
  if (extra.pidFile) text = text.replaceAll(/\/www\/server\/nginx\/logs\/nginx\.pid|\/run\/nginx\.pid/g, extra.pidFile);
  const conf = join(dir, "hayatun.conf");
  writeFileSync(conf, text, { mode: 0o644 });
  return { dir, logs, nginx, conf, state: join(dir, "state") };
}
function lr(args: string[], conf: string, state: string) {
  const r = spawnSync(BIN, [...args, "-s", state, conf], { encoding: "utf8", env: { ...process.env, ...(LIBS ? { LD_LIBRARY_PATH: LIBS } : {}) } });
  return { code: r.status, all: `${r.stdout}${r.stderr}` };
}
const names = (dir: string, prefix: string) => readdirSync(dir).filter((f) => f.startsWith(prefix));

suite("ops/logrotate/hayatun", () => {
  it("isi konfigurasi: harian, 90 rotasi, kompresi, copytruncate, dan tidak gagal bila log belum ada", () => {
    const t = readFileSync(CONF, "utf8");
    for (const re of [/^\s*daily\s*$/m, /^\s*rotate 90\s*$/m, /^\s*compress\s*$/m, /^\s*delaycompress\s*$/m, /^\s*copytruncate\s*$/m, /^\s*missingok\s*$/m, /^\s*notifempty\s*$/m, /^\s*dateext\s*$/m, /^\s*su hayatun hayatun\s*$/m]) expect(t, String(re)).toMatch(re);
    expect(t).toContain("/srv/hayatun/shared/logs/*.log");
    expect(t).not.toMatch(/rotate (?!90\b)\d+/); // tidak ada blok dengan jumlah rotasi lain
  });

  it("logrotate -d membaca konfigurasi tanpa galat dan memakai 90 rotasi untuk log aplikasi", () => {
    const k = setup();
    writeFileSync(join(k.logs, "api.out.log"), "baris\n");
    const r = lr(["-d"], k.conf, k.state);
    expect(r.code, r.all).toBe(0);
    expect(r.all).not.toMatch(/error:/i);
    expect(r.all).toMatch(/api\.out\.log/);
    expect(r.all).toMatch(/90 rotations/);
  });

  it("putaran sungguhan: tepat 90 arsip tersisa dari 95, yang terlama dihapus, yang baru ada", () => {
    const k = setup();
    writeFileSync(join(k.logs, "api.out.log"), "isi log hari ini\n");
    for (let n = 1; n <= 95; n++) writeFileSync(join(k.logs, `api.out.log-${day(n)}.gz`), "x");
    const r = lr(["-f"], k.conf, k.state);
    expect(r.code, r.all).toBe(0);
    const rotated = names(k.logs, "api.out.log-");
    expect(rotated).toHaveLength(90);
    expect(rotated).toContain(`api.out.log-${day(0)}`); // yang baru, belum dikompres (delaycompress)
    expect(rotated).toContain(`api.out.log-${day(1)}.gz`);
    expect(rotated).not.toContain(`api.out.log-${day(95)}.gz`);
    expect(rotated).not.toContain(`api.out.log-${day(90)}.gz`);
    expect(readFileSync(join(k.logs, `api.out.log-${day(0)}`), "utf8")).toBe("isi log hari ini\n");
  });

  it("copytruncate: berkas log aktif tetap ada (sama inode) dan kosong, supaya PM2 yang menahannya terbuka terus menulis", () => {
    const k = setup();
    const f = join(k.logs, "api.out.log");
    writeFileSync(f, "isi\n");
    const ino = statSync(f).ino;
    expect(lr(["-f"], k.conf, k.state).code).toBe(0);
    expect(statSync(f).ino).toBe(ino);
    expect(statSync(f).size).toBe(0);
  });

  it("semua log PM2 (api dan web, out dan err) dirotasi dengan satu pola; log kosong tidak dirotasi; pola tanpa berkas tidak membuat galat", () => {
    const k = setup();
    for (const n of ["api.out.log", "api.err.log", "web.out.log"]) writeFileSync(join(k.logs, n), `isi ${n}\n`);
    writeFileSync(join(k.logs, "web.err.log"), ""); // kosong
    const r = lr(["-f"], k.conf, k.state);
    expect(r.code, r.all).toBe(0);
    for (const n of ["api.out.log", "api.err.log", "web.out.log"]) expect(names(k.logs, `${n}-`), n).toHaveLength(1);
    expect(names(k.logs, "web.err.log-")).toEqual([]); // notifempty
    const empty = setup();
    expect(lr(["-f"], empty.conf, empty.state).code).toBe(0); // folder tanpa log sama sekali
  });

  it("log Nginx: 90 rotasi dan postrotate benar-benar mengirim USR1 ke proses Nginx", async () => {
    const dir = mkdtempSync(join(work, "sinyal-"));
    const marker = join(dir, "usr1.txt");
    const child = spawn("bash", ["-c", `trap 'echo diterima > ${marker}' USR1; while :; do sleep 0.1; done`], { stdio: "ignore" });
    killers.push(() => child.kill());
    const pidFile = join(dir, "nginx.pid"); writeFileSync(pidFile, String(child.pid));
    const k = setup({ pidFile });
    writeFileSync(join(k.nginx, "hayatun.my.id.log"), "akses\n");
    writeFileSync(join(k.nginx, "hayatun.my.id.error.log"), "galat\n");
    for (let n = 1; n <= 95; n++) writeFileSync(join(k.nginx, `hayatun.my.id.log-${day(n)}.gz`), "x");
    await new Promise((r) => setTimeout(r, 300));
    const r = lr(["-f"], k.conf, k.state);
    expect(r.code, r.all).toBe(0);
    expect(names(k.nginx, "hayatun.my.id.log-")).toHaveLength(90);
    expect(names(k.nginx, "hayatun.my.id.error.log-")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(existsSync(marker), "Nginx diminta membuka ulang berkas lognya").toBe(true);
  });

  it("log Nginx yang dirotasi tetap berhak akses terbatas (error_log memuat baris permintaan: tidak boleh terbaca umum)", () => {
    const k = setup();
    const f = join(k.nginx, "hayatun.my.id.error.log");
    writeFileSync(f, "galat\n", { mode: 0o640 });
    expect(lr(["-f"], k.conf, k.state).code).toBe(0);
    for (const rotated of names(k.nginx, "hayatun.my.id.error.log-")) expect(statSync(join(k.nginx, rotated)).mode & 0o007, rotated).toBe(0);
    expect(statSync(f).mode & 0o007).toBe(0);
  });
});
