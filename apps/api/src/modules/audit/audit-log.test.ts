import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryQueue } from "../../jobs/queue.js";
import { createTestContext, type TestContext } from "../../test/context.js";
import { PNG, api, makeProduct } from "../../test/products.js";
import { registerOrderJobs } from "../jobs/expiry.js";
import { recordAudit } from "./index.js";

let ctx: TestContext;
let cookie: string;
let admin: ReturnType<typeof api>;
let adminId: string;
let buyerId: string;
beforeEach(async () => {
  ctx = await createTestContext();
  cookie = await ctx.adminCookie();
  admin = api(ctx, cookie);
  adminId = (await rows<{ id: string }>(sql`select id from users where role = 'admin'`))[0].id;
  buyerId = await ctx.createUser({ email: "siti@hayatun.test", password: "rahasia-hayatun-1", name: "Siti Aminah" });
});
afterEach(() => ctx.close());

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const audits = (action: string) => rows<{ actor_id: string | null; entity_type: string; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_type, entity_id, details from audit_logs where action = ${action} order by id`);
const log = (qs = "", who = admin) => who.get(`/api/admin/audit-logs${qs}`);

async function seedOrder(invoice: string, status = "MENUNGGU_VERIFIKASI", userId = buyerId) {
  const [o] = await rows<{ id: string }>(sql`insert into orders (invoice_number, user_id, status, digital_status, physical_status, subtotal, shipping_cost, total, expires_at)
    values (${invoice}, ${userId}, ${status}, 'TIDAK_ADA', 'TIDAK_ADA', 75000, 0, 75000, now()) returning id`);
  if (status === "MENUNGGU_VERIFIKASI") {
    await ctx.db.execute(sql`insert into payment_proofs (order_id, storage_key, mime, size_bytes) values (${o.id}, ${"proofs/" + randomBytes(8).toString("hex") + ".png"}, 'image/png', 10)`);
  }
  return o.id;
}

describe("halaman log: GET /api/admin/audit-logs (F15.3)", () => {
  it("terbaru dulu, dengan siapa, apa, kapan, dan pesanan atau produk terkait", async () => {
    const orderId = await seedOrder("INV/2026/10/0001");
    const product = await makeProduct(ctx, cookie, { name: "E-book Ramadan" });
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.accepted", entityType: "order", entityId: orderId });
    await recordAudit(ctx.db, { actorId: adminId, action: "product.stock_changed", entityType: "product", entityId: product.id, details: { from: 3, to: 9 } });
    await recordAudit(ctx.db, { actorId: null, action: "order.expired", entityType: "order", entityId: orderId });
    await recordAudit(ctx.db, { actorId: adminId, action: "settings.store_changed", entityType: "settings", entityId: "store" });
    const res = (await log().expect(200)).body;
    expect(res.logs.map((l: { action: string }) => l.action)).toEqual(["settings.store_changed", "order.expired", "product.stock_changed", "payment.accepted", "product.created"]);
    expect(res.logs[0]).toEqual({ id: expect.any(Number), action: "settings.store_changed", actorName: "admin 1", entityType: "settings", entityId: "store", entityLabel: null, details: {}, createdAt: expect.any(String) });
    expect(res.logs[1]).toMatchObject({ actorName: null, entityLabel: "INV/2026/10/0001" }); // aksi sistem
    expect(res.logs[2]).toMatchObject({ entityLabel: "E-book Ramadan", details: { from: 3, to: 9 } });
    expect(res.logs[3]).toMatchObject({ actorName: "admin 1", entityLabel: "INV/2026/10/0001" });
    expect(res).toMatchObject({ total: 5, page: 1, pageSize: 50 });
  });

  it("daftar jenis aksi untuk filter ikut dikirim, urut abjad tanpa duplikat", async () => {
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.rejected", entityType: "order", entityId: "x" });
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.accepted", entityType: "order", entityId: "x" });
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.accepted", entityType: "order", entityId: "y" });
    expect((await log().expect(200)).body.actions).toEqual(["payment.accepted", "payment.rejected"]);
  });

  it("filter jenis aksi persis; aksi yang tidak ada memberi daftar kosong", async () => {
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.rejected", entityType: "order", entityId: "x" });
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.accepted", entityType: "order", entityId: "y" });
    const res = (await log("?action=payment.accepted").expect(200)).body;
    expect(res.logs.map((l: { entityId: string }) => l.entityId)).toEqual(["y"]);
    expect(res.total).toBe(1);
    expect((await log("?action=payment.%25").expect(200)).body.logs).toEqual([]); // bukan pola LIKE
    expect((await log("?action=").expect(200)).body.total).toBe(2); // kosong = semua
  });

  it("50 per halaman; halaman 2 melanjutkan; halaman tidak valid ditolak", async () => {
    await ctx.db.execute(sql`insert into audit_logs (actor_id, action, entity_type, entity_id) select ${adminId}::uuid, 'order.shipped', 'order', g::text from generate_series(1, 120) g`);
    const p1 = (await log().expect(200)).body;
    const p3 = (await log("?page=3").expect(200)).body;
    expect(p1.logs).toHaveLength(50);
    expect(p3.logs).toHaveLength(20);
    expect(p1.total).toBe(120);
    expect(p3.page).toBe(3);
    expect(new Set([...p1.logs, ...(await log("?page=2").expect(200)).body.logs, ...p3.logs].map((l: { id: number }) => l.id)).size).toBe(120);
    for (const bad of ["0", "abc", "-1", "1.5"]) expect((await log(`?page=${bad}`).expect(422)).body.message).toBe("Halaman tidak valid.");
  });

  it("tidak memuat email atau data pribadi pembeli, hanya nama admin pelaku", async () => {
    await recordAudit(ctx.db, { actorId: adminId, action: "user.viewed", entityType: "user", entityId: buyerId });
    const text = JSON.stringify((await log().expect(200)).body);
    expect(text).not.toMatch(/siti@|Siti Aminah|rahasia/);
    expect((await log().expect(200)).body.logs[0].entityLabel).toBeNull();
  });

  it("membuka log tidak mencatat apa pun; panel hanya untuk admin", async () => {
    await log().expect(200);
    await log("?page=1").expect(200);
    expect(await rows(sql`select 1 from audit_logs`)).toHaveLength(0);
    const buyer = api(ctx, await ctx.buyerCookie());
    await log("", buyer).expect(403);
    await ctx.get("/api/admin/audit-logs").expect(401);
  });

  it("log tidak bisa diubah atau dihapus lewat API (F15.4)", async () => {
    await recordAudit(ctx.db, { actorId: adminId, action: "payment.accepted", entityType: "order", entityId: "x" });
    for (const m of ["post", "put", "patch", "delete"] as const) {
      const r = admin[m === "delete" ? "del" : m === "put" ? "put" : m === "patch" ? "patch" : "post"];
      const id = (await log().expect(200)).body.logs[0].id;
      for (const path of ["/api/admin/audit-logs", `/api/admin/audit-logs/${id}`]) {
        const res = m === "put" ? await admin.put(path, Buffer.from("{}"), "application/json") : await (r as (p: string, b?: object) => Promise<{ status: number }>)(path, {});
        expect(res.status, `${m} ${path}`).toBe(404);
      }
    }
    expect(await rows(sql`select 1 from audit_logs`)).toHaveLength(1);
  });
});

describe("pembukaan nama pembeli dicatat (F15.3, N28)", () => {
  it("antrean verifikasi: satu catatan per pesanan yang tampil, tanpa data pribadi", async () => {
    const a = await seedOrder("INV/2026/10/0001");
    const b = await seedOrder("INV/2026/10/0002");
    await seedOrder("INV/2026/10/0003", "LUNAS"); // tidak tampil di antrean
    const res = (await admin.get("/api/admin/payments").expect(200)).body;
    expect(res.items).toHaveLength(2);
    const got = await audits("order.buyer_viewed");
    expect(got.map((g) => g.entity_id).sort()).toEqual([a, b].sort());
    expect(got.every((g) => g.actor_id === adminId && g.entity_type === "order" && Object.keys(g.details).length === 0)).toBe(true);
  });

  it("antrean kosong tidak menulis catatan", async () => {
    await admin.get("/api/admin/payments").expect(200);
    expect(await audits("order.buyer_viewed")).toEqual([]);
  });

  it("daftar pesanan: hanya pesanan di halaman yang ditampilkan, dan sesuai filter", async () => {
    const a = await seedOrder("INV/2026/10/0001", "LUNAS");
    await seedOrder("INV/2026/10/0002", "MENUNGGU_PEMBAYARAN");
    await admin.get("/api/admin/orders?status=LUNAS").expect(200);
    expect((await audits("order.buyer_viewed")).map((g) => g.entity_id)).toEqual([a]);
  });

  it("daftar 25 baris pada halaman 2 mencatat baris halaman 2 saja", async () => {
    for (let i = 1; i <= 27; i++) await seedOrder(`INV/2026/10/${String(i).padStart(4, "0")}`, "LUNAS");
    await admin.get("/api/admin/orders?page=2").expect(200);
    expect(await audits("order.buyer_viewed")).toHaveLength(2);
  });

  it("pembeli yang melihat daftar pesanannya sendiri tidak mencatat apa pun", async () => {
    await seedOrder("INV/2026/10/0001", "LUNAS");
    const buyer = api(ctx, await ctx.buyerCookie());
    await buyer.get("/api/orders").expect(200);
    expect(await audits("order.buyer_viewed")).toEqual([]);
  });

  it("permintaan ditolak (bukan admin) atau filter tidak valid tidak mencatat apa pun", async () => {
    await seedOrder("INV/2026/10/0001", "LUNAS");
    await admin.get("/api/admin/orders?page=0").expect(422);
    await api(ctx, await ctx.buyerCookie()).get("/api/admin/orders").expect(403);
    expect(await audits("order.buyer_viewed")).toEqual([]);
  });
});

describe("aksi produk yang belum punya tes catatan", () => {
  it("file ditambah dan dihapus, serta sampul diganti, dicatat dengan pelaku dan produk", async () => {
    const p = await makeProduct(ctx, cookie);
    const f = (await admin.upload(`/api/admin/products/${p.id}/files?filename=a.pdf`, Buffer.from("isi")).expect(201)).body;
    await admin.put(`/api/admin/products/${p.id}/cover`, PNG, "image/png").expect(200);
    await admin.del(`/api/admin/products/${p.id}/files/${f.id}`).expect(204);
    for (const action of ["product.file_added", "product.cover_changed", "product.file_removed"]) {
      expect(await audits(action), action).toEqual([{ actor_id: adminId, entity_type: "product", entity_id: p.id, details: {} }]);
    }
  });
});

describe("masa simpan log (N28, A12)", () => {
  it("tugas sapu per menit tidak menghapus catatan lama, bahkan setelah 3 tahun", async () => {
    await ctx.db.execute(sql`insert into audit_logs (actor_id, action, entity_type, entity_id, created_at) values (${adminId}::uuid, 'payment.accepted', 'order', 'lama', now() - interval '3 years')`);
    const queue = createMemoryQueue();
    await registerOrderJobs(queue, { db: ctx.db, storage: ctx.storage, logger: ctx.logger, now: () => ctx.clock.now, queue, crypto: ctx.crypto, config: ctx.config });
    ctx.clock.advance(3 * 365 * 24 * 3600_000);
    await queue.send("orders.sweep", {});
    await queue.runAll();
    expect(await audits("payment.accepted")).toHaveLength(1);
  });
});
