import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// T60 (N22, N23, N25, F11.4): ops/check-alerts.sh memeriksa disk, cadangan, sertifikat TLS, tugas pg-boss gagal, email gagal, dan kesehatan layanan,
// lalu mengirim SATU email per masalah. df, openssl, dan curl (SMTP dan health) ditiru lewat PATH; PostgreSQL sungguhan untuk tabel antrean.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SCRIPT = join(__dirname, "check-alerts.sh");
const DB = "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_alerts_test";
const REAL_PGBOSS_DB = "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_test";
const SMTP_PASSWORD = "SANDI-SMTP-JANGAN-BOCOR";
const HOUR = 3600_000;

interface Run { code: number | null; out: string; err: string; all: string }
function sh(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    const c = spawn("bash", [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, out, err, all: out + err }));
  });
}

interface World { rootPct: number; dataPct: number; failApi: boolean; failWeb: boolean; tlsDays: number | null; smtpFails: boolean }
const healthy = (): World => ({ rootPct: 40, dataPct: 40, failApi: false, failWeb: false, tlsDays: 60, smtpFails: false });

let base: string, root: string, bin: string, mails: string, argvLog: string, world: World;
let seq = 0;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, "Z");
const opensslDate = (days: number) => { const d = new Date(Date.now() + days * 86400_000); const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]; const p = (n: number) => String(n).padStart(2, "0"); return `${m} ${String(d.getUTCDate()).padStart(2, " ")} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`; };

function writeStubs(w: World) {
  const put = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  put("df", `target="\${@: -1}"; if [ "$target" = "/" ]; then pct=${w.rootPct}; else pct=${w.dataPct}; fi
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/x 1000000 $((pct*10000)) $(((100-pct)*10000)) \${pct}% $target"`);
  put("openssl", w.tlsDays === null
    ? `exit 1`
    : `case "$1" in s_client) cat >/dev/null; echo "CERT";; x509) cat >/dev/null; echo "notAfter=${opensslDate(w.tlsDays)}";; *) exit 1;; esac`);
  // curl: mode surel bila ada --mail-from; selain itu cek kesehatan
  put("curl", `echo "curl $*" >> "${argvLog}"
if [[ " $* " == *" --mail-from "* ]]; then
  ${w.smtpFails ? 'echo "curl: (7) SMTP gagal" >&2; exit 7' : ""}
  n=$(ls "${mails}" | wc -l); file=""; prev=""; for a in "$@"; do [ "$prev" = "--upload-file" ] && file="$a"; prev="$a"; done
  cp "$file" "${mails}/$((n+1)).eml"; cat "$file" > /dev/null; exit 0
fi
for a in "$@"; do case "$a" in http://127.0.0.1:4000/*) ${w.failApi ? "exit 22" : "echo '{\"status\":\"ok\"}'; exit 0"};; http://127.0.0.1:3000/*) ${w.failWeb ? "exit 22" : "echo '{\"status\":\"ok\"}'; exit 0"};; esac; done
exit 0`);
}

const pool = () => new pg.Pool({ connectionString: DB });
async function resetQueue() {
  const p = pool();
  await p.query("drop schema if exists pgboss cascade");
  await p.query("create schema pgboss");
  await p.query("create table pgboss.job (name text not null, state text not null, completed_on timestamptz, created_on timestamptz not null default now())");
  await p.end();
}
async function addJobs(name: string, state: string, count: number, minutesAgo: number) {
  const p = pool();
  await p.query("insert into pgboss.job (name, state, completed_on) select $1, $2, now() - ($3 || ' minutes')::interval from generate_series(1, $4)", [name, state, String(minutesAgo), count]);
  await p.end();
}

function writeEnv(over: Record<string, string> = {}) {
  const env: Record<string, string> = {
    DATABASE_MIGRATION_URL: DB, ADMIN_ALERT_EMAIL: "pemilik@contoh.test", APP_URL: "https://toko.contoh.test",
    SMTP_HOST: "smtp.contoh.test", SMTP_PORT: "587", SMTP_USER: "pengirim", SMTP_PASSWORD, EMAIL_FROM: "toko@contoh.test", ...over,
  };
  writeFileSync(join(root, "shared/.env"), Object.entries(env).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
}
const backupOk = (msAgo = 2 * HOUR) => writeFileSync(join(root, "shared/backup-status"), `ok ${iso(msAgo)} hayatun-20261030T021000Z.tar.age 12345\n`);
const run = (args: string[] = [], env: Record<string, string> = {}) => { writeStubs(world); return sh(args, { HAYATUN_ROOT: root, PATH: `${bin}:${process.env.PATH}`, ...env }); };
const mailList = () => readdirSync(mails).sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0])).map((f) => readFileSync(join(mails, f), "utf8"));
const subject = (m: string) => /^Subject: (.*)$/m.exec(m)?.[1] ?? "";
const statusOf = (r: Run, id: string) => new RegExp(`^(LULUS|MASALAH|PERIKSA)\\s+${id}\\b`, "m").exec(r.out)?.[1];
const state = () => (existsSync(join(root, "shared/alerts.state")) ? readFileSync(join(root, "shared/alerts.state"), "utf8") : "");

beforeAll(async () => { base = mkdtempSync(join(tmpdir(), "alerts-")); await resetQueue(); });
afterAll(async () => { /* folder di tmp */ });
beforeEach(async () => {
  root = mkdtempSync(join(base, `r${++seq}-`)); bin = join(root, "bin"); mails = join(root, "surel"); argvLog = join(root, "curl.log");
  for (const d of [bin, mails, join(root, "shared")]) mkdirSync(d, { recursive: true });
  writeFileSync(argvLog, ""); world = healthy(); writeEnv(); backupOk();
  await resetQueue();
});

describe("tanpa masalah", () => {
  it("semua pemeriksaan baik: tidak ada email, kode 0, dan tidak ada status peringatan tersimpan", async () => {
    const r = await run();
    expect(r.code, r.all).toBe(0);
    for (const id of ["disk", "cadangan", "tls", "tugas-gagal", "email-gagal", "api", "web"]) expect(statusOf(r, id), `${id}\n${r.out}`).toBe("LULUS");
    expect(mailList()).toEqual([]);
    expect(state().trim()).toBe("");
    expect(r.out).toMatch(/Hasil: 7 baik, 0 masalah/);
  });
});

describe("tiap kondisi memicu tepat satu email berisi alasan yang benar", () => {
  const cases: [string, string, () => Promise<void> | void, RegExp][] = [
    ["disk data 81%", "disk", () => { world.dataPct = 81; }, /81%/],
    ["disk sistem (/) 90%", "disk", () => { world.rootPct = 90; }, /90%/],
    ["cadangan terakhir gagal", "cadangan", () => writeFileSync(join(root, "shared/backup-status"), `gagal ${iso(HOUR)} unggah\n`), /gagal.*unggah|unggah/i],
    ["cadangan sukses tetapi 27 jam lalu", "cadangan", () => backupOk(27 * HOUR), /26 jam|27/],
    ["belum pernah ada status cadangan", "cadangan", () => { writeFileSync(join(root, "shared/backup-status"), ""); }, /belum|tidak ada/i],
    ["sertifikat TLS 13 hari lagi", "tls", () => { world.tlsDays = 13; }, /13 hari|14 hari/],
    ["sertifikat TLS tidak bisa diperiksa", "tls", () => { world.tlsDays = null; }, /tidak bisa|gagal/i],
    ["tugas terjadwal gagal setelah semua percobaan", "tugas-gagal", () => addJobs("orders.sweep", "failed", 1, 20), /orders\.sweep/],
    ["lebih dari 5 email gagal dalam 1 jam", "email-gagal", () => addJobs("email.send", "failed", 6, 30), /6/],
    ["API tidak sehat", "api", () => { world.failApi = true; }, /4000|API/],
    ["web tidak sehat", "web", () => { world.failWeb = true; }, /3000|web/i],
  ];
  it.each(cases)("%s", async (_n, id, setup, reason) => {
    await setup();
    const r = await run();
    expect(statusOf(r, id), r.out).toBe("MASALAH");
    expect(r.code).toBe(1);
    const m = mailList();
    expect(m).toHaveLength(1);
    expect(subject(m[0])).toMatch(/^\[Hayatun\] PERINGATAN: /);
    expect(subject(m[0])).toContain(id);
    expect(m[0]).toMatch(reason);
    expect(m[0]).toMatch(/^To: pemilik@contoh\.test$/m);
    expect(m[0]).toMatch(/^From: toko@contoh\.test$/m);
    expect(state()).toContain(id);
  });
});

describe("batas tepat", () => {
  it("disk 80% lolos, 81% memicu", async () => {
    world.dataPct = 80; expect(statusOf(await run(), "disk")).toBe("LULUS");
    world.dataPct = 81; expect(statusOf(await run(), "disk")).toBe("MASALAH");
  });
  it("email gagal: 5 dalam 1 jam lolos, 6 memicu; yang lebih tua dari 1 jam tidak dihitung", async () => {
    await addJobs("email.send", "failed", 5, 30);
    await addJobs("email.send", "failed", 50, 130);
    expect(statusOf(await run(), "email-gagal")).toBe("LULUS");
    await addJobs("email.send", "failed", 1, 10);
    expect(statusOf(await run(), "email-gagal")).toBe("MASALAH");
  });
  it("tugas gagal lebih dari ~1 jam lalu tidak diperingatkan lagi; tugas email gagal tidak dihitung sebagai tugas terjadwal; yang sukses tidak dihitung", async () => {
    await addJobs("orders.sweep", "failed", 3, 180);
    await addJobs("orders.sweep", "completed", 5, 10);
    await addJobs("email.send", "failed", 2, 10);
    const r = await run();
    expect(statusOf(r, "tugas-gagal")).toBe("LULUS");
    expect(statusOf(r, "email-gagal")).toBe("LULUS");
  });
  it("cadangan 25 jam lolos, TLS 15 hari lolos", async () => {
    backupOk(25 * HOUR); world.tlsDays = 15;
    const r = await run();
    expect(statusOf(r, "cadangan")).toBe("LULUS");
    expect(statusOf(r, "tls")).toBe("LULUS");
  });
});

describe("tidak membanjiri: satu email per masalah, diulang tiap 24 jam, dan email pulih", () => {
  it("masalah yang sama pada jam berikutnya tidak mengirim ulang", async () => {
    world.dataPct = 95;
    await run(); await run(); await run();
    expect(mailList()).toHaveLength(1);
  });

  it("masih bermasalah setelah 24 jam: dikirim lagi sekali", async () => {
    world.dataPct = 95;
    await run();
    const f = join(root, "shared/alerts.state");
    const old = Math.floor((Date.now() - 25 * HOUR) / 1000);
    writeFileSync(f, readFileSync(f, "utf8").replace(/(\S+) (\d+) (\d+)/, `$1 $2 ${old}`));
    await run();
    expect(mailList()).toHaveLength(2);
    await run();
    expect(mailList()).toHaveLength(2);
  });

  it("masalah hilang: satu email PULIH, lalu status dibersihkan dan tidak ada email lagi", async () => {
    world.dataPct = 95; await run();
    world.dataPct = 40;
    const r = await run();
    expect(r.code).toBe(0);
    const m = mailList();
    expect(m).toHaveLength(2);
    expect(subject(m[1])).toMatch(/^\[Hayatun\] PULIH: .*disk/);
    expect(state().trim()).toBe("");
    await run();
    expect(mailList()).toHaveLength(2);
  });

  it("beberapa masalah sekaligus: satu email untuk masing-masing, dan yang lain tetap diperiksa", async () => {
    world.dataPct = 95; world.failApi = true; world.tlsDays = 5;
    const r = await run();
    expect(IDS_WITH_PROBLEM(r)).toEqual(["api", "disk", "tls"]);
    expect(mailList()).toHaveLength(3);
    expect(new Set(mailList().map(subject)).size).toBe(3);
  });
});
function IDS_WITH_PROBLEM(r: Run) { return [...r.out.matchAll(/^MASALAH\s+(\S+)/gm)].map((m) => m[1]).sort(); }

describe("kegagalan sistem peringatan sendiri", () => {
  it("SMTP gagal: peringatan ditulis ke alerts.log, status tidak diperbarui (dicoba lagi jam berikutnya), kode 1, pemeriksaan lain tetap jalan", async () => {
    world.dataPct = 95; world.failApi = true; world.smtpFails = true;
    const r = await run();
    expect(r.code).toBe(1);
    expect(statusOf(r, "disk")).toBe("MASALAH");
    expect(statusOf(r, "api")).toBe("MASALAH");
    expect(mailList()).toEqual([]);
    expect(state().trim()).toBe("");
    expect(readFileSync(join(root, "shared/alerts.log"), "utf8")).toMatch(/disk/);
    world.smtpFails = false;
    await run();
    expect(mailList().length).toBe(2); // terkirim di jam berikutnya
  });

  it("antrean tidak bisa dihubungi: dilaporkan sebagai MASALAH, bukan lolos diam-diam", async () => {
    writeEnv({ DATABASE_MIGRATION_URL: "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/tidak_ada_db" });
    const r = await run();
    expect(statusOf(r, "tugas-gagal")).toBe("MASALAH");
    expect(statusOf(r, "email-gagal")).toBe("MASALAH");
    expect(mailList().some((m) => /antrean|database/i.test(m))).toBe(true);
  });

  it("kueri antrean cocok dengan skema pg-boss yang sebenarnya (database tes e2e yang punya skema pgboss)", async () => {
    writeEnv({ DATABASE_MIGRATION_URL: REAL_PGBOSS_DB });
    const r = await run();
    const real = new pg.Pool({ connectionString: REAL_PGBOSS_DB });
    const has = await real.query("select to_regclass('pgboss.job') as t"); await real.end();
    if (!has.rows[0].t) return; // skema pgboss baru ada setelah API pernah dijalankan terhadap database itu
    expect(statusOf(r, "tugas-gagal"), r.out).not.toBe("MASALAH");
    expect(r.all).not.toMatch(/ERROR|does not exist/i);
  });
});

describe("keamanan", () => {
  it("kata sandi SMTP tidak ada di argumen curl, keluaran, atau surel; berkas netrc dibuang", async () => {
    world.dataPct = 95;
    const r = await run();
    const argv = readFileSync(argvLog, "utf8");
    expect(argv).not.toContain(SMTP_PASSWORD);
    expect(r.all).not.toContain(SMTP_PASSWORD);
    for (const m of mailList()) expect(m).not.toContain(SMTP_PASSWORD);
    expect(readdirSync(join(root, "shared")).filter((f) => /netrc|tmp/.test(f) && f !== "tmp")).toEqual([]);
  });

  it("isi surel tidak memuat alamat penerima pembeli, token, atau rahasia lain dari .env", async () => {
    writeEnv({ SESSION_SECRET: "RAHASIA-SESI-123", DATA_ENCRYPTION_KEYS: "k1:RAHASIA-KUNCI" });
    world.dataPct = 95; world.failApi = true;
    await run();
    for (const m of mailList()) { expect(m).not.toContain("RAHASIA-SESI-123"); expect(m).not.toContain("RAHASIA-KUNCI"); }
  });

  it(".env terlalu terbuka (mode 644) ditolak dengan kode 2", async () => {
    chmodSync(join(root, "shared/.env"), 0o644);
    const r = await run();
    expect(r.code, r.all).toBe(2);
    expect(mailList()).toEqual([]);
  });

  it("tanpa ADMIN_ALERT_EMAIL: kode 2 dan pesan jelas (peringatan tanpa tujuan tidak berguna)", async () => {
    writeEnv({ ADMIN_ALERT_EMAIL: "" });
    const r = await run();
    expect(r.code, r.all).toBe(2);
    expect(r.all).toMatch(/ADMIN_ALERT_EMAIL/);
  });
});

describe("--test-email", () => {
  it("mengirim satu surel uji ke alamat peringatan, tanpa memeriksa apa pun dan tanpa mengubah status", async () => {
    world.dataPct = 99;
    const r = await run(["--test-email"]);
    expect(r.code, r.all).toBe(0);
    const m = mailList();
    expect(m).toHaveLength(1);
    expect(subject(m[0])).toMatch(/UJI/);
    expect(state().trim()).toBe("");
  });

  it("jika SMTP gagal, --test-email keluar dengan kode 1 dan pesan jelas", async () => {
    world.smtpFails = true;
    const r = await run(["--test-email"]);
    expect(r.code).toBe(1);
    expect(r.all).toMatch(/SMTP|surel|email/i);
  });
});
