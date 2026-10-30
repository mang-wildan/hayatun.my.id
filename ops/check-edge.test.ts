import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findNginx, startEdge, type Edge } from "./nginx-harness";

// ops/check-edge.sh <url> memeriksa situs yang sedang berjalan dari luar (T57). Diuji ke nginx lokal: yang sehat harus LULUS semua,
// yang sengaja dilemahkan harus GAGAL pada pemeriksaan yang tepat.
const nginx = findNginx();
if (!nginx && process.env.CI) throw new Error("nginx wajib ada di CI (pasang paket nginx)");
const suite = nginx ? describe : describe.skip;
const SCRIPT = join(__dirname, "check-edge.sh");
const IDS = ["tls-baru", "tls-lama", "http-alihkan", "hsts", "api-proxy", "file-internal", "batas-unggah", "batas-umum", "request-id", "header-keamanan", "server-tokens", "berkas-tersembunyi"];


// Asinkron: upstream tiruan berjalan di proses ini, jadi spawnSync akan memblokir mereka dan skrip menunggu selamanya.
function sh(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn("bash", [SCRIPT, ...args], { env: { PATH: process.env.PATH! } });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout += d; });
    c.stderr.on("data", (d) => { stderr += d; });
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const edges: Edge[] = [];
afterAll(async () => { for (const e of edges) await e.stop(); });

async function check(transform?: (f: "http" | "server" | "redirect", t: string) => string, args: string[] = []) {
  const edge = await startEdge({ transform });
  edges.push(edge);
  edge.api.handler = (req, res) => { res.statusCode = req.url === "/api/health" ? 200 : 401; res.setHeader("content-type", "application/json"); res.end(req.url === "/api/health" ? '{"status":"ok"}' : '{"message":"Kamu perlu masuk dulu ya."}'); };
  const r = await sh(["--insecure", `--http-port=${edge.http}`, ...args, `https://127.0.0.1:${edge.https}`]);
  const lines = r.stdout.split("\n");
  const status = (id: string) => lines.find((l) => new RegExp(`^(LULUS|GAGAL|PERIKSA)\\s+${id}\\b`).test(l))?.split(/\s+/)[0];
  return { r, out: r.stdout, code: r.status, status };
}

suite("check-edge.sh", () => {
  it("nginx dengan konfigurasi produksi: semua pemeriksaan LULUS dan keluar kode 0", async () => {
    const { out, code, status } = await check();
    for (const id of IDS) expect(["LULUS", "PERIKSA"], `${id}\n${out}`).toContain(status(id));
    expect(IDS.filter((id) => status(id) === "GAGAL")).toEqual([]);
    expect(out).toMatch(/Hasil: \d+ lulus, 0 gagal/);
    expect(code).toBe(0);
  }, 60_000);

  it("tidak mengubah apa pun di situs: hanya GET, HEAD, dan POST ke rute yang ditolak Nginx lebih dulu", async () => {
    const edge = await startEdge();
    edges.push(edge);
    edge.api.handler = (_q, res) => { res.statusCode = 401; res.end("{}"); };
    await sh(["--insecure", `--http-port=${edge.http}`, `https://127.0.0.1:${edge.https}`]);
    for (const s of edge.api.seen) {
      expect(["GET", "HEAD", "POST"]).toContain(s.method);
      if (s.method === "POST") expect(s.bytes, "POST yang sampai ke API harus kecil dan tanpa isi sensitif").toBeLessThan(6 * 1024 * 1024);
    }
  }, 60_000);

  const BAD: [string, string, (f: "http" | "server" | "redirect", t: string) => string][] = [
    ["HSTS dihapus", "hsts", (f, t) => (f === "server" || f === "http" ? t.replace(/.*Strict-Transport-Security.*\n/g, "") : t)],
    ["HSTS terlalu pendek", "hsts", (f, t) => t.replaceAll("max-age=31536000", "max-age=60")],
    ["pengalihan HTTP ke HTTPS dimatikan", "http-alihkan", (f, t) => (f === "redirect" ? "return 200 'terbuka';\n" : t)],
    ["batas unggah dilonggarkan jadi 100 MB", "batas-unggah", (_f, t) => t.replace(/client_max_body_size\s+\S+;/g, "client_max_body_size 100m;")],
    ["lokasi file bukan internal (bisa dibuka langsung)", "file-internal", (_f, t) => t.replace(/^\s*internal;\s*$/m, "")],
    ["X-Request-Id dihapus", "request-id", (_f, t) => t.replace(/.*X-Request-Id.*\n/gi, "")],
    ["versi Nginx dibuka (server_tokens on)", "server-tokens", (f, t) => t.replace(/server_tokens\s+off;/, "server_tokens on;")],
    ["proxy /api rusak", "api-proxy", (_f, t) => t.replace(/proxy_pass\s+http:\/\/hayatun_api[^;]*;/g, "return 502;")],
    ["header keamanan dihapus", "header-keamanan", (_f, t) => t.replace(/.*(X-Content-Type-Options|X-Frame-Options).*\n/g, "")],
  ];
  it.each(BAD)("kelemahan: %s", async (_name, id, transform) => {
    const { out, code, status } = await check(transform);
    expect(status(id), out).toBe("GAGAL");
    expect(code).toBe(1);
  }, 60_000);

  it("TLS 1.0 dan 1.1 diizinkan di server: tidak boleh LULUS (GAGAL bila klien bisa mencobanya, selain itu PERIKSA)", async () => {
    const { status, out } = await check((_f, t) => t.replace("ssl_protocols TLSv1.2 TLSv1.3;", "ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;").replace(/ssl_ciphers [^;]+;/, "ssl_ciphers ALL:@SECLEVEL=0;"));
    expect(["GAGAL", "PERIKSA"], out).toContain(status("tls-lama"));
  }, 60_000);

  it("situs tidak bisa dihubungi: semua GAGAL dengan alasan, bukan skrip rusak", async () => {
    const r = await sh(["--insecure", "https://127.0.0.1:1"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/GAGAL/);
    expect(r.stdout).toMatch(/Hasil: \d+ lulus, \d+ gagal/);
  }, 60_000);

  it("tanpa alamat: pesan pemakaian dan kode 2", async () => {
    const r = await sh([]);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/Pemakaian|https:\/\//);
  });
});
