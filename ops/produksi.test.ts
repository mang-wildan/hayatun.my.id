import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// T66: server produksi memakai folder /www/wwwroot/hayatun.my.id, port web 9000 dan API 9001. Pengembangan, tes, dan CI tetap 3000/4000.
// Tes ini menjaga supaya berkas yang dipakai di server tidak menyimpan nilai lama diam-diam.
const REPO = join(__dirname, "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const list = (dir: string, re: RegExp) => readdirSync(join(REPO, dir)).filter((f) => re.test(f)).map((f) => `${dir}/${f}`);

const OPS = [...list("ops", /\.(sh|cjs)$/), ...list("ops/nginx", /\.conf$/), "ops/logrotate/hayatun", "ops/postgres-init.sql"];
const DOCS_SERVER = ["operasi", "deploy", "nginx", "server-hardening", "pemantauan", "migrasi-os", "gateway"].map((n) => `docs/${n}.md`);
const ARTIFACTS = [...OPS, ...DOCS_SERVER, ".env.example"];
const PORT_OLD = /(?<![-\w])(3000|4000)(?![-\w])/; // UUID '...-4000-...' tidak ikut

describe("tidak ada nilai lama di berkas server", () => {
  it.each(ARTIFACTS)("%s tidak memakai /srv/hayatun", (f) => {
    expect(read(f)).not.toContain("/srv/hayatun");
  });
  it.each(ARTIFACTS)("%s tidak memakai port 3000/4000", (f) => {
    const hit = read(f).split("\n").filter((l) => PORT_OLD.test(l));
    expect(hit, hit.join("\n")).toEqual([]);
  });
  it("setiap bawaan HAYATUN_ROOT di skrip dan PM2 adalah /www/wwwroot/hayatun.my.id", () => {
    const files = OPS.filter((f) => /\.(sh|cjs)$/.test(f));
    const defaults = files.flatMap((f) => [...read(f).matchAll(/HAYATUN_ROOT(?::-|\s*\|\|\s*)["']?([^"'}\s)]+)/g)].map((m) => [f, m[1]]));
    expect(defaults.length).toBeGreaterThanOrEqual(5);
    for (const [f, v] of defaults) expect(v, f).toBe("/www/wwwroot/hayatun.my.id");
  });
  it("latihan pulih (restore-test.sh) memakai port API bawaan yang berbeda dari API produksi, supaya tidak bentrok dengan API yang hidup", () => {
    const port = /PORT="(\d+)"/.exec(read("ops/restore-test.sh"))?.[1];
    expect(port).toBe("9101");
    expect(port).not.toBe("9001");
  });
});

describe("web membaca WEB_PORT (apps/web start)", () => {
  const start = (JSON.parse(read("apps/web/package.json")) as { scripts: Record<string, string> }).scripts.start;
  function run(env: Record<string, string>) {
    const bin = mkdtempSync(join(tmpdir(), "next-"));
    writeFileSync(join(bin, "next"), '#!/bin/bash\necho "next $*"\n'); chmodSync(join(bin, "next"), 0o755);
    mkdirSync(bin, { recursive: true });
    return spawnSync("bash", ["-c", start], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, ...env } }).stdout.trim();
  }
  it("WEB_PORT=9000 → next start -H 127.0.0.1 -p 9000 (hanya loopback)", () => {
    expect(run({ WEB_PORT: "9000" })).toBe("next start -H 127.0.0.1 -p 9000");
  });
  it("tanpa WEB_PORT (pengembangan dan tes): tetap 3000", () => {
    expect(run({})).toBe("next start -H 127.0.0.1 -p 3000");
  });
});

describe("dokumen aaPanel dan domain", () => {
  const nginx = read("docs/nginx.md");
  it("memandu membuat situs di aaPanel dengan kedua domain dan direktori jalan situs 'public' yang kosong", () => {
    expect(nginx).toContain("www.hayatun.my.id");
    expect(nginx).toMatch(/Direktori jalan|running directory|Running directory/i);
    expect(nginx).toContain("/public");
    expect(nginx).toContain("/www/wwwroot/hayatun.my.id");
  });
  it("menyebut port 9000 dan 9001 dan pengalihan www ke hayatun.my.id", () => {
    expect(nginx + read("docs/deploy.md")).toMatch(/9000/);
    expect(nginx + read("docs/deploy.md")).toMatch(/9001/);
    expect(nginx).toMatch(/www.*(dialihkan|301).*hayatun\.my\.id|hayatun\.my\.id.*www.*(dialihkan|301)/s);
  });
});
