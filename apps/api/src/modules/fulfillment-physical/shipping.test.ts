import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryQueue } from "../../jobs/queue.js";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { PHYSICAL, api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { registerOrderJobs } from "../jobs/expiry.js";
import { renderEmail } from "../notifications/templates.js";
import { autoReceiveOrders } from "./auto-receive.js";

const SHIPPED = "Pesananmu sedang dikirim";
const UPDATED = "Nomor resi pesananmu diperbarui";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300)]);
const ADDRESS = { recipient: "Budi Santoso", phone: "+6281234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const MIN = 60_000;
const DAY = 24 * 3600_000;
const RESI = "SCP1234567890";

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
let rina: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie(); // admin1@hayatun.test
  admin = api(ctx, adminCookie);
  siti = await buyer("siti@hayatun.test");
  rina = await buyer("rina@hayatun.test");
});
afterEach(() => ctx.close());

async function buyer(email: string) {
  const id = await ctx.createUser({ email, password: "rahasia-hayatun-1", name: "Siti Aminah" });
  return api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
}
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const order = async (id: string) => (await rows<{ physical_status: string; tracking_number: string | null; shipped_at: string | null; status: string }>(sql`select physical_status, tracking_number, shipped_at, status from orders where id = ${id}`))[0];
const audit = async (action: string) => rows<{ actor_id: string | null; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_id, details from audit_logs where action = ${action} order by id`);
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);
const track = (id: string, trackingNumber: unknown, who = admin) => who.post(`/api/admin/shipments/${id}/tracking`, { trackingNumber });
const received = (id: string, who = siti) => who.post(`/api/orders/${id}/received`);

// pesanan fisik Rp255.000 (2 nastar + ongkir SiCepat REG Rp15.000) yang sudah Lunas: bagian fisik Diproses
async function processing(who = siti, name = "Nastar") {
  const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name, price: 120000, stockQty: 20 });
  await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: f.id, qty: 2 }).expect(201);
  const addressId = (await who.post("/api/addresses", ADDRESS).expect(201)).body.id;
  const o = (await who.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: 255000 }).expect(201)).body as { orderId: string; invoiceNumber: string };
  await who.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return o;
}
async function digitalOnly() {
  const p = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
  await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await siti.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
  await siti.upload(`/api/orders/${o.orderId}/proof`, PDF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return o;
}

async function overlapped<T>(orderId: string, waiting: number, fire: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select id from orders where id = $1 for update", [orderId]);
    const running = fire();
    for (let i = 0; i < 150; i++) {
      const { rows: waits } = await client.query<{ n: number }>("select count(distinct pid)::int as n from pg_locks where not granted");
      if (waits[0].n >= waiting) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await client.query("commit");
    return await running;
  } finally {
    await client.end();
  }
}

describe("daftar pengiriman admin (F8.1)", () => {
  it("pesanan Diproses paling lama dibayar dulu, lalu yang sudah Dikirim; lengkap dengan alamat dan ekspedisi pilihan pembeli", async () => {
    const first = await processing(siti, "Nastar");
    ctx.clock.advance(10 * MIN);
    admin = api(ctx, await ctx.adminCookie());
    const second = await processing(rina, "Putri Salju");
    ctx.clock.advance(10 * MIN);
    admin = api(ctx, await ctx.adminCookie());
    const shipped = await processing(siti, "Kastengel");
    await track(shipped.orderId, RESI).expect(200);
    await digitalOnly(); // tidak punya bagian fisik
    const res = (await admin.get("/api/admin/shipments").expect(200)).body;
    expect(res.items.map((i: { orderId: string }) => i.orderId)).toEqual([first.orderId, second.orderId, shipped.orderId]);
    expect(res.items[0]).toEqual({
      orderId: first.orderId, invoiceNumber: first.invoiceNumber, paidAt: expect.any(String), physicalStatus: "DIPROSES", courier: "SiCepat", service: "REG",
      recipient: "Budi Santoso", phone: "+6281234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172",
      trackingNumber: null, shippedAt: null, items: [{ name: "Nastar", qty: 2 }],
    });
    expect(res.items[2]).toMatchObject({ physicalStatus: "DIKIRIM", trackingNumber: RESI, shippedAt: expect.any(String) });
  });

  it("pesanan yang sudah Diterima atau belum lunas tidak tampil", async () => {
    const done = await processing();
    await track(done.orderId, RESI).expect(200);
    await received(done.orderId).expect(200);
    const f = await makeProduct(ctx, adminCookie, { ...PHYSICAL, name: "Belum Bayar", stockQty: 5 });
    await admin.post(`/api/admin/products/${f.id}/activate`).expect(200);
    await rina.post("/api/cart/items", { productId: f.id }).expect(201);
    const addressId = (await rina.post("/api/addresses", ADDRESS).expect(201)).body.id;
    await rina.post("/api/checkout", { addressId, courier: "SiCepat", service: "REG", expectedTotal: PHYSICAL.price + 15000 }).expect(201);
    expect((await admin.get("/api/admin/shipments").expect(200)).body.items).toEqual([]);
  });

  it("hanya admin: pembeli 403, tanpa masuk 401", async () => {
    await siti.get("/api/admin/shipments").expect(403);
    await request(ctx.app).get("/api/admin/shipments").expect(401);
    await siti.post(`/api/admin/shipments/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/tracking`, { trackingNumber: RESI }).expect(403);
  });

  it("setiap pembukaan alamat tercatat: satu catatan per pesanan per pemuatan (N28)", async () => {
    const a = await processing(siti, "Nastar");
    const b = await processing(rina, "Putri Salju");
    expect(await audit("order.address_viewed")).toEqual([]);
    await admin.get("/api/admin/shipments").expect(200);
    let log = await audit("order.address_viewed");
    expect(log.map((l) => l.entity_id).sort()).toEqual([a.orderId, b.orderId].sort());
    expect(log.every((l) => l.actor_id)).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/Pajajaran|81234567890|Budi/);
    await admin.get("/api/admin/shipments").expect(200);
    log = await audit("order.address_viewed");
    expect(log).toHaveLength(4);
  });

  it("daftar kosong: tanpa catatan pembukaan", async () => {
    expect((await admin.get("/api/admin/shipments").expect(200)).body).toEqual({ items: [] });
    expect(await audit("order.address_viewed")).toEqual([]);
  });
});

describe("mengisi resi (F8.2, F8.4)", () => {
  it("resi kosong, spasi saja, kurang dari 8, lebih dari 40, atau bukan teks ditolak dengan pesan per kolom; status dan email tidak berubah", async () => {
    const o = await processing();
    const bad: [unknown, string][] = [
      ["", "Nomor resi wajib diisi."], ["   ", "Nomor resi wajib diisi."], [undefined, "Nomor resi wajib diisi."], [12345678, "Nomor resi wajib diisi."],
      ["SCP1234", "Nomor resi minimal 8 karakter."], ["  SCP123  ", "Nomor resi minimal 8 karakter."], ["A".repeat(41), "Nomor resi maksimal 40 karakter."],
    ];
    for (const [value, message] of bad) {
      const res = await track(o.orderId, value).expect(422);
      expect(res.body.fields.trackingNumber, String(value)).toBe(message);
    }
    expect(await order(o.orderId)).toMatchObject({ physical_status: "DIPROSES", tracking_number: null, shipped_at: null });
    expect(await mails(SHIPPED)).toHaveLength(0);
    await track(o.orderId, "SCP12345").expect(200); // tepat 8 boleh
  });

  it("menyimpan resi (spasi dipangkas): Dikirim, waktu kirim tercatat, pembeli diemail, log mencatat siapa dan resinya", async () => {
    const o = await processing();
    const res = await track(o.orderId, `  ${RESI}  `).expect(200);
    expect(res.body).toEqual({ physicalStatus: "DIKIRIM", trackingNumber: RESI });
    const row = await order(o.orderId);
    expect(row).toMatchObject({ physical_status: "DIKIRIM", tracking_number: RESI, status: "LUNAS" });
    expect(new Date(row.shipped_at!).getTime()).toBe(ctx.clock.now.getTime());
    const [m, ...rest] = await mails(SHIPPED);
    expect(rest).toEqual([]);
    expect(m.to).toBe("siti@hayatun.test");
    expect(m.text).toContain(o.invoiceNumber);
    expect(m.text).toContain("SiCepat REG");
    expect(m.text).toContain(RESI);
    expect(m.text).toContain(`${APP_URL}/pesanan/${o.orderId}`);
    expect(m.text + m.html).not.toMatch(/Pajajaran|81234567890|Santoso|Cicendo/);
    const log = await audit("order.shipped");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: o.orderId, details: { trackingNumber: RESI } });
    expect(log[0].actor_id).toBeTruthy();
    const detail = (await siti.get(`/api/orders/${o.orderId}`).expect(200)).body;
    expect(detail).toMatchObject({ physicalStatus: "DIKIRIM", shipping: { courier: "SiCepat", service: "REG", trackingNumber: RESI } });
  });

  it("pesanan tanpa bagian fisik, belum lunas, atau tidak ada: ditolak", async () => {
    const d = await digitalOnly();
    expect((await track(d.orderId, RESI).expect(409)).body).toMatchObject({ code: "INVALID_TRANSITION" });
    await track("00000000-0000-0000-0000-000000000000", RESI).expect(404);
    await track("bukan-uuid", RESI).expect(404);
    expect(await mails(SHIPPED)).toHaveLength(0);
  });

  it("dua admin mengisi resi yang sama bersamaan: Dikirim sekali, satu email, satu log", async () => {
    const o = await processing();
    const [x, y] = await overlapped(o.orderId, 2, () => Promise.all([track(o.orderId, RESI), track(o.orderId, RESI, api(ctx, adminCookie))]));
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(await audit("order.shipped")).toHaveLength(1);
    expect(await audit("order.tracking_changed")).toHaveLength(0);
    expect(await mails(SHIPPED)).toHaveLength(1);
    expect(await mails(UPDATED)).toHaveLength(0);
  });

  it("antrean email mati: status dan resi tetap tersimpan (F11.4)", async () => {
    const o = await processing();
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await track(o.orderId, RESI).expect(200);
    expect(await order(o.orderId)).toMatchObject({ physical_status: "DIKIRIM", tracking_number: RESI });
  });
});

describe("mengubah resi (F8.5)", () => {
  it("log mencatat nilai lama dan baru, pembeli diemail resi baru, waktu kirim tidak berubah", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    const shippedAt = (await order(o.orderId)).shipped_at;
    ctx.clock.advance(5 * MIN);
    admin = api(ctx, await ctx.adminCookie());
    await track(o.orderId, "SCP9999999999").expect(200);
    expect(await order(o.orderId)).toMatchObject({ physical_status: "DIKIRIM", tracking_number: "SCP9999999999", shipped_at: shippedAt });
    const log = await audit("order.tracking_changed");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: o.orderId, details: { old: RESI, new: "SCP9999999999" } });
    const [m] = await mails(UPDATED);
    expect(m.to).toBe("siti@hayatun.test");
    expect(m.text).toContain("SCP9999999999");
    expect(m.text).toContain(o.invoiceNumber);
    expect(await audit("order.shipped")).toHaveLength(1);
    expect(await mails(SHIPPED)).toHaveLength(1);
  });

  it("nilai yang sama tidak mengubah apa pun: tanpa log dan tanpa email baru", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    await track(o.orderId, ` ${RESI} `).expect(200);
    expect(await audit("order.tracking_changed")).toEqual([]);
    expect(await mails(UPDATED)).toHaveLength(0);
    expect(await mails(SHIPPED)).toHaveLength(1);
  });

  it("resi baru juga harus lolos validasi, dan setelah Diterima tidak bisa diubah", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    expect((await track(o.orderId, "pendek").expect(422)).body.fields.trackingNumber).toBe("Nomor resi minimal 8 karakter.");
    expect((await order(o.orderId)).tracking_number).toBe(RESI);
    await received(o.orderId).expect(200);
    expect((await track(o.orderId, "SCP9999999999").expect(409)).body).toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await order(o.orderId)).tracking_number).toBe(RESI);
  });
});

describe("pesanan diterima oleh pembeli (F8.3)", () => {
  it("Dikirim menjadi Diterima sekali; pesanan tetap Lunas", async () => {
    const o = await processing();
    await received(o.orderId).expect(409); // masih Diproses
    await track(o.orderId, RESI).expect(200);
    expect((await received(o.orderId).expect(200)).body).toEqual({ physicalStatus: "DITERIMA" });
    expect(await order(o.orderId)).toMatchObject({ physical_status: "DITERIMA", status: "LUNAS" });
    expect((await received(o.orderId).expect(409)).body).toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("hanya pemilik: pembeli lain dan admin 404, tanpa masuk 401, id ngawur 404", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    await received(o.orderId, rina).expect(404);
    await received(o.orderId, admin).expect(404);
    await request(ctx.app).post(`/api/orders/${o.orderId}/received`).expect(401);
    await received("bukan-uuid").expect(404);
    expect((await order(o.orderId)).physical_status).toBe("DIKIRIM");
  });

  it("pesanan digital saja ditolak", async () => {
    const d = await digitalOnly();
    await received(d.orderId).expect(409);
  });
});

describe("Diterima otomatis 14 hari sejak dikirim (F8.3)", () => {
  const deps = () => ({ db: ctx.db, now: () => ctx.clock.now });

  it("belum 14 hari tidak berubah; tepat 14 hari menjadi Diterima oleh sistem, tercatat tanpa pelaku", async () => {
    const shipped = await processing(siti, "Nastar");
    await track(shipped.orderId, RESI).expect(200);
    const processingOnly = await processing(rina, "Putri Salju"); // masih Diproses: tidak boleh ikut
    ctx.clock.advance(14 * DAY - MIN);
    expect(await autoReceiveOrders(deps())).toBe(0);
    expect((await order(shipped.orderId)).physical_status).toBe("DIKIRIM");
    ctx.clock.advance(MIN);
    expect(await autoReceiveOrders(deps())).toBe(1);
    expect((await order(shipped.orderId)).physical_status).toBe("DITERIMA");
    expect((await order(processingOnly.orderId)).physical_status).toBe("DIPROSES");
    const log = await audit("order.auto_received");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: null, entity_id: shipped.orderId });
    expect(await autoReceiveOrders(deps())).toBe(0); // tidak diulang
    expect(await audit("order.auto_received")).toHaveLength(1);
  });

  it("14 hari dihitung dari waktu kirim, bukan dari pembayaran", async () => {
    const o = await processing();
    ctx.clock.advance(20 * DAY);
    admin = api(ctx, await ctx.adminCookie());
    await track(o.orderId, RESI).expect(200); // dibayar 20 hari lalu, baru dikirim sekarang
    expect(await autoReceiveOrders(deps())).toBe(0);
    ctx.clock.advance(13 * DAY);
    expect(await autoReceiveOrders(deps())).toBe(0);
    ctx.clock.advance(DAY);
    expect(await autoReceiveOrders(deps())).toBe(1);
  });

  it("dijalankan bersamaan: tepat sekali per pesanan", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    ctx.clock.advance(15 * DAY);
    const counts = await Promise.all([autoReceiveOrders(deps()), autoReceiveOrders(deps()), autoReceiveOrders(deps())]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await audit("order.auto_received")).toHaveLength(1);
  });

  it("ikut tugas sapu per menit yang sudah terjadwal", async () => {
    const o = await processing();
    await track(o.orderId, RESI).expect(200);
    const queue = createMemoryQueue();
    await registerOrderJobs(queue, { ...deps(), queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, storage: ctx.storage });
    ctx.clock.advance(14 * DAY);
    await queue.send("orders.sweep", {});
    await queue.runAll();
    expect((await order(o.orderId)).physical_status).toBe("DITERIMA");
  });
});

describe("templat email pengiriman", () => {
  const link = `${APP_URL}/pesanan/abc`;
  it("subjek tetap, isi ekspedisi dan resi, di-escape, data wajib", () => {
    const s = renderEmail("order_shipped", { name: "Siti", invoiceNumber: "INV/1", courier: "SiCepat REG", trackingNumber: RESI, link });
    expect(s.subject).toBe(SHIPPED);
    expect(s.text).toContain("SiCepat REG");
    expect(s.text).toContain(RESI);
    const u = renderEmail("tracking_updated", { name: "Siti", invoiceNumber: "INV/1", courier: "SiCepat REG", trackingNumber: "<b>X</b>12345", link });
    expect(u.subject).toBe(UPDATED);
    expect(u.html).not.toContain("<b>X</b>");
    for (const t of ["order_shipped", "tracking_updated"] as const) {
      expect(() => renderEmail(t, { name: "Siti", invoiceNumber: "INV/1", link })).toThrow(/courier|trackingNumber/);
      expect(() => renderEmail(t, { name: "Siti", courier: "SiCepat", trackingNumber: RESI, link })).toThrow(/invoiceNumber/);
    }
    expect(s.text + u.text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
