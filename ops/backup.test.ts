import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCrypto } from "../apps/api/src/modules/crypto/index";

// T59 (N23, N29): ops/backup.sh, ops/restore.sh, ops/restore-test.sh dengan age, pg_dump, pg_restore, dan PostgreSQL sungguhan.
// rclone ditiru: "bucket" adalah folder. Dua database uji: sumber (hayatun_backup_test) dan tujuan pulih (hayatun_restore_test).
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const REPO = join(__dirname, "..");
const BACKUP = join(__dirname, "backup.sh");
const RESTORE = join(__dirname, "restore.sh");
const RESTORE_TEST = join(__dirname, "restore-test.sh");
const PGHOST = "127.0.0.1:5432";
const URL_OF = (role: string, db: string) => `postgres://${role}:hayatun@${PGHOST}/${db}`;
const SRC = URL_OF("hayatun_migrate", "hayatun_backup_test");
const DST = URL_OF("hayatun_migrate", "hayatun_restore_test");
const DST_APP = URL_OF("hayatun_app", "hayatun_restore_test");

const have = (c: string) => process.env.PATH!.split(":").concat("/usr/bin", "/usr/local/bin").some((d) => existsSync(join(d, c)));
const TOOLS = ["age", "age-keygen", "pg_dump", "pg_restore", "sha256sum", "tar", "flock"];
const missing = TOOLS.filter((t) => !have(t));
if (missing.length && process.env.CI) throw new Error(`alat tes cadangan wajib ada di CI: ${missing.join(", ")}`);
const suite = missing.length ? describe.skip : describe;

interface Run { code: number | null; out: string; err: string; all: string }
function sh(file: string, args: string[], env: Record<string, string> = {}, cwd = REPO): Promise<Run> {
  return new Promise((resolve) => {
    const c = spawn("bash", [file, ...args], { cwd, env: { ...process.env, ...env } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, out, err, all: out + err }));
  });
}

const key = (n: number) => Buffer.alloc(32, n);
const crypto = createCrypto({ keys: { k1: key(2) }, activeKeyId: "k1", blindIndexKey: key(3) });
const ACCESS = "AKIATESTKEYDONOTLEAK", SECRET = "SECRETTESTKEYDONOTLEAK";

let work: string, bin: string, bucket: string, log: string, identity: string, publicKey: string, wrongIdentity: string;
let root: string, filesDir: string, restoreFiles: string;

const pool = (url: string) => new pg.Pool({ connectionString: url });
async function resetDb(url: string) {
  const p = pool(url);
  const { rows } = await p.query<{ nspname: string }>("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'");
  for (const r of rows) await p.query(`drop schema if exists "${r.nspname}" cascade`);
  await p.query("create schema public");
  await p.end();
}
const tableCount = async (url: string) => { const p = pool(url); const r = await p.query("select count(*)::int as n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"); await p.end(); return r.rows[0].n as number; };

function treeHash(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex"); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

const bucketDir = () => join(bucket, "hayatun-bak", "hayatun");
const objects = () => (existsSync(bucketDir()) ? readdirSync(bucketDir()).sort() : []);
const blobs = () => objects().filter((n) => n.endsWith(".tar.age"));
const tmpLeft = () => (existsSync(join(root, "shared/tmp")) ? readdirSync(join(root, "shared/tmp")) : []);
const status = () => (existsSync(join(root, "shared/backup-status")) ? readFileSync(join(root, "shared/backup-status"), "utf8").trim() : "");

function writeEnvFile(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DATABASE_MIGRATION_URL: SRC, BACKUP_TARGET_ENDPOINT: "https://s3.contoh.test", BACKUP_TARGET_BUCKET: "hayatun-bak",
    BACKUP_TARGET_ACCESS_KEY_ID: ACCESS, BACKUP_TARGET_SECRET_ACCESS_KEY: SECRET, BACKUP_ENCRYPTION_PUBLIC_KEY: publicKey,
  };
  const merged = { ...base, ...over };
  writeFileSync(join(root, "shared/.env"), Object.entries(merged).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
}
const envFor = (over: Record<string, string> = {}) => ({ HAYATUN_ROOT: root, PATH: `${bin}:${process.env.PATH}`, FAKE_BUCKET: bucket, FAKE_LOG: log, ...over });
const backup = (over: Record<string, string> = {}) => sh(BACKUP, [], envFor(over));
const restore = (args: string[], over: Record<string, string> = {}) => sh(RESTORE, args, envFor(over));

beforeAll(async () => {
  if (missing.length) return;
  work = mkdtempSync(join(tmpdir(), "backup-"));
  bin = join(work, "bin"); mkdirSync(bin);
  const fake = `#!/bin/bash
echo "rclone $*" >> "$FAKE_LOG"
[ -n "\${FAKE_FAIL:-}" ] && [ "$FAKE_FAIL" = "$1" ] && { echo "rclone: simulasi gagal $1" >&2; exit 1; }
map() { case "$1" in hayatunbackup:*) echo "$FAKE_BUCKET/\${1#hayatunbackup:}";; *) echo "$1";; esac; }
case "$1" in
  copyto) src=$(map "$2"); dst=$(map "$3"); mkdir -p "$(dirname "$dst")"; cp "$src" "$dst" || exit 1
          if [ -n "\${FAKE_TRUNCATE:-}" ] && [[ "$3" == hayatunbackup:*.tar.age ]]; then truncate -s -10 "$dst"; fi ;;
  lsjson) f=$(map "$2"); [ -f "$f" ] || { echo "directory not found" >&2; exit 3; }
          printf '[{"Path":"%s","Name":"%s","Size":%s,"IsDir":false}]\\n' "$(basename "$f")" "$(basename "$f")" "$(stat -c %s "$f")" ;;
  lsf) d=$(map "$2"); ls -1 "$d" 2>/dev/null ;;
  delete) d=$(map "$2"); shift 2; days=""; while [ $# -gt 0 ]; do [ "$1" = "--min-age" ] && days="\${2%d}"; shift; done
          find "$d" -type f -mtime +"$days" -delete ;;
  *) echo "rclone palsu: perintah $1 tidak didukung" >&2; exit 2 ;;
esac
`;
  writeFileSync(join(bin, "rclone"), fake); chmodSync(join(bin, "rclone"), 0o755);

  // kunci age: yang benar, dan satu yang salah
  const gen = (name: string) => new Promise<{ file: string; pub: string }>((resolve) => {
    const file = join(work, name); const c = spawn("age-keygen", ["-o", file]); let e = "";
    c.stderr.on("data", (d) => (e += d)); c.on("close", () => resolve({ file, pub: /Public key: (age1\S+)/.exec(e)![1] }));
  });
  const [good, bad] = [await gen("kunci.txt"), await gen("salah.txt")];
  identity = good.file; publicKey = good.pub; wrongIdentity = bad.file;

  // database sumber: skema asli lewat migrasi, lalu beberapa baris
  await resetDb(SRC);
  const mig = await new Promise<number | null>((resolve) => { const c = spawn("npm", ["-w", "apps/api", "run", "db:migrate"], { cwd: REPO, env: { ...process.env, DATABASE_MIGRATION_URL: SRC } }); c.on("close", resolve); });
  if (mig !== 0) throw new Error("migrasi database sumber gagal");
  const p = pool(SRC);
  await p.query("insert into users (role, status, email_enc, email_index, name_enc, email_verified_at) values ('buyer','active',$1,$2,$3, now())", [crypto.encrypt("siti@hayatun.test"), crypto.blindIndex("siti@hayatun.test"), crypto.encrypt("Siti Aminah")]);
  await p.query("insert into audit_logs (action, entity_type, entity_id) values ('payment.accepted','order','pesanan-uji-1'), ('user.viewed','user','pengguna-uji-1')");
  await p.query("insert into store_settings (key, value) values ('store', $1)", [JSON.stringify({ name: "Toko Rahasia Uji" })]);
  await p.end();
});

beforeEach(async () => {
  if (missing.length) return;
  root = mkdtempSync(join(work, "root-"));
  for (const d of ["shared", "files/products", "files/proofs/2026"]) mkdirSync(join(root, d), { recursive: true });
  filesDir = join(root, "files");
  writeFileSync(join(filesDir, "products/ebook.pdf"), `%PDF RAHASIA-ISI-PRODUK-123 ${randomBytes(2000).toString("hex")}`);
  writeFileSync(join(filesDir, "proofs/2026/bukti.bin"), randomBytes(5000));
  bucket = join(work, `bucket-${Math.random().toString(36).slice(2, 8)}`); mkdirSync(bucket);
  log = join(work, `rclone-${Math.random().toString(36).slice(2, 8)}.log`); writeFileSync(log, "");
  restoreFiles = join(work, `pulih-${Math.random().toString(36).slice(2, 8)}`);
  writeEnvFile();
});
afterAll(async () => { /* folder kerja ada di tmp */ });

suite("ops/backup.sh", () => {
  it("cadangan sukses: satu arsip terenkripsi dan sidecar sha256 di penyimpanan, status ok, tidak ada sisa sementara", async () => {
    const r = await backup();
    expect(r.code, r.all).toBe(0);
    expect(objects()).toHaveLength(2);
    expect(blobs()[0]).toMatch(/^hayatun-\d{8}T\d{6}Z\.tar\.age$/);
    const sidecar = readFileSync(join(bucketDir(), `${blobs()[0]}.sha256`), "utf8");
    expect(sidecar.split(/\s+/)[0]).toBe(createHash("sha256").update(readFileSync(join(bucketDir(), blobs()[0]))).digest("hex"));
    expect(status()).toMatch(/^ok /);
    expect(tmpLeft()).toEqual([]);
  });

  it("isi arsip tidak terbaca tanpa kunci privat: header age, tanpa teks mentah, tanpa kepala dump", async () => {
    await backup();
    const blob = readFileSync(join(bucketDir(), blobs()[0]));
    expect(blob.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    for (const secret of ["RAHASIA-ISI-PRODUK-123", "Toko Rahasia Uji", "payment.accepted", "PGDMP", "siti@hayatun.test"]) expect(blob.includes(Buffer.from(secret)), secret).toBe(false);
  });

  it("dengan kunci privat yang benar isinya db.dump, files.tar, dan MANIFEST; kunci lain gagal", async () => {
    await backup();
    const blob = join(bucketDir(), blobs()[0]);
    const unpack = join(work, "unpack-" + Math.random().toString(36).slice(2, 6)); mkdirSync(unpack);
    const ok = await sh("-c", ["age -d -i " + identity + " " + blob + " | tar -x -C " + unpack]);
    expect(ok.code, ok.all).toBe(0);
    expect(readdirSync(unpack).sort()).toEqual(["MANIFEST", "db.dump", "files.tar"]);
    expect(readFileSync(join(unpack, "db.dump")).subarray(0, 5).toString()).toBe("PGDMP");
    const bad = await sh("-c", ["age -d -i " + wrongIdentity + " " + blob + " | tar -x -C " + unpack + "-bad"]);
    expect(bad.code).not.toBe(0);
  });

  it("kredensial penyimpanan hanya lewat lingkungan, tidak pernah di argumen rclone, keluaran, atau berkas status", async () => {
    const r = await backup();
    const calls = readFileSync(log, "utf8");
    for (const secret of [ACCESS, SECRET]) {
      expect(calls, secret).not.toContain(secret);
      expect(r.all, secret).not.toContain(secret);
      expect(status(), secret).not.toContain(secret);
    }
    expect(calls).toMatch(/rclone copyto .*hayatunbackup:hayatun-bak\/hayatun\//);
  });

  it("retensi 30 hari: arsip 31 hari (dan sidecar-nya) dihapus, 29 hari tetap, yang baru ada", async () => {
    mkdirSync(bucketDir(), { recursive: true });
    const old = (name: string, days: number) => { const f = join(bucketDir(), name); writeFileSync(f, "x"); const t = new Date(Date.now() - days * 86400_000); utimesSync(f, t, t); };
    old("hayatun-20250101T020000Z.tar.age", 31); old("hayatun-20250101T020000Z.tar.age.sha256", 31);
    old("hayatun-20250102T020000Z.tar.age", 29); old("hayatun-20250102T020000Z.tar.age.sha256", 29);
    const r = await backup();
    expect(r.code, r.all).toBe(0);
    const names = objects();
    expect(names).not.toContain("hayatun-20250101T020000Z.tar.age");
    expect(names).not.toContain("hayatun-20250101T020000Z.tar.age.sha256");
    expect(names).toContain("hayatun-20250102T020000Z.tar.age");
    expect(blobs()).toHaveLength(2);
  });

  it("unggahan gagal: kode 1, status gagal, tidak ada yang dihapus, tidak ada sisa sementara", async () => {
    mkdirSync(bucketDir(), { recursive: true });
    const f = join(bucketDir(), "hayatun-20240101T020000Z.tar.age"); writeFileSync(f, "lama"); const t = new Date(Date.now() - 90 * 86400_000); utimesSync(f, t, t);
    const r = await backup({ FAKE_FAIL: "copyto" });
    expect(r.code, r.all).toBe(1);
    expect(status()).toMatch(/^gagal /);
    expect(objects()).toEqual(["hayatun-20240101T020000Z.tar.age"]); // cadangan lama tidak dipangkas tanpa pengganti
    expect(tmpLeft()).toEqual([]);
  });

  it("ukuran di penyimpanan tidak cocok setelah unggah: dianggap gagal dan tidak memangkas", async () => {
    mkdirSync(bucketDir(), { recursive: true });
    const f = join(bucketDir(), "hayatun-20240101T020000Z.tar.age"); writeFileSync(f, "lama"); const t = new Date(Date.now() - 90 * 86400_000); utimesSync(f, t, t);
    const r = await backup({ FAKE_TRUNCATE: "1" });
    expect(r.code, r.all).toBe(1);
    expect(status()).toMatch(/^gagal /);
    expect(objects()).toContain("hayatun-20240101T020000Z.tar.age");
    expect(tmpLeft()).toEqual([]);
  });

  it("pg_dump gagal (database tidak ada): kode 1, tidak ada yang diunggah, tidak ada sisa", async () => {
    writeEnvFile({ DATABASE_MIGRATION_URL: URL_OF("hayatun_migrate", "tidak_ada_db") });
    const r = await backup();
    expect(r.code, r.all).toBe(1);
    expect(objects()).toEqual([]);
    expect(status()).toMatch(/^gagal .*pg_dump/);
    expect(tmpLeft()).toEqual([]);
  });

  it("pg_dump yang menghasilkan berkas kosong tidak diterima sebagai cadangan", async () => {
    writeFileSync(join(bin, "pg_dump"), "#!/bin/bash\nexit 0\n"); chmodSync(join(bin, "pg_dump"), 0o755);
    try {
      const r = await backup();
      expect(r.code, r.all).toBe(1);
      expect(objects()).toEqual([]);
      expect(tmpLeft()).toEqual([]);
    } finally { writeFileSync(join(bin, "pg_dump"), "", { mode: 0 }); await sh("-c", [`rm -f ${join(bin, "pg_dump")}`]); }
  });

  it.each([
    ["kunci publik kosong", { BACKUP_ENCRYPTION_PUBLIC_KEY: "" }],
    ["kunci publik bukan kunci age", { BACKUP_ENCRYPTION_PUBLIC_KEY: "bukan-kunci" }],
    ["kunci privat (AGE-SECRET-KEY) tertukar dengan kunci publik", { BACKUP_ENCRYPTION_PUBLIC_KEY: "AGE-SECRET-KEY-1ABCDEF" }],
    ["tujuan penyimpanan kosong", { BACKUP_TARGET_BUCKET: "" }],
    ["kredensial penyimpanan kosong", { BACKUP_TARGET_SECRET_ACCESS_KEY: "" }],
  ] as [string, Record<string, string>][])("konfigurasi tidak lengkap (%s): kode 2, tidak menyimpan apa pun, tidak pernah mengunggah tanpa enkripsi", async (_n, over) => {
    writeEnvFile(over);
    const r = await backup();
    expect(r.code, r.all).toBe(2);
    expect(objects()).toEqual([]);
    expect(readFileSync(log, "utf8")).not.toMatch(/copyto/);
    expect(tmpLeft()).toEqual([]);
  });

  it("dua cadangan bersamaan: yang kedua ditolak dengan kode 3", async () => {
    const holder = spawn("flock", [join(root, "shared/backup.lock"), "sleep", "10"]);
    await new Promise((r) => setTimeout(r, 300));
    const r = await backup();
    holder.kill();
    expect(r.code, r.all).toBe(3);
    expect(objects()).toEqual([]);
  });

  it(".env yang terlalu terbuka (mode 644) ditolak", async () => {
    chmodSync(join(root, "shared/.env"), 0o644);
    const r = await backup();
    expect(r.code, r.all).toBe(2);
    expect(objects()).toEqual([]);
  });
});

suite("ops/restore.sh", () => {
  beforeEach(async () => { await resetDb(DST); });

  it("putaran penuh: data, enkripsi per kolom, hak audit_logs, dan setiap file pulih persis", async () => {
    const b = await backup(); expect(b.code, b.all).toBe(0);
    const r = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r.code, r.all).toBe(0);

    const p = pool(DST);
    expect((await p.query("select count(*)::int as n from users")).rows[0].n).toBe(1);
    const u = (await p.query("select email_enc, name_enc from users")).rows[0];
    expect(crypto.decrypt(u.email_enc)).toBe("siti@hayatun.test"); // kunci aplikasi yang sama membuka data pulih
    expect(crypto.decrypt(u.name_enc)).toBe("Siti Aminah");
    expect((await p.query("select count(*)::int as n from audit_logs")).rows[0].n).toBe(2);
    expect((await p.query("select value from store_settings where key='store'")).rows[0].value.name).toBe("Toko Rahasia Uji");
    await p.end();

    // F15.4: hak yang mencabut UPDATE, DELETE, dan TRUNCATE pada audit_logs untuk role aplikasi ikut pulih
    const app = pool(DST_APP);
    for (const q of ["update audit_logs set action = 'ubah'", "delete from audit_logs", "truncate audit_logs"]) await expect(app.query(q)).rejects.toMatchObject({ code: "42501" });
    expect((await app.query("select count(*)::int as n from audit_logs")).rows[0].n).toBe(2);
    await app.end();

    expect(treeHash(restoreFiles)).toEqual(treeHash(filesDir));
    expect(Object.keys(treeHash(restoreFiles)).sort()).toEqual(["products/ebook.pdf", "proofs/2026/bukti.bin"]);
  });

  it("latest memilih arsip terbaru menurut namanya; nama tertentu juga bisa dipilih", async () => {
    await backup();
    const first = blobs()[0];
    // arsip kedua dengan stempel waktu lebih baru berisi data yang berbeda
    const p = pool(SRC); await p.query("insert into audit_logs (action, entity_type, entity_id) values ('order.shipped','order','pesanan-uji-2')"); await p.end();
    await new Promise((r) => setTimeout(r, 1100));
    await backup();
    expect(blobs()).toHaveLength(2);
    const r1 = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r1.code, r1.all).toBe(0);
    const d = pool(DST); expect((await d.query("select count(*)::int as n from audit_logs")).rows[0].n).toBe(3); await d.end();

    await resetDb(DST);
    const r2 = await restore(["--identity", identity, "--database", DST, "--files-dir", join(work, "pulih-lama"), "--name", first]);
    expect(r2.code, r2.all).toBe(0);
    const d2 = pool(DST); expect((await d2.query("select count(*)::int as n from audit_logs")).rows[0].n).toBe(2); await d2.end();
    // bersihkan baris tambahan supaya tes lain tetap deterministik
    const s = pool(SRC); await s.query("delete from audit_logs where entity_id = 'pesanan-uji-2'").catch(() => {}); await s.end();
  });

  it("menolak database tujuan yang tidak kosong dan folder file yang tidak kosong, tanpa mengubah apa pun", async () => {
    await backup();
    const d = pool(DST); await d.query("create table sisa (x int)"); await d.end();
    const r1 = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r1.code, r1.all).toBe(2);
    expect(r1.all).toMatch(/tidak kosong/i);
    expect(existsSync(restoreFiles)).toBe(false);

    await resetDb(DST);
    mkdirSync(restoreFiles, { recursive: true }); writeFileSync(join(restoreFiles, "milik-orang.txt"), "jangan ditimpa");
    const r2 = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r2.code, r2.all).toBe(2);
    expect(await tableCount(DST)).toBe(0);
    expect(readFileSync(join(restoreFiles, "milik-orang.txt"), "utf8")).toBe("jangan ditimpa");
  });

  it("kunci privat yang salah: kode 1, database dan folder file tetap kosong", async () => {
    await backup();
    const r = await restore(["--identity", wrongIdentity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r.code, r.all).toBe(1);
    expect(await tableCount(DST)).toBe(0);
    expect(existsSync(restoreFiles) ? readdirSync(restoreFiles) : []).toEqual([]);
  });

  it("arsip rusak di penyimpanan (satu byte berubah): sha256 tidak cocok, ditolak sebelum dekripsi dan pemulihan", async () => {
    await backup();
    const f = join(bucketDir(), blobs()[0]); const buf = readFileSync(f); buf[buf.length - 20] ^= 0xff; writeFileSync(f, buf);
    const r = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r.code, r.all).toBe(1);
    expect(r.all).toMatch(/sha256|checksum|rusak/i);
    expect(await tableCount(DST)).toBe(0);
  });

  it("arsip yang diubah lalu dienkripsi ulang dengan sidecar sha256 yang diperbarui tetap ditolak oleh MANIFEST", async () => {
    await backup();
    const blob = join(bucketDir(), blobs()[0]);
    const dir = join(work, "ubah-" + Math.random().toString(36).slice(2, 6)); mkdirSync(dir);
    const cmd = `age -d -i ${identity} ${blob} | tar -x -C ${dir} && echo curang >> ${dir}/files.tar && tar -C ${dir} -c db.dump files.tar MANIFEST | age -r ${publicKey} -o ${blob} && (cd ${bucketDir()} && sha256sum ${blobs()[0]} > ${blobs()[0]}.sha256)`;
    expect((await sh("-c", [cmd])).code).toBe(0);
    const r = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r.code, r.all).toBe(1);
    expect(r.all).toMatch(/MANIFEST/);
    expect(await tableCount(DST)).toBe(0);
    expect(existsSync(restoreFiles) ? readdirSync(restoreFiles) : []).toEqual([]);
  });

  it("nama arsip yang tidak ada atau berbahaya: kode 2", async () => {
    await backup();
    for (const name of ["hayatun-19990101T000000Z.tar.age", "../../etc/passwd", "bukan-arsip.txt"]) {
      const r = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles, "--name", name]);
      expect(r.code, name).toBe(2);
    }
  });

  it("penyimpanan kosong (belum ada cadangan): kode 2 dengan pesan jelas", async () => {
    const r = await restore(["--identity", identity, "--database", DST, "--files-dir", restoreFiles]);
    expect(r.code, r.all).toBe(2);
    expect(r.all).toMatch(/belum ada cadangan|tidak ada cadangan/i);
  });

  it("berkas kunci privat tidak ada: kode 2", async () => {
    await backup();
    expect((await restore(["--identity", join(work, "tidak-ada.txt"), "--database", DST, "--files-dir", restoreFiles])).code).toBe(2);
  });
});

suite("ops/restore-test.sh (pulih ke server kosong lalu /api/health, N23: RTO <= 8 jam)", () => {
  const PORT = "4199";
  function appEnv(over: Record<string, string> = {}) {
    const k = (n: number) => Buffer.alloc(32, n).toString("base64");
    const env: Record<string, string> = {
      NODE_ENV: "test", APP_URL: "http://127.0.0.1:3000", APP_TIMEZONE: "Asia/Jakarta", LOG_LEVEL: "warn", LOG_DIR: "/tmp", WEB_PORT: "3000", API_PORT: PORT, API_INTERNAL_URL: `http://127.0.0.1:${PORT}`,
      DATABASE_URL: DST_APP, DATABASE_MIGRATION_URL: DST, SESSION_SECRET: k(1), DATA_ENCRYPTION_KEYS: `k1:${k(2)}`, DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1", BLIND_INDEX_KEY: k(3), TOTP_ISSUER: "Hayatun",
      SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", SMTP_USER: "", SMTP_PASSWORD: "", EMAIL_FROM: "toko@hayatun.my.id", STORAGE_DIR: restoreFiles, SHIPPING_PROVIDER: "fake", SHIPPING_ORIGIN_AREA_ID: "area-asal", ...over,
    };
    const f = join(work, `app-${Math.random().toString(36).slice(2, 6)}.env`);
    writeFileSync(f, Object.entries(env).map(([a, b]) => `${a}=${b}`).join("\n") + "\n", { mode: 0o600 });
    return f;
  }
  const listening = async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok, () => false));
  beforeEach(async () => { await resetDb(DST); });

  it("pulih lalu API sehat terhadap data hasil pulih; melaporkan lama pemulihan; API dihentikan sesudahnya", async () => {
    expect((await backup()).code).toBe(0);
    const r = await sh(RESTORE_TEST, ["--identity", identity, "--env-file", appEnv(), "--files-dir", restoreFiles, "--api-port", PORT], envFor());
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/\/api\/health.*(OK|sehat)/i);
    expect(r.out).toMatch(/RTO.*LULUS/i);
    expect(r.out).toMatch(/\d{2}:\d{2}:\d{2}/); // lama pemulihan
    expect(await listening()).toBe(false);
    expect(treeHash(restoreFiles)).toEqual(treeHash(filesDir));
  });

  it("melebihi batas RTO: GAGAL walau API sehat (batas dikecilkan lewat RTO_SECONDS)", async () => {
    await backup();
    const r = await sh(RESTORE_TEST, ["--identity", identity, "--env-file", appEnv(), "--files-dir", restoreFiles, "--api-port", PORT], envFor({ RTO_SECONDS: "0" }));
    expect(r.code, r.all).toBe(1);
    expect(r.all).toMatch(/RTO.*(GAGAL|melebihi)/i);
    expect(await listening()).toBe(false);
  });

  it("API tidak sehat (kunci enkripsi salah tidak mengubah health, tetapi database tujuan yang salah ya): GAGAL dan API dihentikan", async () => {
    await backup();
    const r = await sh(RESTORE_TEST, ["--identity", identity, "--env-file", appEnv({ DATABASE_URL: URL_OF("hayatun_app", "tidak_ada_db") }), "--files-dir", restoreFiles, "--api-port", PORT], envFor({ HEALTH_TIMEOUT_SECONDS: "8" }));
    expect(r.code, r.all).toBe(1);
    expect(r.all).toMatch(/health.*(gagal|tidak)/i);
    expect(await listening()).toBe(false);
  });

  it("tanpa cadangan: gagal dengan pesan jelas, tidak menjalankan API", async () => {
    const r = await sh(RESTORE_TEST, ["--identity", identity, "--env-file", appEnv(), "--files-dir", restoreFiles, "--api-port", PORT], envFor());
    expect(r.code, r.all).not.toBe(0);
    expect(await listening()).toBe(false);
  });
});

