import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryQueue } from "../../jobs/queue.js";
import { createTestContext, type TestContext } from "../../test/context.js";
import { api, filesOnDisk, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { registerOrderJobs } from "./expiry.js";
import { deleteExpiredProofs } from "./proof-retention.js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const MIN = 60_000;

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie(); // "admin 1"
  admin = api(ctx, adminCookie);
  const id = await ctx.createUser({ email: "siti@hayatun.test", password: "rahasia-hayatun-1", name: "Siti Aminah" });
  siti = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
});
afterEach(() => ctx.close());

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const deps = () => ({ db: ctx.db, storage: ctx.storage, logger: ctx.logger, now: () => ctx.clock.now });
const run = () => deleteExpiredProofs(deps());
const proofs = (orderId: string) => rows<{ id: string; status: string; file_deleted_at: string | null; reviewed_by: string | null; storage_key: string }>(sql`select id, status, file_deleted_at, reviewed_by, storage_key from payment_proofs where order_id = ${orderId} order by uploaded_at, id`);
const audit = async () => rows<{ actor_id: string | null; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_id, details from audit_logs where action = 'payment_proof.deleted' order by id`);
const age = (orderId: string, ms: number) => ctx.db.execute(sql`update payment_proofs set uploaded_at = ${new Date(ctx.clock.now.getTime() - ms).toISOString()} where order_id = ${orderId}`);

// pesanan digital Lunas dengan satu bukti diterima
async function paidOrder() {
  const p = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
  await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await siti.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
  await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return o.orderId;
}

describe("hapus otomatis bukti bayar setelah 1 tahun (F12.3, N29)", () => {
  it("lebih dari setahun: file terhapus dari disk dan baris ditandai; kurang dari setahun tetap utuh", async () => {
    const old = await paidOrder();
    const fresh = await paidOrder();
    await age(old, YEAR + MIN);
    await age(fresh, YEAR - MIN);
    expect(await filesOnDisk(ctx, "proofs")).toHaveLength(2);
    expect(await run()).toBe(1);
    expect(await filesOnDisk(ctx, "proofs")).toHaveLength(1);
    const [o] = await proofs(old);
    expect(o.file_deleted_at).not.toBeNull();
    expect(new Date(o.file_deleted_at!).getTime()).toBe(ctx.clock.now.getTime());
    expect((await proofs(fresh))[0].file_deleted_at).toBeNull();
  });

  it("tepat setahun sudah termasuk", async () => {
    const o = await paidOrder();
    await age(o, YEAR);
    expect(await run()).toBe(1);
  });

  it("semua status bukti ikut: diterima, ditolak, dan masih menunggu", async () => {
    const accepted = await paidOrder();
    const p = await makeProduct(ctx, adminCookie, { name: "Lain", price: 50000 });
    await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: p.id }).expect(201);
    const pending = (await siti.post("/api/checkout", { expectedTotal: 50000 }).expect(201)).body.orderId as string;
    await siti.upload(`/api/orders/${pending}/proof`, PDF, "application/pdf").expect(201);
    const rejected = await paidOrder();
    await ctx.db.execute(sql`update payment_proofs set status = 'rejected' where order_id = ${rejected}`);
    for (const id of [accepted, pending, rejected]) await age(id, YEAR + DAY);
    expect(await run()).toBe(3);
    expect(await filesOnDisk(ctx, "proofs")).toEqual([]);
  });

  it("bukti lama dan bukti baru pada pesanan yang sama dihitung sendiri-sendiri", async () => {
    const o = await paidOrder();
    const first = await proofs(o);
    await ctx.db.execute(sql`insert into payment_proofs (order_id, storage_key, mime, size_bytes, status, uploaded_at) values (${o}, ${"proofs/" + "00000000-0000-4000-8000-000000000001.pdf"}, 'application/pdf', 10, 'rejected', ${new Date(ctx.clock.now.getTime() - 2 * YEAR).toISOString()})`);
    expect(await run()).toBe(1);
    const all = await proofs(o);
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === first[0].id)!.file_deleted_at).toBeNull();
    expect(all.find((p) => p.id !== first[0].id)!.file_deleted_at).not.toBeNull();
  });

  it("catatan tetap: baris bukti, siapa yang memverifikasi, kapan, dan status pesanan tidak berubah", async () => {
    const o = await paidOrder();
    const before = (await rows<{ status: string; verified_by: string; paid_at: string }>(sql`select status, verified_by, paid_at from orders where id = ${o}`))[0];
    const proofBefore = (await proofs(o))[0];
    await age(o, YEAR + DAY);
    await run();
    expect((await rows(sql`select status, verified_by, paid_at from orders where id = ${o}`))[0]).toEqual(before);
    const after = (await proofs(o))[0];
    expect(after).toMatchObject({ id: proofBefore.id, status: "accepted", reviewed_by: proofBefore.reviewed_by, storage_key: proofBefore.storage_key });
    expect((await siti.get(`/api/orders/${o}/payment`).expect(200)).body.status).toBe("LUNAS");
  });

  it("dicatat di log sebagai aksi sistem, tanpa data pribadi, sekali per bukti", async () => {
    const o = await paidOrder();
    await age(o, YEAR + DAY);
    await run();
    await run();
    const log = await audit();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: null, entity_id: o, details: { proofId: (await proofs(o))[0].id } });
  });

  it("aman diulang dan dijalankan bersamaan: tepat sekali per bukti", async () => {
    const orders = [await paidOrder(), await paidOrder(), await paidOrder()];
    for (const o of orders) await age(o, 2 * YEAR);
    const counts = await Promise.all([run(), run(), run()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(await audit()).toHaveLength(3);
    expect(await run()).toBe(0);
  });

  it("file sudah tidak ada di disk: tetap ditandai tanpa error", async () => {
    const o = await paidOrder();
    await age(o, 2 * YEAR);
    await rm(join(ctx.config.storage.dir, (await proofs(o))[0].storage_key));
    expect(await run()).toBe(1);
    expect((await proofs(o))[0].file_deleted_at).not.toBeNull();
  });

  it("satu bukti gagal dihapus (kunci rusak): yang lain tetap diproses, yang gagal dicoba lagi lain kali", async () => {
    const good = await paidOrder();
    const bad = await paidOrder();
    await age(good, 2 * YEAR);
    await age(bad, 2 * YEAR);
    await ctx.db.execute(sql`update payment_proofs set storage_key = 'rusak' where order_id = ${bad}`);
    expect(await run()).toBe(1);
    expect((await proofs(good))[0].file_deleted_at).not.toBeNull();
    expect((await proofs(bad))[0].file_deleted_at).toBeNull();
    expect(await audit()).toHaveLength(1);
  });

  it("banyak sekaligus: semua diproses dalam satu panggilan", async () => {
    const o = await paidOrder();
    await ctx.db.execute(sql`insert into payment_proofs (order_id, storage_key, mime, size_bytes, status, uploaded_at)
      select ${o}::uuid, 'proofs/' || gen_random_uuid() || '.pdf', 'application/pdf', 10, 'rejected', ${new Date(ctx.clock.now.getTime() - 2 * YEAR).toISOString()}::timestamptz from generate_series(1, 230)`);
    expect(await run()).toBe(230);
    expect(await run()).toBe(0);
  });

  it("ikut tugas sapu per menit yang sudah terjadwal", async () => {
    const o = await paidOrder();
    const queue = createMemoryQueue();
    await registerOrderJobs(queue, { ...deps(), queue, crypto: ctx.crypto, config: ctx.config });
    ctx.clock.advance(YEAR + DAY);
    await queue.send("orders.sweep", {});
    await queue.runAll();
    expect((await proofs(o))[0].file_deleted_at).not.toBeNull();
  });
});

describe("membuka bukti yang sudah dihapus", () => {
  it("admin mendapat 410 dengan catatan siapa dan kapan memverifikasi, bukan error server dan bukan catatan pembukaan", async () => {
    const o = await paidOrder();
    await age(o, YEAR + DAY);
    await run();
    const res = await admin.get(`/api/admin/payments/${o}/proof`).expect(410);
    expect(res.body).toMatchObject({
      code: "PROOF_DELETED", message: "Bukti bayar sudah dihapus setelah 1 tahun.",
      note: "Lunas, diverifikasi oleh admin 1 pada 26 Okt 2026, 14.00 WIB",
    });
    expect((await rows(sql`select 1 from audit_logs where action = 'payment_proof.viewed'`))).toHaveLength(0);
  });

  it("bukti yang belum dihapus tetap terbuka seperti biasa", async () => {
    const o = await paidOrder();
    await age(o, YEAR - DAY);
    await run();
    await admin.get(`/api/admin/payments/${o}/proof`).expect(200);
  });
});
