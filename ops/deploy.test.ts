import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// ops/deploy.sh dijalankan dengan git, npm, pm2, curl, dan id palsu di PATH, di atas folder sementara sungguhan
// (tautan simbolik, kunci, dan penghapusan rilis lama sungguhan). Tidak butuh server.
const SCRIPT = join(__dirname, "deploy.sh");
const ECOSYSTEM = join(__dirname, "ecosystem.config.cjs");

interface Opts {
  user?: string; hasPm2?: boolean; envMode?: number | null; tagExists?: boolean;
  failCi?: boolean; failBuild?: boolean; failMigrate?: boolean; failPm2?: boolean;
  badHealthTag?: string; allBad?: boolean; // health palsu gagal bila current menunjuk rilis ini / selalu
  current?: string; previous?: string; releases?: string[];
}
function setup(o: Opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  const bin = join(root, "stub-bin");
  const log = join(root, "dipanggil.log");
  for (const d of ["stub-bin", "repo", "releases", "shared"]) mkdirSync(join(root, d));
  if (o.envMode !== null) { writeFileSync(join(root, "shared/.env"), "DATABASE_MIGRATION_URL=postgres://x\nSESSION_SECRET=RAHASIA-JANGAN-DICETAK\n"); chmodSync(join(root, "shared/.env"), o.envMode ?? 0o600); }
  const releases = new Set([...(o.releases ?? []), ...(o.current ? [o.current] : []), ...(o.previous ? [o.previous] : [])]);
  let t = 1_700_000_000;
  for (const r of releases) {
    const d = join(root, "releases", r); mkdirSync(d);
    const when = new Date((t += 100) * 1000); spawnSync("touch", ["-d", when.toISOString(), d]);
  }
  if (o.current) symlinkSync(join(root, "releases", o.current), join(root, "current"));
  if (o.previous) writeFileSync(join(root, "shared/previous"), `${o.previous}\n`);
  const put = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $* [cwd=$(basename "$PWD")]" >> "${log}"\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  put("id", `[ "$1" = "-un" ] && echo ${o.user ?? "hayatun"} || exit 1`);
  put("git", `case "$*" in
  *"rev-parse"*|*"ls-remote"*) ${o.tagExists === false ? "exit 1" : "echo abc123"};;
  *"worktree add"*) a=("$@"); pos=(); seen=0; for x in "\${a[@]}"; do [ "$seen" = 1 ] && [[ "$x" != -* ]] && pos+=("$x"); [ "$x" = add ] && seen=1; done
     dest="\${pos[0]}"; mkdir -p "$dest/ops" "$dest/apps/api" "$dest/apps/web"; echo "\${pos[1]}" > "$dest/VERSI"; cp "${ECOSYSTEM}" "$dest/ops/ecosystem.config.cjs" 2>/dev/null || true;;
  *) ;;
esac`);
  put("npm", `case "$*" in
  "ci") ${o.failCi ? "echo 'npm ci gagal' >&2; exit 1" : "true"};;
  "run build") ${o.failBuild ? "echo 'build gagal' >&2; exit 1" : "true"};;
  *db:migrate*) ${o.failMigrate ? "echo 'migrasi gagal' >&2; exit 1" : "true"};;
esac`);
  put("pm2", o.failPm2 ? 'case "$*" in *hayatun-web*) exit 1;; esac' : "true");
  put("curl", `cur="$(basename "$(readlink "${root}/current" 2>/dev/null)")"
${o.allBad ? "exit 22" : o.badHealthTag ? `[ "$cur" = "${o.badHealthTag}" ] && exit 22` : ""}
echo '{"status":"ok"}'`);
  if (o.hasPm2 === false) spawnSync("rm", ["-f", join(bin, "pm2")]);
  return { root, bin, log, calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
}

type Setup = ReturnType<typeof setup>;
function run(s: Setup, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${s.bin}:/usr/bin:/bin`, HAYATUN_ROOT: s.root, HEALTH_RETRIES: "3", HEALTH_INTERVAL: "0", HOME: s.root, ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", all: `${r.stdout}${r.stderr}` };
}
const current = (s: Setup) => (existsSync(join(s.root, "current")) ? basename(readlinkSync(join(s.root, "current"))) : null);
const releases = (s: Setup) => readdirSync(join(s.root, "releases")).sort();
const idx = (calls: string[], re: RegExp) => calls.findIndex((c) => re.test(c));
const pm2Calls = (s: Setup) => s.calls().filter((c) => c.startsWith("pm2 "));

describe("deploy sukses", () => {
  it("rilis baru diambil, dibangun, dimigrasi, dialihkan, lalu API di-reload sebelum web dan dicek kesehatannya", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, ["v1.1.0"]);
    expect(r.code, r.all).toBe(0);
    expect(current(s)).toBe("v1.1.0");
    expect(readFileSync(join(s.root, "shared/previous"), "utf8").trim()).toBe("v1.0.0");
    const c = s.calls();
    const fetchAt = idx(c, /git .*fetch/);
    // rev-parse pertama adalah pemeriksaan prasyarat sebelum fetch; yang dihitung di urutan adalah yang sesudah fetch
    const revParseAfterFetch = c.findIndex((x, i) => i > fetchAt && /git .*rev-parse/.test(x));
    const order = [fetchAt, revParseAfterFetch, ...[/git .*worktree add/, /^npm ci/, /^npm run build/, /^npm .*db:migrate/, /^pm2 .*hayatun-api/, /^pm2 .*hayatun-web/, /^curl .*4000\/api\/health/, /^curl .*3000\/api\/health/].map((re) => idx(c, re))];
    expect(order.every((i) => i >= 0), c.join("\n")).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // urutan persis
    expect(readFileSync(join(s.root, "shared/deploy.log"), "utf8")).toMatch(/v1\.1\.0.*ok/);
  });

  it("npm ci dan build berjalan di folder rilis baru, bukan di rilis aktif", () => {
    const s = setup({ current: "v1.0.0" });
    run(s, ["v1.1.0"]);
    const ci = s.calls().find((c) => c.startsWith("npm ci"))!;
    expect(ci).toContain("[cwd=v1.1.0]");
  });

  it("deploy pertama (belum ada rilis aktif) berhasil dan current menunjuk rilis itu", () => {
    const s = setup();
    expect(run(s, ["v1.0.0"]).code).toBe(0);
    expect(current(s)).toBe("v1.0.0");
  });

  it("isi .env tidak pernah dicetak", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, ["v1.1.0"]);
    expect(r.all).not.toContain("RAHASIA-JANGAN-DICETAK");
    expect(readFileSync(join(s.root, "shared/deploy.log"), "utf8")).not.toContain("RAHASIA");
  });

  it("tautan current dipindah atomik: tidak pernah ada saat current hilang (tautan sementara lalu rename)", () => {
    const s = setup({ current: "v1.0.0" });
    run(s, ["v1.1.0"]);
    expect(lstatSync(join(s.root, "current")).isSymbolicLink()).toBe(true);
    expect(readdirSync(s.root).filter((f) => f.startsWith("current."))).toEqual([]); // tautan sementara dibersihkan
  });
});

describe("kegagalan sebelum pengalihan: rilis aktif tidak tersentuh", () => {
  it.each([
    ["npm ci gagal", { failCi: true }],
    ["build gagal", { failBuild: true }],
    ["migrasi gagal", { failMigrate: true }],
  ] as [string, Opts][])("%s: kode 1, current tetap, PM2 tidak disentuh, rilis setengah jadi dibuang", (_n, o) => {
    const s = setup({ current: "v1.0.0", ...o });
    const r = run(s, ["v1.1.0"]);
    expect(r.code, r.all).toBe(1);
    expect(current(s)).toBe("v1.0.0");
    expect(pm2Calls(s)).toEqual([]);
    expect(releases(s)).toEqual(["v1.0.0"]);
    expect(readFileSync(join(s.root, "shared/deploy.log"), "utf8")).toMatch(/v1\.1\.0.*gagal/);
  });

  it("migrasi tidak dijalankan bila build gagal", () => {
    const s = setup({ current: "v1.0.0", failBuild: true });
    run(s, ["v1.1.0"]);
    expect(s.calls().some((c) => c.includes("db:migrate"))).toBe(false);
  });
});

describe("rollback otomatis", () => {
  it("health check gagal setelah pengalihan: kembali ke rilis sebelumnya, reload lagi, cek lagi, kode 1", () => {
    const s = setup({ current: "v1.0.0", badHealthTag: "v1.1.0" });
    const r = run(s, ["v1.1.0"]);
    expect(r.code, r.all).toBe(1);
    expect(current(s)).toBe("v1.0.0");
    expect(pm2Calls(s).filter((c) => c.includes("hayatun-api")).length).toBe(2); // reload rilis baru, lalu kembali
    expect(pm2Calls(s).filter((c) => c.includes("hayatun-web")).length).toBe(2);
    expect(r.all).toMatch(/rollback|kembali/i);
    expect(readFileSync(join(s.root, "shared/deploy.log"), "utf8")).toMatch(/v1\.1\.0.*rollback/);
  });

  it("rilis yang gagal disimpan (diberi akhiran .failed) untuk diperiksa, dan tag yang sama bisa dideploy lagi", () => {
    const s = setup({ current: "v1.0.0", badHealthTag: "v1.1.0" });
    run(s, ["v1.1.0"]);
    expect(releases(s)).toEqual(["v1.0.0", "v1.1.0.failed"]);
    const ok = setup({ current: "v1.0.0" });
    expect(run(ok, ["v1.1.0"]).code).toBe(0);
  });

  it("pm2 gagal me-reload web: diperlakukan sama, rollback", () => {
    const s = setup({ current: "v1.0.0", failPm2: true });
    const r = run(s, ["v1.1.0"]);
    expect(r.code).toBe(1);
    expect(current(s)).toBe("v1.0.0");
  });

  it("rollback sendiri juga tidak sehat: kode 4 dan pesan KRITIS", () => {
    const s = setup({ current: "v1.0.0", allBad: true });
    const r = run(s, ["v1.1.0"]);
    expect(r.code).toBe(4);
    expect(r.all).toMatch(/KRITIS/);
  });

  it("deploy pertama yang tidak sehat: tidak ada tujuan rollback, kode 1 dengan pesan jelas", () => {
    const s = setup({ badHealthTag: "v1.0.0" });
    const r = run(s, ["v1.0.0"]);
    expect(r.code).toBe(1);
    expect(r.all).toMatch(/tidak ada rilis sebelumnya/i);
  });

  it("health check mencoba ulang sebelum menyerah", () => {
    const s = setup({ current: "v1.0.0", badHealthTag: "v1.1.0" });
    run(s, ["v1.1.0"], { HEALTH_RETRIES: "4" });
    const apiChecks = s.calls().filter((c) => /^curl .*4000/.test(c)).length;
    expect(apiChecks).toBeGreaterThanOrEqual(4);
  });
});

describe("--dry-run", () => {
  const snapshot = (s: Setup) => JSON.stringify({ releases: releases(s), current: current(s), shared: readdirSync(join(s.root, "shared")).sort() });

  it("dengan tag: mencetak rencana berurutan, tidak mengubah apa pun, tidak memanggil npm, pm2, atau mengambil kode", () => {
    const s = setup({ current: "v1.0.0" });
    const before = snapshot(s);
    const r = run(s, ["--dry-run", "v1.1.0"]);
    expect(r.code, r.all).toBe(0);
    expect(snapshot(s)).toBe(before);
    const c = s.calls().join("\n");
    expect(c).not.toMatch(/^npm /m);
    expect(c).not.toMatch(/^pm2 /m);
    expect(c).not.toMatch(/fetch|worktree add|worktree remove/);
    const steps = r.out.split("\n").filter((l) => l.startsWith("[dry-run]"));
    expect(steps.length).toBeGreaterThanOrEqual(6);
    const joined = steps.join("\n");
    const order = [/ambil/i, /npm ci/i, /build/i, /migrasi/i, /alihkan/i, /api/i, /web/i, /kesehatan|health/i].map((re) => joined.search(re));
    expect(order.every((i) => i >= 0), joined).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("tanpa tag (seperti di kriteria T58): hanya memeriksa prasyarat dan lulus", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, ["--dry-run"]);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/prasyarat.*(ok|lulus)/i);
  });

  it.each([
    ["berkas .env tidak ada", { envMode: null }, /\.env/],
    ["berkas .env terbuka untuk grup atau lainnya (mode 644)", { envMode: 0o644 }, /\.env.*(terbuka|600)/],
    ["pm2 tidak terpasang", { hasPm2: false }, /pm2/],
  ] as [string, Opts, RegExp][])("prasyarat gagal (%s): kode 2 dengan alasan, tanpa perubahan", (_n, o, re) => {
    const s = setup({ current: "v1.0.0", ...o });
    const before = snapshot(s);
    const r = run(s, ["--dry-run", "v1.1.0"]);
    expect(r.code, r.all).toBe(2);
    expect(r.all).toMatch(re);
    expect(snapshot(s)).toBe(before);
  });

  it("ruang disk kurang: kode 2", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, ["--dry-run", "v1.1.0"], { HAYATUN_MIN_FREE_KB: "999999999999" });
    expect(r.code).toBe(2);
    expect(r.all).toMatch(/disk|ruang/i);
  });

  it("tag yang tidak ada di repo: kode 2", () => {
    const s = setup({ current: "v1.0.0", tagExists: false });
    expect(run(s, ["--dry-run", "v9.9.9"]).code).toBe(2);
  });
});

describe("penjagaan", () => {
  it.each([["../etc"], ["v1"], ["main"], ["v1.0.0;rm -rf /"], ["v1.0.0 "], ["V1.0.0"], ["v1.0.0/../../x"], ["-rf"]])("tag berbahaya %j ditolak sebelum menyentuh apa pun", (tag) => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, [tag]);
    expect(r.code, r.all).toBe(2);
    expect(s.calls().filter((c) => !c.startsWith("id "))).toEqual([]);
    expect(releases(s)).toEqual(["v1.0.0"]);
  });

  it("tanpa tag: pesan pemakaian, kode 2", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, []);
    expect(r.code).toBe(2);
    expect(r.all).toMatch(/Pemakaian/);
  });

  it("tag yang tidak ada di repo ditolak sebelum rilis dibuat", () => {
    const s = setup({ current: "v1.0.0", tagExists: false });
    const r = run(s, ["v9.9.9"]);
    expect(r.code).toBe(2);
    expect(releases(s)).toEqual(["v1.0.0"]);
    expect(pm2Calls(s)).toEqual([]);
  });

  it("menolak dijalankan sebagai root atau pengguna selain hayatun", () => {
    for (const user of ["root", "budi"]) {
      const s = setup({ current: "v1.0.0", user });
      const r = run(s, ["v1.1.0"]);
      expect(r.code, user).toBe(2);
      expect(r.all).toMatch(/hayatun/);
      expect(current(s)).toBe("v1.0.0");
    }
  });

  it("rilis dengan tag yang sama yang sudah ada ditolak (tidak menimpa)", () => {
    const s = setup({ current: "v1.1.0", previous: "v1.0.0" });
    const r = run(s, ["v1.1.0"]);
    expect(r.code).toBe(2);
    expect(r.all).toMatch(/sudah ada/i);
  });

  it("dua deploy bersamaan: yang kedua ditolak dengan kode 3 dan tidak mengubah apa pun", async () => {
    const s = setup({ current: "v1.0.0" });
    const holder = spawn("flock", [join(s.root, "shared/deploy.lock"), "sleep", "8"]);
    await new Promise((r) => setTimeout(r, 300));
    const r = run(s, ["v1.1.0"]);
    holder.kill();
    expect(r.code, r.all).toBe(3);
    expect(r.all).toMatch(/sedang berjalan|kunci/i);
    expect(current(s)).toBe("v1.0.0");
    expect(s.calls().some((c) => c.startsWith("npm"))).toBe(false);
  }, 20_000);
});

describe("rotasi rilis", () => {
  it("menyimpan 5 rilis terbaru, tidak pernah menghapus rilis aktif atau sebelumnya", () => {
    const s = setup({ releases: ["v0.1.0", "v0.2.0", "v0.3.0", "v0.4.0", "v0.5.0", "v0.6.0"], previous: "v0.7.0", current: "v0.8.0" });
    expect(run(s, ["v0.9.0"]).code).toBe(0);
    const left = releases(s);
    expect(left).toContain("v0.9.0");
    expect(left).toContain("v0.8.0");
    expect(left).toContain("v0.7.0");
    expect(left.length).toBe(5);
    expect(left).not.toContain("v0.1.0");
    expect(left).not.toContain("v0.2.0");
  });

  it("rotasi tidak berjalan bila deploy gagal (rilis lama tetap tersedia untuk rollback)", () => {
    const s = setup({ releases: ["v0.1.0", "v0.2.0", "v0.3.0", "v0.4.0", "v0.5.0"], previous: "v0.6.0", current: "v0.7.0", badHealthTag: "v0.8.0" });
    run(s, ["v0.8.0"]);
    expect(releases(s)).toContain("v0.1.0");
  });
});

describe("--rollback manual", () => {
  it("kembali ke rilis sebelumnya, reload API lalu web, cek kesehatan, dan tukar current dan previous", () => {
    const s = setup({ current: "v1.1.0", previous: "v1.0.0" });
    const r = run(s, ["--rollback"]);
    expect(r.code, r.all).toBe(0);
    expect(current(s)).toBe("v1.0.0");
    expect(readFileSync(join(s.root, "shared/previous"), "utf8").trim()).toBe("v1.1.0");
    const p = pm2Calls(s);
    expect(p.findIndex((c) => c.includes("hayatun-api"))).toBeLessThan(p.findIndex((c) => c.includes("hayatun-web")));
    expect(s.calls().some((c) => c.startsWith("curl"))).toBe(true);
    expect(readFileSync(join(s.root, "shared/deploy.log"), "utf8")).toMatch(/rollback manual/i);
  });

  it("tanpa rilis sebelumnya: kode 2 dan tidak mengubah apa pun", () => {
    const s = setup({ current: "v1.0.0" });
    const r = run(s, ["--rollback"]);
    expect(r.code).toBe(2);
    expect(current(s)).toBe("v1.0.0");
    expect(pm2Calls(s)).toEqual([]);
  });

  it("rilis sebelumnya sudah dihapus dari disk: kode 2", () => {
    const s = setup({ current: "v1.1.0" });
    writeFileSync(join(s.root, "shared/previous"), "v0.0.1\n");
    expect(run(s, ["--rollback"]).code).toBe(2);
  });
});

describe("ecosystem.config.cjs (PM2)", () => {
  const load = (env: string, root = mkdtempSync(join(tmpdir(), "eco-"))) => {
    mkdirSync(join(root, "shared"), { recursive: true });
    writeFileSync(join(root, "shared/.env"), env);
    const r = spawnSync("node", ["-e", `process.env.HAYATUN_ROOT=${JSON.stringify(root)}; console.log(JSON.stringify(require(${JSON.stringify(ECOSYSTEM)})))`], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return { cfg: JSON.parse(r.stdout) as { apps: Record<string, any>[] }, root }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it("dua proses, satu instance masing-masing, berjalan dari current dan mulai dengan npm run start", () => {
    const { cfg, root } = load("A=1\n");
    expect(cfg.apps.map((a) => a.name)).toEqual(["hayatun-api", "hayatun-web"]);
    for (const a of cfg.apps) {
      expect(a.instances).toBe(1);
      expect(a.exec_mode ?? "fork").toBe("fork");
      expect(a.script).toBe("npm");
      expect(a.args).toBe("run start");
      expect(a.autorestart).not.toBe(false);
      expect(a.max_memory_restart).toBeTruthy();
      expect(a.out_file).toContain(join(root, "shared/logs"));
      expect(a.error_file).toContain(join(root, "shared/logs"));
    }
    expect(cfg.apps[0].cwd).toBe(join(root, "current/apps/api"));
    expect(cfg.apps[1].cwd).toBe(join(root, "current/apps/web"));
  });

  it("membaca shared/.env: komentar, baris kosong, tanda kutip, dan nilai berisi '=' ditangani; NODE_ENV=production", () => {
    const { cfg } = load('# komentar\n\nAPI_PORT=4000\nSESSION_SECRET="abc=def ghi"\nEMAIL_FROM=\'toko@hayatun.my.id\'\n  SPASI = x  \nBAD LINE\n');
    const api = cfg.apps.find((a) => a.name === "hayatun-api")!;
    expect(api.env.API_PORT).toBe("4000");
    expect(api.env.SESSION_SECRET).toBe("abc=def ghi");
    expect(api.env.EMAIL_FROM).toBe("toko@hayatun.my.id");
    expect(api.env.SPASI).toBe("x");
    expect(api.env["BAD LINE"]).toBeUndefined();
    for (const a of cfg.apps) expect(a.env.NODE_ENV).toBe("production");
  });

  it(".env tidak ada: konfigurasi tetap dimuat tanpa galat (deploy yang memeriksanya)", () => {
    const root = mkdtempSync(join(tmpdir(), "eco-"));
    const r = spawnSync("node", ["-e", `process.env.HAYATUN_ROOT=${JSON.stringify(root)}; require(${JSON.stringify(ECOSYSTEM)})`], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("web dan API tidak berbagi rahasia yang tidak perlu: web hanya mendapat API_INTERNAL_URL dan port, bukan kunci enkripsi", () => {
    const { cfg } = load("API_INTERNAL_URL=http://127.0.0.1:4000\nWEB_PORT=3000\nDATA_ENCRYPTION_KEYS=k1:RAHASIA\nBLIND_INDEX_KEY=RAHASIA\nSESSION_SECRET=RAHASIA\nDATABASE_URL=postgres://x\n");
    const web = cfg.apps.find((a) => a.name === "hayatun-web")!;
    expect(web.env.API_INTERNAL_URL).toBe("http://127.0.0.1:4000");
    for (const k of ["DATA_ENCRYPTION_KEYS", "BLIND_INDEX_KEY", "SESSION_SECRET", "DATABASE_URL"]) expect(web.env[k], k).toBeUndefined();
    const api = cfg.apps.find((a) => a.name === "hayatun-api")!;
    expect(api.env.DATA_ENCRYPTION_KEYS).toBe("k1:RAHASIA");
  });
});
