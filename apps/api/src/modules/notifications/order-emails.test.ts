import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { api, makeProduct } from "../../test/products.js";
import { checkLowStock } from "../products/low-stock.js";
import { createSession } from "../auth/sessions.js";
import { sweepOrders } from "../jobs/expiry.js";
import { renderEmail } from "./templates.js";

const CREATED = "Pesananmu sudah dibuat, tinggal bayar";
const NEW_PROOF = "Ada bukti bayar baru";
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(500)]);
const PASSWORD = "rahasia-hayatun-1";
const HOUR = 3600_000;

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>; // pembeli yang dites
let rina: ReturnType<typeof api>; // pembeli lain: datanya tidak boleh muncul di email siapa pun
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie(); // admin1@hayatun.test
  admin = api(ctx, adminCookie);
  await ctx.createUser({ email: "admin-dua@hayatun.test", password: PASSWORD, role: "admin", name: "Dewi" });
  await ctx.createUser({ email: "admin-mati@hayatun.test", password: PASSWORD, role: "admin", status: "disabled" });
  await ctx.createUser({ email: "admin-undangan@hayatun.test", role: "admin", status: "invited" });
  siti = await buyer("siti@hayatun.test", "Siti Aminah");
  rina = await buyer("rina@hayatun.test", "Rina Marlina");
  await setBank(BANK);
});
afterEach(() => ctx.close());

async function buyer(email: string, name: string) {
  const id = await ctx.createUser({ email, password: PASSWORD, name });
  return api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
}
const setBank = (v: object | null) => ctx.db.execute(v ? sql`insert into store_settings (key, value) values ('bankAccount', ${JSON.stringify(v)}::jsonb) on conflict (key) do update set value = excluded.value` : sql`delete from store_settings where key = 'bankAccount'`);
const breakQueue = () => { ctx.queue.send = async () => { throw new Error("antrean mati"); }; };
const status = async (id: string) => ((await ctx.db.execute(sql`select status from orders where id = ${id}`)).rows[0] as { status: string }).status;

async function publish(over: Record<string, unknown> = {}) {
  const p = await makeProduct(ctx, adminCookie, over);
  if ((over.type ?? "digital") === "digital") await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
  await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
  return p;
}
async function checkout(who: ReturnType<typeof api>, price = 75000, over: Record<string, unknown> = {}) {
  const p = await publish({ name: `E-book ${Math.random().toString(36).slice(2, 6)}`, price, ...over });
  await who.post("/api/cart/items", { productId: p.id }).expect(201);
  return (await who.post("/api/checkout", { expectedTotal: price }).expect(201)).body as { orderId: string; invoiceNumber: string; expiresAt: string };
}
const upload = (who: ReturnType<typeof api>, orderId: string) => who.upload(`/api/orders/${orderId}/proof`, PDF, "application/pdf");

describe("email pesanan dibuat ke pembeli (F11.1)", () => {
  it("hanya ke pembeli pemilik pesanan: invoice, total, batas waktu, rekening tujuan, dan tautan ke halaman pesanan", async () => {
    const o = await checkout(siti, 75000);
    const sent = (await ctx.emails()).filter((m) => m.subject === CREATED);
    expect(sent.map((m) => m.to)).toEqual(["siti@hayatun.test"]);
    const text = sent[0].text;
    expect(text).toContain("Halo Siti Aminah");
    expect(text).toContain(o.invoiceNumber);
    expect(text).toContain("Rp75.000");
    expect(text).toMatch(/\d{1,2} \p{L}{3} \d{4}, \d{2}\.\d{2} WIB/u);
    expect(text).toContain("BCA");
    expect(text).toContain("1234567890");
    expect(text).toContain("Hayatun Toko");
    expect(text).toContain(`${APP_URL}/pesanan/${o.orderId}`);
    expect(sent[0].html).toContain(`href="${APP_URL}/pesanan/${o.orderId}"`);
  });

  it("rekening belum diatur: menunjuk ke halaman pesanan, tanpa mengarang rekening", async () => {
    await setBank(null);
    await checkout(siti);
    const [m] = (await ctx.emails()).filter((x) => x.subject === CREATED);
    expect(m.text).toContain("Rekening tujuan ada di halaman pesanan.");
    expect(m.text).not.toMatch(/\d{8,}/);
  });

  it("satu email per checkout, dan tidak ada email ke admin saat pesanan dibuat", async () => {
    await checkout(siti);
    await checkout(rina);
    const all = await ctx.emails();
    expect(all.filter((m) => m.subject === CREATED)).toHaveLength(2);
    expect(all.filter((m) => m.to.startsWith("admin") && m.subject === CREATED)).toHaveLength(0);
  });

  it("antrean email mati: checkout tetap berhasil dan pesanan tersimpan (F11.4)", async () => {
    breakQueue();
    const o = await checkout(siti);
    expect(await status(o.orderId)).toBe("MENUNGGU_PEMBAYARAN");
  });

  it("templat menolak data yang kurang", () => {
    expect(() => renderEmail("order_created", { name: "Siti", link: `${APP_URL}/x` })).toThrow(/invoiceNumber/);
    expect(() => renderEmail("order_created", { name: "Siti", invoiceNumber: "INV/1", link: `${APP_URL}/x` })).toThrow(/total|deadline/);
  });
});

describe("email bukti baru ke admin (F11.2)", () => {
  it("ke semua admin aktif saja, berisi invoice, total, dan tautan periksa; tanpa data pembeli", async () => {
    const o = await checkout(siti, 75000);
    await upload(siti, o.orderId).expect(201);
    const sent = (await ctx.emails()).filter((m) => m.subject === NEW_PROOF);
    expect(sent.map((m) => m.to).sort()).toEqual(["admin-dua@hayatun.test", "admin1@hayatun.test"]);
    for (const m of sent) {
      expect(m.text).toContain(o.invoiceNumber);
      expect(m.text).toContain("Rp75.000");
      expect(m.text).toContain(`${APP_URL}/admin?periksa=${o.orderId}`);
      expect(m.text + m.html).not.toMatch(/Siti|Aminah|siti@|0812|Pajajaran/);
    }
    expect(sent.find((m) => m.to === "admin-dua@hayatun.test")!.text).toContain("Halo Dewi");
  });

  it("unggah ulang setelah ditolak mengirim email lagi; unggahan yang ditolak sistem tidak mengirim apa pun", async () => {
    const o = await checkout(siti);
    await upload(siti, o.orderId).expect(201);
    await admin.post(`/api/admin/payments/${o.orderId}/reject`, { reason: "Nominal kurang" }).expect(200);
    await upload(siti, o.orderId).expect(201);
    expect((await ctx.emails()).filter((m) => m.subject === NEW_PROOF && m.to === "admin1@hayatun.test")).toHaveLength(2);
    await upload(rina, o.orderId).expect(404); // bukan pemiliknya
    await siti.upload(`/api/orders/${o.orderId}/proof`, Buffer.from("<html>"), "text/html").expect(409); // status sudah menunggu verifikasi
    expect((await ctx.emails()).filter((m) => m.subject === NEW_PROOF && m.to === "admin1@hayatun.test")).toHaveLength(2);
  });

  it("antrean email mati: unggahan tetap berhasil dan status berubah (F11.4)", async () => {
    const o = await checkout(siti);
    breakQueue();
    await upload(siti, o.orderId).expect(201);
    expect(await status(o.orderId)).toBe("MENUNGGU_VERIFIKASI");
  });

  it("templat proof_uploaded menolak data yang kurang", () => {
    expect(() => renderEmail("proof_uploaded", { link: `${APP_URL}/x` })).toThrow(/invoiceNumber/);
  });
});

describe("antrean email mati tidak menahan perubahan pesanan (F11.4)", () => {
  it("terima, tolak, kedaluwarsa, dan stok rendah tetap berjalan", async () => {
    const a1 = await checkout(siti);
    const a2 = await checkout(rina);
    await upload(siti, a1.orderId).expect(201);
    await upload(rina, a2.orderId).expect(201);
    breakQueue();
    await admin.post(`/api/admin/payments/${a1.orderId}/accept`).expect(200);
    expect(await status(a1.orderId)).toBe("LUNAS");
    await admin.post(`/api/admin/payments/${a2.orderId}/reject`, { reason: "Nominal kurang" }).expect(200);
    expect(await status(a2.orderId)).toBe("MENUNGGU_PEMBAYARAN");

    ctx.clock.advance(25 * HOUR);
    const deps = { db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now };
    expect((await sweepOrders(deps)).expired).toBe(1);
    expect(await status(a2.orderId)).toBe("KEDALUWARSA");

    const low = await publish({ name: "Aplikasi Kasir", isLicensed: true });
    await admin.post(`/api/admin/products/${low.id}/licenses`, { codes: "K1\nK2" }).expect(200);
    await expect(checkLowStock(deps, low.id)).resolves.toBeUndefined();
  });
});

describe("tanpa data sensitif (F11.3)", () => {
  it("seluruh alur pembeli dan admin: tanpa password, hash, data pembeli lain, lampiran, atau tautan ke file bukti", async () => {
    const mine = await checkout(siti, 75000);
    const theirs = await checkout(rina, 90000);
    await upload(siti, mine.orderId).expect(201);
    await upload(rina, theirs.orderId).expect(201);
    await admin.post(`/api/admin/payments/${mine.orderId}/accept`).expect(200);
    await admin.post(`/api/admin/payments/${theirs.orderId}/reject`, { reason: "Foto tidak terbaca" }).expect(200);
    ctx.clock.advance(60 * HOUR);
    await sweepOrders({ db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, config: ctx.config, logger: ctx.logger, now: () => ctx.clock.now });
    const all = await ctx.emails();
    expect(all.length).toBeGreaterThanOrEqual(6);

    for (const m of all) {
      const body = m.text + m.html;
      expect(Object.keys(m).sort()).toEqual(["html", "subject", "text", "to"]); // tidak ada lampiran
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toMatch(/\$argon2|password_hash|passwordHash/i);
      expect(body).not.toMatch(/\/proof\b|storage_key|data:image|<img/i); // bukti transfer tidak ikut dan tidak ditautkan langsung
    }
    // data pembeli lain: Siti tidak pernah melihat Rina, dan sebaliknya
    for (const m of all.filter((x) => x.to === "siti@hayatun.test")) expect(m.text + m.html).not.toMatch(/Rina|Marlina|rina@|INV.*0002/);
    for (const m of all.filter((x) => x.to === "rina@hayatun.test")) expect(m.text + m.html).not.toMatch(/Siti|Aminah|siti@/);
    // admin tidak diberi nama atau alamat email pembeli
    for (const m of all.filter((x) => x.to.startsWith("admin"))) expect(m.text + m.html).not.toMatch(/Siti|Aminah|Rina|Marlina|@hayatun\.test.*pembeli|siti@|rina@/);
  });
});
