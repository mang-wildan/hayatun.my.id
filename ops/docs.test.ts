import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// `ops/restore-test.sh --from-docs` memeriksa docs/operasi.md terhadap skrip sungguhan: setiap perintah ops/*.sh dan npm di panduan
// harus ada, bisa dijalankan, dan memakai opsi yang dikenal skripnya; bagian wajib harus ada dan berisi perintah. Ia TIDAK memulihkan apa pun
// (itu tugas uji pulih nyata di server); ia mencegah panduan menyimpang dari skrip tanpa ketahuan (N35).
const SCRIPT = join(__dirname, "restore-test.sh");
const REAL_DOC = join(__dirname, "../docs/operasi.md");

const SECTIONS = ["Memasang ulang dari nol", "Memulihkan", "Uji pulih", "Mengganti kunci enkripsi"];
const block = (...lines: string[]) => "```bash\n" + lines.join("\n") + "\n```\n";
const good = (over: Record<string, string> = {}) =>
  "# Panduan operasi\n\n" +
  SECTIONS.map((t) => `## ${t}\n\nTeks.\n\n${over[t] ?? block("sudo -u hayatun /srv/hayatun/repo/ops/alat.sh --satu --dua nilai")}`).join("\n");

function run(doc: string | null, opts: { scripts?: Record<string, string>; noexec?: string[]; env?: Record<string, string>; args?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "docs-"));
  const ops = join(dir, "ops"); mkdirSync(ops);
  for (const [name, body] of Object.entries(opts.scripts ?? { "alat.sh": '#!/bin/bash\n# opsi: --satu --dua\n[ "$1" = "--satu" ]\n' })) {
    writeFileSync(join(ops, name), body);
    chmodSync(join(ops, name), opts.noexec?.includes(name) ? 0o644 : 0o755);
  }
  const file = join(dir, "operasi.md");
  if (doc !== null) writeFileSync(file, doc);
  const r = spawnSync("/bin/bash", [SCRIPT, ...(opts.args ?? ["--from-docs"])], {
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", HAYATUN_DOCS_FILE: file, HAYATUN_OPS_DIR: ops, ...opts.env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("restore-test.sh --from-docs: panduan yang selaras dengan skrip", () => {
  it("panduan baik: keluar 0 dan tiap bagian wajib tercatat LULUS", () => {
    const r = run(good());
    expect(r.code, r.out + r.err).toBe(0);
    for (const t of SECTIONS) expect(r.out).toMatch(new RegExp(`^LULUS\\s+bagian\\s+"${t}"`, "m"));
    expect(r.out).toMatch(/Hasil: \d+ lulus, 0 gagal/);
  });
  it("tanpa --identity/--env-file: mode ini tidak meminta argumen pemulihan", () => {
    expect(run(good()).err).not.toMatch(/Pemakaian/);
  });
  it("bagian wajib hilang: keluar 1 dan menyebut nama bagiannya", () => {
    const doc = good().replace("## Uji pulih", "## Hal lain");
    const r = run(doc);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^GAGAL\s+bagian\s+"Uji pulih"/m);
  });
  it("judul ada tetapi tanpa blok perintah: gagal (judul kosong tidak dihitung)", () => {
    const r = run(good({ "Mengganti kunci enkripsi": "Hanya prosa, tanpa perintah.\n" }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^GAGAL\s+bagian\s+"Mengganti kunci enkripsi"/m);
  });
  it("berkas panduan tidak ada: keluar 2", () => {
    const r = run(null);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/operasi\.md/);
  });
});

describe("perintah di panduan harus nyata", () => {
  const withCmd = (...lines: string[]) => good({ Memulihkan: block(...lines) });
  it("skrip tidak ada: gagal dan menyebut skripnya", () => {
    const r = run(withCmd("ops/hantu.sh --satu"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^GAGAL\s+perintah\s+ops\/hantu\.sh.*tidak ada/m);
  });
  it("skrip ada tetapi tidak bisa dijalankan: gagal", () => {
    const scripts = { "alat.sh": "#!/bin/bash\n# --satu --dua\n", "kaku.sh": "#!/bin/bash\n" };
    expect(run(withCmd("ops/kaku.sh"), { scripts }).code).toBe(0);
    const r = run(withCmd("ops/kaku.sh"), { scripts, noexec: ["kaku.sh"] });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^GAGAL\s+perintah\s+ops\/kaku\.sh.*tidak bisa dijalankan/m);
  });
  it("opsi yang tidak dikenal skripnya: gagal dan menyebut opsinya", () => {
    const r = run(withCmd("ops/alat.sh --satu --tiga"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^GAGAL\s+perintah\s+ops\/alat\.sh.*--tiga/m);
  });
  it("opsi yang ada di skrip hanya sebagai potongan kata tidak dihitung (--sat bukan --satu)", () => {
    const r = run(withCmd("ops/alat.sh --sat"));
    expect(r.code).toBe(1);
  });
  it("perintah disambung dengan backslash diperiksa seluruhnya", () => {
    expect(run(withCmd("ops/alat.sh --satu \\", "  --dua nilai")).code).toBe(0);
    const r = run(withCmd("ops/alat.sh --satu \\", "  --empat nilai"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/--empat/);
  });
  it("awalan sudo -u hayatun dan jalur /srv/hayatun/{repo,current}/ dikenali", () => {
    expect(run(withCmd("sudo -u hayatun /srv/hayatun/current/ops/alat.sh --satu", "/srv/hayatun/repo/ops/alat.sh --dua")).code).toBe(0);
    expect(run(withCmd("sudo -u hayatun /srv/hayatun/current/ops/hantu.sh")).code).toBe(1);
  });
  it("baris yang bukan perintah ops (komentar, ls, psql) tidak diperiksa", () => {
    expect(run(withCmd("# komentar tentang ops/hantu.sh", "ls -la /srv/hayatun", "psql -c 'select 1'")).code).toBe(0);
  });
  it("blok non-bash (mis. isi .env) tidak diperiksa", () => {
    const doc = good() + "\n```\nops/hantu.sh --apa-saja\n```\n";
    expect(run(doc).code).toBe(0);
  });
  it("skrip npm: npm -w apps/api run <skrip> harus ada di package.json", () => {
    expect(run(withCmd("npm -w apps/api run hantu-skrip")).code).toBe(1);
    expect(run(withCmd("npm -w apps/api run db:migrate")).code).toBe(0);
  });
});

describe("panduan sungguhan (docs/operasi.md)", () => {
  const r = spawnSync("/bin/bash", [SCRIPT, "--from-docs"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  it("lulus terhadap skrip di repo ini", () => {
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it("mencakup pasang ulang, pulih, uji pulih, ganti kunci, dan menyebut rotate-keys serta kunci cadangan", () => {
    const doc = readFileSync(REAL_DOC, "utf8");
    for (const t of SECTIONS) expect(doc).toMatch(new RegExp(`^## ${t}`, "m"));
    expect(doc).toMatch(/npm -w apps\/api run rotate-keys/);
    expect(doc).toMatch(/30 hari/); // kunci lama tetap disimpan selama cadangan lama masih berlaku
  });
});
