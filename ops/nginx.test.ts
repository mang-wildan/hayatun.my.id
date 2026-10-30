import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findNginx, request, requestHttp, startEdge, type Edge } from "./nginx-harness";

// Menjalankan nginx sungguhan dengan ops/nginx/*.conf (T57; N1, N5, N30). Di CI nginx wajib ada; di mesin lain tes dilewati dengan pesan.
const nginx = findNginx();
if (!nginx && process.env.CI) throw new Error("nginx wajib ada di CI (pasang paket nginx)");
const suite = nginx ? describe : describe.skip;

const UUID = "00000000-0000-4000-8000-000000000001";
const MB = 1024 * 1024;
const apiPath = (r: { seen: { url: string }[] }) => r.seen.map((s) => s.url);

suite("nginx dengan konfigurasi produksi", () => {
  let edge: Edge;
  beforeAll(async () => { edge = await startEdge(); });
  afterAll(async () => { await edge?.stop(); });

  it("konfigurasi lolos nginx -t", () => {
    const t = edge.test();
    expect(t.output).toMatch(/syntax is ok/);
    expect(t.ok).toBe(true);
  });

  describe("TLS dan pengalihan (N1)", () => {
    it("TLS 1.2 dan 1.3 diterima", async () => {
      for (const v of ["TLSv1.2", "TLSv1.3"]) {
        const r = await request(edge, { path: "/", tls: { minVersion: v as "TLSv1.2", maxVersion: v as "TLSv1.2" } });
        expect(r.status, v).toBe(200);
      }
    });

    it("HTTP dialihkan 301 ke HTTPS dengan path dan query yang sama", async () => {
      const r = await requestHttp(edge, "/produk/e-book?jenis=digital");
      expect(r.status).toBe(301);
      expect(r.headers.location).toBe("https://toko.contoh.id/produk/e-book?jenis=digital");
    });

    it("HSTS setahun dengan includeSubDomains di semua jawaban: halaman, API, 404, dan file internal yang ditolak", async () => {
      for (const path of ["/", "/api/health", "/tidak-ada.txt", "/_internal/files/products/abc.pdf"]) {
        const h = (await request(edge, { path })).headers["strict-transport-security"] as string;
        expect(h, path).toMatch(/max-age=31536000/);
        expect(h, path).toMatch(/includeSubDomains/i);
      }
    });

    it("versi nginx tidak bocor di header Server", async () => {
      const server = (await request(edge, { path: "/" })).headers.server as string | undefined;
      expect(server ?? "").not.toMatch(/\d/);
    });
  });

  describe("rute dan header teruskan", () => {
    it("/api/ ke Express, selebihnya ke Next.js, tanpa saling bocor", async () => {
      edge.api.seen.length = 0; edge.web.seen.length = 0;
      expect((await request(edge, { path: "/api/health" })).headers["x-upstream"]).toBe("api");
      expect((await request(edge, { path: "/produk/e-book" })).headers["x-upstream"]).toBe("web");
      expect((await request(edge, { path: "/_next/static/a.js" })).headers["x-upstream"]).toBe("web");
      expect(apiPath(edge.api)).toEqual(["/api/health"]);
      expect(apiPath(edge.web)).toEqual(["/produk/e-book", "/_next/static/a.js"]);
    });

    it("Express menerima Host, skema, dan X-Request-Id buatan Nginx yang sama dengan yang dikirim ke klien", async () => {
      edge.api.seen.length = 0;
      const r = await request(edge, { path: "/api/catalog" });
      const seen = edge.api.seen[0].headers;
      expect(seen["x-forwarded-proto"]).toBe("https");
      expect(seen.host).toBe("localhost");
      expect(seen["x-real-ip"]).toBe("127.0.0.1");
      expect(seen["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);
      expect(r.headers["x-request-id"]).toBe(seen["x-request-id"]);
    });

    it("X-Request-Id kiriman klien diganti (tidak dipercaya), dan tiap permintaan punya id berbeda", async () => {
      edge.api.seen.length = 0;
      const a = await request(edge, { path: "/api/catalog", headers: { "x-request-id": "palsu-123" } });
      const b = await request(edge, { path: "/api/catalog" });
      expect(a.headers["x-request-id"]).not.toBe("palsu-123");
      expect(edge.api.seen[0].headers["x-request-id"]).not.toBe("palsu-123");
      expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
    });

    it("X-Forwarded-For kiriman klien tidak menggantikan alamat asli", async () => {
      edge.api.seen.length = 0;
      await request(edge, { path: "/api/catalog", headers: { "x-forwarded-for": "6.6.6.6" } });
      expect(edge.api.seen[0].headers["x-real-ip"]).toBe("127.0.0.1");
      expect(edge.api.seen[0].headers["x-forwarded-for"]).toMatch(/127\.0\.0\.1$/); // alamat asli ditambahkan di belakang
    });

    it("header keamanan ada di halaman dan di 404", async () => {
      for (const path of ["/", "/api/health", "/tidak-ada.txt"]) {
        const h = (await request(edge, { path })).headers;
        expect(h["x-content-type-options"], path).toBe("nosniff");
        expect(h["referrer-policy"], path).toBeTruthy();
        expect(String(h["x-frame-options"]).toUpperCase(), path).toMatch(/DENY|SAMEORIGIN/);
      }
    });

    it("berkas tersembunyi (.env, .git) ditolak, tetapi .well-known untuk sertifikat tetap diteruskan", async () => {
      edge.web.seen.length = 0;
      for (const path of ["/.env", "/.git/config", "/api/.env"]) expect((await request(edge, { path })).status, path).toBe(404);
      expect(edge.web.seen).toEqual([]); // tidak sampai ke upstream
      expect((await request(edge, { path: "/.well-known/acme-challenge/abc" })).status).not.toBe(403);
    });
  });

  describe("file privat lewat X-Accel-Redirect (N5)", () => {
    it("jawaban API ber-X-Accel-Redirect dikirim Nginx dari folder file, header unduhan tetap, header internal tidak bocor", async () => {
      edge.api.handler = (_req, res) => {
        res.writeHead(200, { "x-accel-redirect": "/_internal/files/products/abc.pdf", "content-type": "application/pdf", "content-disposition": 'attachment; filename="abc.pdf"', "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
        res.end();
      };
      const r = await request(edge, { path: "/api/downloads/TOKEN123" });
      expect(r.status).toBe(200);
      expect(r.text).toBe("ISI-PDF-RAHASIA");
      expect(r.headers["content-disposition"]).toBe('attachment; filename="abc.pdf"');
      expect(r.headers["cache-control"]).toBe("private, no-store");
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.headers["x-accel-redirect"]).toBeUndefined();
    });

    it("alamat internal tidak bisa dibuka langsung dari luar, termasuk dengan trik path", async () => {
      for (const path of ["/_internal/files/products/abc.pdf", "/_internal/files/../nginx.conf", "/_internal/files/%2e%2e/nginx.conf", "//_internal/files/products/abc.pdf"]) {
        const r = await request(edge, { path });
        expect(r.status, path).not.toBe(200);
        expect(r.text, path).not.toContain("ISI-PDF-RAHASIA");
      }
    });

    it("klien tidak bisa memerintahkan X-Accel-Redirect lewat header permintaan", async () => {
      edge.api.handler = (_req, res) => { res.setHeader("content-type", "text/plain"); res.end("biasa"); };
      const r = await request(edge, { path: "/api/catalog", headers: { "x-accel-redirect": "/_internal/files/products/abc.pdf" } });
      expect(r.text).toBe("biasa");
    });
  });

  describe("batas unggah", () => {
    const post = (path: string, bytes: number) => request(edge, { method: "POST", path, headers: { "content-type": "application/octet-stream", "content-length": String(bytes) }, body: Buffer.alloc(bytes, 1) });

    it("bukti bayar: 5 MB sampai ke API, 7 MB ditolak 413 dan tidak sampai ke API", async () => {
      edge.api.handler = (_q, res) => { res.statusCode = 201; res.end("{}"); };
      edge.api.seen.length = 0;
      expect((await post(`/api/orders/${UUID}/proof`, 5 * MB)).status).toBe(201);
      expect((await post(`/api/orders/${UUID}/proof`, 7 * MB)).status).toBe(413);
      expect(edge.api.seen).toHaveLength(1);
    });

    it("file produk dan sampul oleh admin punya batas sendiri: sampul 5 MB lewat, 7 MB ditolak; file produk 50 MB lewat", async () => {
      edge.api.handler = (_q, res) => { res.statusCode = 201; res.end("{}"); };
      expect((await post(`/api/admin/products/${UUID}/cover`, 5 * MB)).status).toBe(201);
      expect((await post(`/api/admin/products/${UUID}/cover`, 7 * MB)).status).toBe(413);
      expect((await post(`/api/admin/products/${UUID}/files`, 50 * MB)).status).toBe(201);
    });

    it("rute JSON biasa memakai batas kecil (di atas 100 KB ditolak, sama dengan Express)", async () => {
      edge.api.handler = (_q, res) => { res.statusCode = 200; res.end("{}"); };
      expect((await post("/api/cart/items", 50 * 1024)).status).toBe(200);
      expect((await post("/api/cart/items", 1 * MB)).status).toBe(413);
      expect((await post("/api/auth/login", 1 * MB)).status).toBe(413);
    });
  });

  describe("batas laju per IP untuk akun", () => {
    it("rute masuk dan daftar dibatasi (429), rute lain tidak", async () => {
      edge.api.handler = (_q, res) => { res.statusCode = 401; res.end("{}"); };
      const codes: number[] = [];
      for (let i = 0; i < 40; i++) codes.push((await request(edge, { method: "POST", path: "/api/auth/login", body: "{}", headers: { "content-type": "application/json" } })).status);
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(10);
      expect(codes.filter((c) => c === 401).length).toBeGreaterThan(0); // beberapa percobaan awal tetap lolos
      expect(codes.every((c) => c === 401 || c === 429)).toBe(true);
      edge.api.handler = (_q, res) => { res.statusCode = 200; res.end("{}"); };
      for (let i = 0; i < 40; i++) expect((await request(edge, { path: "/api/catalog" })).status).toBe(200);
    });
  });

  describe("log akses (N30)", () => {
    it("tanpa query string, tanpa token unduhan, dengan id permintaan dan status", async () => {
      edge.api.handler = (_q, res) => { res.statusCode = 200; res.end("{}"); };
      await request(edge, { path: "/api/catalog?q=rahasia@contoh.id&token=ABCDEF&page=2" });
      await request(edge, { path: "/produk/e-book?email=budi@contoh.id" });
      await request(edge, { path: "/api/downloads/TOKENRAHASIA123xyz" });
      await request(edge, { path: "/api/downloads/TOKENRAHASIA456abc?x=1" });
      const log = edge.accessLog();
      expect(log).not.toMatch(/\?/);
      for (const secret of ["rahasia@contoh.id", "ABCDEF", "budi@contoh.id", "TOKENRAHASIA123xyz", "TOKENRAHASIA456abc"]) expect(log, secret).not.toContain(secret);
      expect(log).toContain("/api/downloads/[disamarkan]");
      expect(log).toContain("/api/catalog");
      expect(log).toMatch(/\b200\b/);
      expect(log).toMatch(/[0-9a-f]{32}/); // id permintaan
    });

    it("tidak mencatat cookie, header Authorization, atau isi permintaan", async () => {
      await request(edge, { method: "POST", path: "/api/auth/login", headers: { cookie: "hayatun_sid=SESIRAHASIA", authorization: "Bearer RAHASIABEARER", "content-type": "application/json" }, body: JSON.stringify({ password: "PASSWORDRAHASIA" }) });
      const log = edge.accessLog();
      for (const secret of ["SESIRAHASIA", "RAHASIABEARER", "PASSWORDRAHASIA"]) expect(log, secret).not.toContain(secret);
    });

    it("token di path tidak ikut tercatat di log permintaan yang ditolak 413 atau 404 juga", async () => {
      await request(edge, { path: "/api/downloads/TOKENKEDUA789/../../x" });
      expect(edge.accessLog()).not.toContain("TOKENKEDUA789");
    });
  });
});
