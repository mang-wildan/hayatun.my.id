import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createLogger } from "../../logger.js";
import { createTestContext, T0, type TestContext } from "../../test/context.js";
import { api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";
import { createStorage } from "../storage/index.js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(3000)]);
const INVALID = { code: "DOWNLOAD_LINK_INVALID", message: "Tautan unduhan sudah tidak berlaku. Buat tautan baru dari akunmu ya." };
const NOT_ALLOWED = { code: "DOWNLOAD_NOT_ALLOWED", message: "Unduhan untuk pesanan ini tidak tersedia." };
const MIN = 60_000;
const PROOF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(200)]);

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: Awaited<ReturnType<typeof buyer>>;
let rina: Awaited<ReturnType<typeof buyer>>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie();
  admin = api(ctx, adminCookie);
  siti = await buyer("siti@hayatun.test");
  rina = await buyer("rina@hayatun.test");
});
afterEach(() => ctx.close());

async function sessionFor(email: string) {
  const id = await ctx.createUser({ email, password: "rahasia-hayatun-1" });
  return `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`;
}
const buyer = async (email: string) => { const cookie = await sessionFor(email); return Object.assign(api(ctx, cookie), { cookie }); };

// produk digital dengan satu file dan satu tautan, dibeli, dibayar, dan sudah Lunas
async function purchased(who: ReturnType<typeof api> = siti) {
  const p = await makeProduct(ctx, adminCookie, { name: "E-book Ramadan", price: 75000 });
  const file = (await admin.upload(`/api/admin/products/${p.id}/files?filename=ebook-ramadan.pdf`, PDF, "application/pdf").expect(201)).body as { id: string };
  const link = (await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Aplikasi web" }).expect(201)).body as { id: string };
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  await who.post("/api/cart/items", { productId: p.id }).expect(201);
  const o = (await who.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
  await who.upload(`/api/orders/${o.orderId}/proof`, PROOF, "application/pdf").expect(201);
  await admin.post(`/api/admin/payments/${o.orderId}/accept`).expect(200);
  return { p, file: file.id, link: link.id, orderId: o.orderId };
}
const request_ = (who: ReturnType<typeof api>, o: { orderId: string }, fileId: string) => who.post(`/api/orders/${o.orderId}/files/${fileId}/download`);
async function tokenUrl(who: ReturnType<typeof api>, o: { orderId: string; file: string }) {
  return (await request_(who, o, o.file).expect(200)).body.url as string;
}
const tokenOf = (url: string) => url.split("/").pop()!;
const setOrder = (id: string, status: string, digital: string) => ctx.db.execute(sql`update orders set status = ${status}, digital_status = ${digital} where id = ${id}`);

describe("daftar file pesanan (F7.2)", () => {
  it("file dan tautan produk yang dibeli, tanpa lokasi penyimpanan atau alamat tautan", async () => {
    const o = await purchased();
    const res = (await siti.get(`/api/orders/${o.orderId}/files`).expect(200)).body;
    expect(res.items).toEqual([{
      name: "E-book Ramadan",
      files: expect.arrayContaining([
        { id: o.file, kind: "file", filename: "ebook-ramadan.pdf", sizeBytes: PDF.length },
        { id: o.link, kind: "link", filename: "Aplikasi web", sizeBytes: null },
      ]),
    }]);
    expect(res.items[0].files).toHaveLength(2);
    expect(JSON.stringify(res)).not.toMatch(/products\/|contoh\.id|storage/);
  });

  it("hanya pemilik, hanya pesanan Lunas yang aksesnya belum dicabut, dan harus masuk", async () => {
    const o = await purchased();
    await rina.get(`/api/orders/${o.orderId}/files`).expect(404);
    await admin.get(`/api/orders/${o.orderId}/files`).expect(404);
    await request(ctx.app).get(`/api/orders/${o.orderId}/files`).expect(401);
    await siti.get("/api/orders/bukan-uuid/files").expect(404);
    for (const [status, digital] of [["MENUNGGU_VERIFIKASI", "MENUNGGU"], ["DIBATALKAN", "DICABUT"], ["DIKEMBALIKAN", "DICABUT"]]) {
      await setOrder(o.orderId, status, digital);
      expect((await siti.get(`/api/orders/${o.orderId}/files`).expect(409)).body).toMatchObject(NOT_ALLOWED);
    }
  });
});

describe("membuat tautan unduh (F7.3)", () => {
  it("memberi URL pribadi yang berlaku 15 menit", async () => {
    const o = await purchased();
    const res = (await request_(siti, o, o.file).expect(200)).body;
    expect(res.url).toMatch(/^\/api\/downloads\/[A-Za-z0-9_.-]{20,}$/);
    expect(new Date(res.expiresAt).getTime()).toBe(ctx.clock.now.getTime() + 15 * MIN);
    expect(ctx.clock.now.getTime()).toBe(T0.getTime());
  });

  it("tautan eksternal diberikan langsung tanpa token (F7.4)", async () => {
    const o = await purchased();
    expect((await request_(siti, o, o.link).expect(200)).body).toEqual({ url: "https://contoh.id/unduh", external: true });
  });

  it("bukan pemilik 404, file bukan dari produk di pesanan 404, belum lunas atau dicabut 409", async () => {
    const o = await purchased();
    const other = await makeProduct(ctx, adminCookie, { name: "Produk Lain" });
    const otherFile = (await admin.upload(`/api/admin/products/${other.id}/files?filename=lain.pdf`, PDF, "application/pdf").expect(201)).body.id as string;
    await request_(rina, o, o.file).expect(404);
    await request_(admin, o, o.file).expect(404);
    await request_(siti, o, otherFile).expect(404);
    await request_(siti, o, "bukan-uuid").expect(404);
    await request(ctx.app).post(`/api/orders/${o.orderId}/files/${o.file}/download`).expect(401);
    await setOrder(o.orderId, "DIBATALKAN", "DICABUT");
    expect((await request_(siti, o, o.file).expect(409)).body).toMatchObject(NOT_ALLOWED);
  });
});

describe("membuka tautan (F7.3, F7.6, N5)", () => {
  it("mengirim isi file persis, sebagai unduhan, tanpa cache dan tanpa sniffing", async () => {
    const o = await purchased();
    const res = await siti.get(await tokenUrl(siti, o)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on("data", (d: Buffer) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.compare(res.body, PDF)).toBe(0);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="ebook-ramadan\.pdf"/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("di produksi dikirim Nginx: X-Accel-Redirect ke lokasi internal dengan badan kosong", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    const behindNginx = createApp({ config: ctx.config, db: ctx.db, logger: ctx.logger, queue: ctx.queue, crypto: ctx.crypto, shipping: ctx.shipping, now: () => ctx.clock.now,
      storage: createStorage({ dir: ctx.config.storage.dir, internalPrefix: "/protected-files" }) });
    const res = await request(behindNginx).get(url).set("Cookie", siti.cookie).expect(200);
    expect(res.headers["x-accel-redirect"]).toMatch(/^\/protected-files\/products\/[0-9a-f-]{36}\.pdf$/);
    expect(res.text ?? "").toBe("");
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("masih berlaku sampai 15 menit, ditolak sesudahnya dan diminta membuat tautan baru", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    ctx.clock.advance(14 * MIN);
    await siti.get(url).expect(200);
    ctx.clock.advance(MIN + 1000);
    expect((await siti.get(url).expect(403)).body).toMatchObject(INVALID);
    await siti.get(await tokenUrl(siti, o)).expect(200); // tautan baru dari akun yang sama bekerja
  });

  it("dipakai akun lain, termasuk admin, ditolak dengan pesan yang sama; tanpa sesi 401", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    expect((await rina.get(url).expect(403)).body).toMatchObject(INVALID);
    expect((await admin.get(url).expect(403)).body).toMatchObject(INVALID);
    await request(ctx.app).get(url).expect(401);
  });

  it("token rusak, dipotong, atau karangan: 403 yang sama, tidak pernah 500", async () => {
    const o = await purchased();
    const token = tokenOf(await tokenUrl(siti, o));
    const [payload, mac] = token.split(".");
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    for (const bad of [`${payload}.${flip(mac)}`, `${flip(payload)}.${mac}`, payload, token.slice(0, 10), "abc", `${mac}.${payload}`, "...", "%00", `${payload}.${mac}.x`]) {
      expect((await siti.get(`/api/downloads/${encodeURIComponent(bad)}`)).status, bad).toBe(403);
    }
  });

  it("akses dicabut setelah tautan dibuat: tautan yang masih berlaku ikut gagal (F7.8)", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    await setOrder(o.orderId, "DIBATALKAN", "DICABUT");
    expect((await siti.get(url).expect(403)).body).toMatchObject(INVALID);
  });

  it("tanpa batas jumlah unduhan, juga untuk pesanan dengan lisensi tertunda (F7.2)", async () => {
    const o = await purchased();
    await setOrder(o.orderId, "LUNAS", "LISENSI_TERTUNDA");
    for (let i = 0; i < 6; i++) await siti.get(await tokenUrl(siti, o)).expect(200);
    await siti.get(await tokenUrl(siti, o)).expect(200); // token yang sama pun boleh dipakai lagi selama berlaku
  });

  it("file hilang dari disk: 404 yang jelas, bukan error server", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    const dir = join(ctx.config.storage.dir, "products");
    for (const f of await readdir(dir)) await rm(join(dir, f));
    expect((await siti.get(url).expect(404)).body).toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("tautan produk lain milik pembeli lain tidak bisa dibuka dengan token orang lain walau akunnya sama-sama pembeli", async () => {
    const o = await purchased(siti);
    const url = await tokenUrl(siti, o);
    const mine = await purchased(rina); // rina membeli produk lain; tokennya tidak membuka file siti dan sebaliknya
    await rina.get(url).expect(403);
    await rina.get(await tokenUrl(rina, mine)).expect(200);
  });
});

describe("token tidak tercatat di log (N30)", () => {
  it("permintaan berhasil, ditolak, tanpa sesi, dan token rusak: log hanya memuat penanda", async () => {
    const o = await purchased();
    const url = await tokenUrl(siti, o);
    const token = tokenOf(url);
    let out = "";
    const logged = createApp({ config: ctx.config, db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, storage: ctx.storage, shipping: ctx.shipping, now: () => ctx.clock.now,
      logger: createLogger({ logLevel: "info" }, new Writable({ write(c, _e, cb) { out += c; cb(); } })) });
    await request(logged).get(url).set("Cookie", siti.cookie).expect(200);
    await request(logged).get(url).set("Cookie", rina.cookie).expect(403);
    await request(logged).get(url).expect(401);
    await request(logged).get(`/api/downloads/${token.slice(0, -3)}xyz`).set("Cookie", siti.cookie).expect(403);
    expect(out).toContain("/api/downloads/[disamarkan]");
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.split(".")[0]);
    expect(out).not.toContain(token.split(".")[1]);
  });
});
