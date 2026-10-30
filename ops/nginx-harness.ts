import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Menjalankan nginx sungguhan dengan konfigurasi ops/nginx/*.conf di depan dua upstream tiruan (web dan API),
// memakai sertifikat swa-tanda-tangan dan port acak, sebagai proses biasa (tidak butuh root).
const CONF_DIR = join(__dirname, "nginx");
type ConfName = "http" | "server" | "redirect";
const FILES: Record<ConfName, string> = { http: "hayatun-http.conf", server: "hayatun-server.conf", redirect: "hayatun-redirect.conf" };

export function findNginx(): string | null {
  const candidates = [process.env.NGINX_BIN, "/usr/sbin/nginx", "/usr/local/sbin/nginx", "/usr/local/nginx/sbin/nginx", "/opt/nginx-root/usr/sbin/nginx"].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(c));
  if (found) return found;
  const which = spawnSync("sh", ["-c", "command -v nginx"], { encoding: "utf8" }).stdout.trim();
  return which || null;
}

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

export interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; bytes: number }
export interface Upstream { port: number; seen: Seen[]; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void }
async function upstream(name: string): Promise<{ up: Upstream; close: () => void }> {
  const up: Upstream = {
    port: await freePort(), seen: [],
    handler: (req, res) => { res.setHeader("content-type", "application/json"); res.setHeader("x-upstream", name); res.end(JSON.stringify({ upstream: name, url: req.url, headers: req.headers })); },
  };
  const server = http.createServer((req, res) => {
    let bytes = 0;
    req.on("data", (c: Buffer) => { bytes += c.length; });
    req.on("end", () => { up.seen.push({ method: req.method!, url: req.url!, headers: req.headers, bytes }); up.handler(req, res); });
  });
  await new Promise<void>((r) => server.listen(up.port, "127.0.0.1", r));
  return { up, close: () => server.close() };
}

export interface Edge {
  https: number; http: number; dir: string; filesDir: string; api: Upstream; web: Upstream;
  accessLog: () => string; errorLog: () => string; test: () => { ok: boolean; output: string }; stop: () => Promise<void>;
}

export async function startEdge(opts: { transform?: (file: ConfName, text: string) => string } = {}): Promise<Edge> {
  const nginx = findNginx();
  if (!nginx) throw new Error("nginx tidak ditemukan (pasang nginx atau isi NGINX_BIN)");
  const dir = mkdtempSync(join(tmpdir(), "edge-"));
  for (const d of ["tmp", "files/products"]) mkdirSync(join(dir, d), { recursive: true });
  // Sebagai root, pekerja nginx berjalan sebagai pengguna lain (NGINX_USER, bawaan root) dan perlu menulis di folder sementara
  for (const d of [dir, join(dir, "tmp"), join(dir, "files"), join(dir, "files/products")]) chmodSync(d, 0o777);
  const filesDir = join(dir, "files");
  writeFileSync(join(filesDir, "products", "abc.pdf"), "ISI-PDF-RAHASIA");
  const [web, api, httpPort, httpsPort] = [await upstream("web"), await upstream("api"), await freePort(), await freePort()];

  const tls = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" });
  if (tls.status !== 0) throw new Error(`openssl gagal: ${tls.stderr}`);

  // konfigurasi produksi memakai 127.0.0.1:3000, :4000, dan /srv/hayatun/files; di sini diarahkan ke tiruan
  for (const name of Object.keys(FILES) as ConfName[]) {
    let text = readFileSync(join(CONF_DIR, FILES[name]), "utf8");
    text = text.replaceAll("127.0.0.1:3000", `127.0.0.1:${web.up.port}`).replaceAll("127.0.0.1:4000", `127.0.0.1:${api.up.port}`).replaceAll("/srv/hayatun/files", filesDir);
    writeFileSync(join(dir, FILES[name]), opts.transform ? opts.transform(name, text) : text);
  }
  const main = `${process.getuid?.() === 0 ? `user ${process.env.NGINX_USER ?? "root"};\n` : ""}worker_processes 1;
daemon off;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log info;
events { worker_connections 256; }
http {
  client_body_temp_path ${dir}/tmp/body; proxy_temp_path ${dir}/tmp/proxy; fastcgi_temp_path ${dir}/tmp/fcgi; uwsgi_temp_path ${dir}/tmp/uwsgi; scgi_temp_path ${dir}/tmp/scgi;
  access_log off;
  include ${dir}/hayatun-http.conf;
  server { listen 127.0.0.1:${httpPort}; server_name _; include ${dir}/hayatun-redirect.conf; }
  server {
    listen 127.0.0.1:${httpsPort} ssl; server_name localhost;
    ssl_certificate ${dir}/c.pem; ssl_certificate_key ${dir}/k.pem;
    access_log ${dir}/access.log hayatun;
    include ${dir}/hayatun-server.conf;
  }
}
`;
  writeFileSync(join(dir, "nginx.conf"), main);
  const test = () => { const r = spawnSync(nginx, ["-t", "-c", join(dir, "nginx.conf"), "-p", dir], { encoding: "utf8" }); return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` }; };

  let child: ChildProcess | undefined;
  if (test().ok) {
    child = spawn(nginx, ["-c", join(dir, "nginx.conf"), "-p", dir], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) { // tunggu port HTTPS menerima sambungan
      if (await new Promise<boolean>((r) => { const s = net.connect(httpsPort, "127.0.0.1", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  return {
    https: httpsPort, http: httpPort, dir, filesDir, api: api.up, web: web.up, test,
    accessLog: () => read("access.log"), errorLog: () => read("error.log"),
    stop: async () => { child?.kill("SIGTERM"); web.close(); api.close(); },
  };
}

export interface Res { status: number; headers: http.IncomingHttpHeaders; body: Buffer; text: string }
// Permintaan HTTPS (sertifikat swa-tanda-tangan diterima). Kesalahan setelah jawaban diterima diabaikan: nginx menutup sambungan setelah 413.
export function request(edge: Pick<Edge, "https">, o: { method?: string; path: string; headers?: Record<string, string>; body?: Buffer | string; tls?: https.RequestOptions }): Promise<Res> {
  return new Promise((resolve, reject) => {
    let done = false;
    const req = https.request({ host: "127.0.0.1", port: edge.https, method: o.method ?? "GET", path: o.path, headers: { host: "localhost", ...o.headers }, rejectUnauthorized: false, agent: false, ...o.tls }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { done = true; const body = Buffer.concat(chunks); resolve({ status: res.statusCode!, headers: res.headers, body, text: body.toString("utf8") }); });
    });
    req.on("error", (e) => { if (!done) reject(e); });
    req.end(o.body);
  });
}

export function requestHttp(edge: Pick<Edge, "http">, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: edge.http, path, headers: { host: "toko.contoh.id" }, agent: false }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers })); }).on("error", reject);
  });
}
