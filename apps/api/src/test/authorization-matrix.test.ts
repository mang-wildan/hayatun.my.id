import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../modules/auth/sessions.js";
import { createTestContext, type TestContext } from "./context.js";
import { api, makeProduct } from "./products.js";

// N6: siapa boleh memanggil apa. Setiap rute API ada di tabel ini; tes "tabel lengkap" gagal bila rute baru tidak dimasukkan.
//  public  = tanpa login; user = pembeli atau admin; buyer = pembeli saja; admin = admin saja
//  owner   = hanya pemilik pesanan (pembeli lain dan admin mendapat 404)
//  ownerOrAdmin = pemilik atau admin (invoice: pembukaan oleh admin dicatat di log)
//  credential = tanpa sesi, tetapi 401 bila kode atau tokennya salah (alur masuk dua langkah)
//  link   = tautan bertanda tangan milik satu pembeli; selain pemiliknya mendapat 403 yang sama dengan tautan palsu (tidak membocorkan)
type Who = "public" | "credential" | "user" | "buyer" | "admin" | "owner" | "ownerOrAdmin" | "link";
const ID = "00000000-0000-4000-8000-000000000001";
const ROWS: [string, Who][] = [
  ["GET /api/health", "public"],
  ["POST /api/auth/register", "public"],
  ["POST /api/auth/verify-email", "public"],
  ["POST /api/auth/resend-verification", "public"],
  ["GET /api/auth/me", "user"],
  ["POST /api/auth/login", "public"],
  ["POST /api/auth/logout", "public"],
  ["POST /api/auth/forgot-password", "public"],
  ["POST /api/auth/reset-password", "public"],
  ["POST /api/auth/accept-invite", "public"],
  ["POST /api/auth/login/totp", "credential"],
  ["POST /api/auth/totp/setup", "credential"],
  ["POST /api/auth/totp/confirm", "credential"],
  ["POST /api/auth/totp/disable", "buyer"],
  ["GET /api/admin/products", "admin"],
  ["POST /api/admin/products", "admin"],
  ["GET /api/admin/products/:id", "admin"],
  ["PATCH /api/admin/products/:id", "admin"],
  ["POST /api/admin/products/:id/activate", "admin"],
  ["POST /api/admin/products/:id/deactivate", "admin"],
  ["POST /api/admin/products/:id/files", "admin"],
  ["POST /api/admin/products/:id/links", "admin"],
  ["DELETE /api/admin/products/:id/files/:fileId", "admin"],
  ["POST /api/admin/products/:id/licenses", "admin"],
  ["PUT /api/admin/products/:id/cover", "admin"],
  ["GET /api/admin/products/:id/cover", "admin"],
  ["GET /api/catalog", "public"],
  ["GET /api/catalog/:slug", "public"],
  ["GET /api/catalog/:slug/cover", "public"],
  ["GET /api/store", "public"],
  ["GET /api/admin/settings", "admin"],
  ["PUT /api/admin/settings/store", "admin"],
  ["PUT /api/admin/settings/bank-account", "admin"],
  ["GET /api/cart", "user"],
  ["POST /api/cart/items", "user"],
  ["PATCH /api/cart/items/:productId", "user"],
  ["DELETE /api/cart/items/:productId", "user"],
  ["GET /api/addresses", "user"],
  ["POST /api/addresses", "user"],
  ["PATCH /api/addresses/:id", "user"],
  ["DELETE /api/addresses/:id", "user"],
  ["POST /api/checkout/quote", "user"],
  ["POST /api/checkout", "user"],
  ["GET /api/invoices/:orderId", "ownerOrAdmin"],
  ["GET /api/orders", "user"],
  ["GET /api/orders/:id", "owner"],
  ["GET /api/orders/:id/payment", "ownerOrAdmin"],
  ["POST /api/orders/:id/cancel", "owner"],
  ["POST /api/orders/:id/proof", "owner"],
  ["POST /api/orders/:id/received", "owner"],
  ["GET /api/admin/shipments", "admin"],
  ["POST /api/admin/shipments/:orderId/tracking", "admin"],
  ["GET /api/admin/orders", "admin"],
  ["GET /api/admin/orders/summary", "admin"],
  ["POST /api/admin/orders/:id/cancel", "admin"],
  ["GET /api/account/deletion", "buyer"],
  ["POST /api/account/deletion", "buyer"],
  ["DELETE /api/account/deletion", "buyer"],
  ["GET /api/admin/admins", "admin"],
  ["POST /api/admin/admins", "admin"],
  ["POST /api/admin/admins/:id/disable", "admin"],
  ["GET /api/admin/audit-logs", "admin"],
  ["POST /api/admin/users/lookup", "admin"],
  ["POST /api/admin/users/:id/totp/disable", "admin"],
  ["GET /api/orders/:id/licenses", "owner"],
  ["GET /api/orders/:id/files", "owner"],
  ["POST /api/orders/:id/files/:fileId/download", "owner"],
  ["GET /api/downloads/:token", "link"],
  ["GET /api/admin/payments", "admin"],
  ["GET /api/admin/payments/:orderId/proof", "admin"],
  ["POST /api/admin/payments/:orderId/accept", "admin"],
  ["POST /api/admin/payments/:orderId/reject", "admin"],
];
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(500)]);

let ctx: TestContext;
let anon: string;
const cookies = {} as Record<"siti" | "rina" | "admin", string>;
const seed = {} as { orderId: string; invoice: string; fileId: string; token: string };

beforeAll(async () => {
  ctx = await createTestContext();
  cookies.admin = await ctx.adminCookie();
  for (const who of ["siti", "rina"] as const) {
    const id = await ctx.createUser({ email: `${who}@hayatun.test`, password: "rahasia-hayatun-1", name: who === "siti" ? "Siti Aminah" : "Rina Marlina" });
    cookies[who] = `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`;
  }
  anon = "";
  // pesanan digital milik Siti yang sudah Lunas, lengkap dengan file dan tautan unduhan
  const admin = api(ctx, cookies.admin);
  const siti = api(ctx, cookies.siti);
  const p = await makeProduct(ctx, cookies.admin, { name: "E-book Ramadan", price: 75000 });
  seed.fileId = (await admin.upload(`/api/admin/products/${p.id}/files?filename=rahasia-siti.pdf`, PDF, "application/pdf").expect(201)).body.id;
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await siti.post("/api/cart/items", { productId: p.id }).expect(201);
  seed.orderId = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body.orderId;
  await siti.upload(`/api/orders/${seed.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${seed.orderId}/accept`).expect(200);
  seed.invoice = (await ctx.db.execute(sql`select invoice_number from orders where id = ${seed.orderId}`)).rows[0].invoice_number as string;
  seed.token = ((await siti.post(`/api/orders/${seed.orderId}/files/${seed.fileId}/download`).expect(200)).body.url as string).split("/").pop()!;
});
afterAll(() => ctx.close());

const fill = (path: string, owned: boolean) => path
  .replace(":token", owned ? seed.token : randomBytes(24).toString("base64url"))
  .replace(":fileId", owned ? seed.fileId : ID)
  .replace(/:(id|orderId|productId)/, owned ? seed.orderId : ID).replace(":slug", "tidak-ada");
const call = (method: string, path: string, cookie: string) => {
  const r = (request(ctx.app) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()](path);
  if (cookie) r.set("Cookie", cookie);
  return r.send({});
};
const DEFAULT_404 = /^Cannot (GET|POST|PUT|PATCH|DELETE) /;
const exists = (res: { text: string }) => !DEFAULT_404.test(res.text); // bukan 404 bawaan Express karena rutenya tidak ada
const SIDE_EFFECT_FREE_ALLOWED = (key: string) => key !== "POST /api/auth/logout"; // mencabut sesi yang dipakai tes lain

describe("tabel lengkap", () => {
  it("setiap rute API aplikasi ada di tabel, dan setiap baris tabel adalah rute sungguhan", () => {
    const mounts = [...new Set([...readFileSync(new URL("../app.ts", import.meta.url), "utf8").matchAll(/app\.use\("(\/api[^"]*)"/g)].map((m) => m[1]))];
    const found: string[] = [];
    for (const l of (ctx.app as any).router.stack) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!l.handle?.stack) continue;
      const prefix = mounts.filter((c) => { const m = l.matchers[0](c); return m && m.path === c; }).sort((a, b) => b.length - a.length)[0];
      for (const s of l.handle.stack) if (s.route) for (const m of Object.keys(s.route.methods)) found.push(`${m.toUpperCase()} ${prefix}${s.route.path === "/" ? "" : s.route.path}`);
    }
    expect(found.sort()).toEqual(ROWS.map(([k]) => k).sort());
  });
});

describe.each(ROWS)("%s (%s)", (key, who) => {
  const [method, template] = key.split(" ");
  const other = who === "owner" || who === "ownerOrAdmin";

  it("tanpa login", async () => {
    const res = await call(method, fill(template, false), anon);
    expect(exists(res), "rute ada").toBe(true);
    if (who === "public") expect([401, 403]).not.toContain(res.status);
    else if (who === "credential") expect(res.status).toBeLessThan(500);
    else { expect(res.status).toBe(401); expect(res.body.code).toBe("UNAUTHENTICATED"); }
  });

  if (who === "admin") {
    it("pembeli ditolak 403", async () => {
      const res = await call(method, fill(template, false), cookies.siti);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });
    it("admin diterima", async () => {
      if (!SIDE_EFFECT_FREE_ALLOWED(key)) return;
      const res = await call(method, fill(template, false), cookies.admin);
      expect([401, 403]).not.toContain(res.status);
      expect(exists(res)).toBe(true);
    });
  }
  if (who === "buyer") {
    it("admin ditolak 403", async () => {
      const res = await call(method, fill(template, false), cookies.admin);
      expect(res.status).toBe(403);
    });
    it("pembeli diterima", async () => {
      const res = await call(method, fill(template, false), cookies.rina);
      expect([401, 403]).not.toContain(res.status);
    });
  }
  if (who === "user" || who === "public") {
    it("pembeli dan admin sama-sama diterima", async () => {
      if (!SIDE_EFFECT_FREE_ALLOWED(key)) return;
      for (const c of [cookies.rina, cookies.admin]) expect([401, 403]).not.toContain((await call(method, fill(template, false), c)).status);
    });
  }
  if (other) {
    it("pembeli lain mendapat 404 tanpa satu pun data pesanan Siti", async () => {
      const res = await call(method, fill(template, true), cookies.rina);
      expect(res.status).toBe(404);
      const leaked = JSON.stringify(res.body) + res.text;
      for (const secret of [seed.orderId, seed.invoice, "rahasia-siti", "Siti", seed.token]) expect(leaked, secret).not.toContain(secret);
    });
    if (who === "ownerOrAdmin" && method === "GET") {
      it("admin boleh membukanya", async () => { await call(method, fill(template, true), cookies.admin).expect(200); });
    }
    if (who === "owner") {
      it("admin juga 404: ini bukan pesanannya", async () => {
        const res = await call(method, fill(template, true), cookies.admin);
        expect(res.status).toBe(404);
        expect(exists(res)).toBe(true);
      });
    }
    if (method === "GET") {
      it("pemilik dapat membukanya", async () => { await call(method, fill(template, true), cookies.siti).expect(200); });
    }
  }
  if (who === "link") {
    it("pembeli lain dan admin mendapat 403 yang sama dengan tautan palsu, tanpa isi file", async () => {
      const forged = await call(method, fill(template, false), cookies.rina);
      expect(forged.status).toBe(403);
      for (const c of [cookies.rina, cookies.admin]) {
        const res = await call(method, fill(template, true), c);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(forged.body);
        expect(res.headers["content-type"]).not.toMatch(/pdf|octet/);
        expect(res.text).not.toContain("rahasia-siti");
      }
    });
    it("pemilik dapat mengunduh", async () => {
      const res = await call(method, fill(template, true), cookies.siti);
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain("rahasia-siti.pdf");
    });
  }
});

describe("pesanan Siti tidak berubah oleh percobaan pembeli lain dan admin", () => {
  it("status, bukti bayar, dan sesi tetap sama setelah semua percobaan di atas", async () => {
    const [o] = (await ctx.db.execute(sql`select status, digital_status, tracking_number from orders where id = ${seed.orderId}`)).rows;
    expect(o).toMatchObject({ status: "LUNAS" });
    expect((await ctx.db.execute(sql`select 1 from payment_proofs where order_id = ${seed.orderId}`)).rows).toHaveLength(1);
  });
  it("admin yang membuka invoice pembeli dicatat di log aktivitas", async () => {
    const count = async () => (await ctx.db.execute(sql`select 1 from audit_logs where action = 'invoice.viewed' and entity_id = ${seed.orderId}`)).rows.length;
    const before = await count();
    await call("GET", `/api/invoices/${seed.orderId}`, cookies.admin).expect(200);
    expect(await count()).toBe(before + 1);
    await call("GET", `/api/invoices/${seed.orderId}`, cookies.siti).expect(200); // pemilik sendiri tidak dicatat
    expect(await count()).toBe(before + 1);
  });
  it("sesi acak atau cookie rusak diperlakukan seperti tanpa login", async () => {
    for (const bad of ["hayatun_sid=" + randomUUID(), "hayatun_sid=", "hayatun_sid=%00"]) {
      const res = await call("GET", "/api/admin/payments", bad);
      expect(res.status, bad).toBe(401);
    }
  });
});
