import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { api, makeProduct } from "../../test/products.js";
import { createSession } from "../auth/sessions.js";

const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const NEW_BANK = { bank: "Mandiri", number: "9876543210", holder: "Hayatun Jaya" };
const SUBJECT = "Rekening tujuan transfer diubah";

let ctx: TestContext;
let adminCookie: string;
let admin: ReturnType<typeof api>;
let siti: ReturnType<typeof api>;
beforeEach(async () => {
  ctx = await createTestContext();
  adminCookie = await ctx.adminCookie(); // "admin 1", admin1@hayatun.test
  admin = api(ctx, adminCookie);
  await ctx.createUser({ email: "admin-dua@hayatun.test", password: "rahasia-hayatun-1", role: "admin", name: "Dewi" });
  await ctx.createUser({ email: "admin-mati@hayatun.test", password: "rahasia-hayatun-1", role: "admin", status: "disabled" });
  await ctx.createUser({ email: "admin-undangan@hayatun.test", role: "admin", status: "invited" });
  const id = await ctx.createUser({ email: "siti@hayatun.test", password: "rahasia-hayatun-1", name: "Siti Aminah" });
  siti = api(ctx, `hayatun_sid=${(await createSession(ctx.db, { id, role: "buyer" }, ctx.clock.now)).token}`);
});
afterEach(() => ctx.close());

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const audit = async (action: string) => rows<{ actor_id: string; entity_id: string; details: Record<string, string> }>(sql`select actor_id, entity_id, details from audit_logs where action = ${action} order by id`);
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);
const put = (path: string, body: object, cookie = adminCookie) => request(ctx.app).put(path).set("Cookie", cookie).send(body);
const putStore = (body: object, cookie?: string) => put("/api/admin/settings/store", body, cookie);
const putBank = (body: object, cookie?: string) => put("/api/admin/settings/bank-account", body, cookie);
const get = (who = admin) => who.get("/api/admin/settings");
const fieldsOf = async (res: Promise<{ body: { fields: Record<string, string> } }>) => (await res).body.fields;

describe("membaca pengaturan", () => {
  it("bawaan: nama Hayatun dan email pengirim, tanpa telepon dan tanpa rekening", async () => {
    expect((await get().expect(200)).body).toEqual({ store: { name: "Hayatun", email: "toko@hayatun.my.id", phone: null }, bankAccount: null });
  });

  it("hanya admin: pembeli 403, tanpa masuk 401, untuk semua rute", async () => {
    const buyerCookie = `hayatun_sid=${(await createSession(ctx.db, { id: (await rows<{ id: string }>(sql`select id from users where role = 'buyer' limit 1`))[0].id, role: "buyer" }, ctx.clock.now)).token}`;
    for (const [method, path] of [["get", "/api/admin/settings"], ["put", "/api/admin/settings/store"], ["put", "/api/admin/settings/bank-account"]] as const) {
      await request(ctx.app)[method](path).set("Cookie", buyerCookie).send({}).expect(403);
      await request(ctx.app)[method](path).send({}).expect(401);
    }
  });
});

describe("informasi toko (F13.3)", () => {
  it("menyimpan nama, email, dan telepon yang dinormalkan, lalu terbaca ulang dan tampil di halaman publik", async () => {
    const res = (await putStore({ name: "  Toko Uji  ", email: "  Halo@TokoUji.id ", phone: "0812-0000-0000" }).expect(200)).body;
    expect(res).toEqual({ name: "Toko Uji", email: "halo@tokouji.id", phone: "+6281200000000" });
    expect((await get().expect(200)).body.store).toEqual(res);
    expect((await request(ctx.app).get("/api/store").expect(200)).body).toEqual({ name: "Toko Uji", email: "halo@tokouji.id", phone: "+6281200000000" });
  });

  it("email dan telepon boleh dikosongkan; nama wajib", async () => {
    await putStore({ name: "Toko Uji", email: "halo@tokouji.id", phone: "081200000000" }).expect(200);
    const res = (await putStore({ name: "Toko Uji", email: "", phone: "" }).expect(200)).body;
    expect(res).toEqual({ name: "Toko Uji", email: null, phone: null });
    expect((await request(ctx.app).get("/api/store").expect(200)).body).toEqual({ name: "Toko Uji" });
  });

  it("kolom tidak sah ditolak dengan pesan per kolom, tanpa mengubah apa pun", async () => {
    await putStore({ name: "Toko Uji" }).expect(200);
    const bad: [object, string, string][] = [
      [{ name: "" }, "name", "Nama toko diisi dulu ya."], [{ name: "   " }, "name", "Nama toko diisi dulu ya."], [{}, "name", "Nama toko diisi dulu ya."],
      [{ name: 5 }, "name", "Nama toko diisi dulu ya."], [{ name: "a".repeat(81) }, "name", "Nama toko maksimal 80 karakter."],
      [{ name: "Toko", email: "bukan-email" }, "email", "Format email belum benar."], [{ name: "Toko", email: `${"a".repeat(120)}@x.id` }, "email", "Email maksimal 120 karakter."],
      [{ name: "Toko", phone: "12345" }, "phone", "Format nomor HP belum benar. Contoh: 081234567890."],
    ];
    for (const [body, field, message] of bad) expect((await fieldsOf(putStore(body).expect(422)))[field], JSON.stringify(body)).toBe(message);
    expect((await get().expect(200)).body.store.name).toBe("Toko Uji");
    expect(await audit("settings.store_changed")).toHaveLength(1);
  });

  it("log mencatat nilai lama dan baru; nilai yang sama tidak mencatat apa pun dan tidak ada email", async () => {
    await putStore({ name: "Toko Uji", email: "halo@tokouji.id" }).expect(200);
    await putStore({ name: "Toko Baru", email: "halo@tokouji.id" }).expect(200);
    await putStore({ name: " Toko Baru ", email: "HALO@tokouji.id" }).expect(200); // sama setelah dinormalkan
    const log = await audit("settings.store_changed");
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ entity_id: "store", details: { oldName: "Toko Uji", newName: "Toko Baru" } });
    expect(log[1].actor_id).toBeTruthy();
    expect((await ctx.emails()).filter((m) => m.subject === SUBJECT)).toHaveLength(0); // perubahan info toko tidak mengirim email
  });
});

describe("rekening tujuan transfer (F13.3, F15.7)", () => {
  it("menyimpan rekening (spasi dan tanda hubung pada nomor dibuang), terbaca ulang, dan dipakai halaman bayar pembeli", async () => {
    const res = (await putBank({ bank: " BCA ", number: "1234 5678-90", holder: " Hayatun Toko " }).expect(200)).body;
    expect(res).toEqual(BANK);
    expect((await get().expect(200)).body.bankAccount).toEqual(BANK);
    const p = await makeProduct(ctx, adminCookie, { name: "E-book", price: 75000 });
    await admin.post(`/api/admin/products/${p.id}/links`, { url: "https://contoh.id/unduh", label: "Unduh" }).expect(201);
    await admin.post(`/api/admin/products/${p.id}/activate`).expect(200);
    await siti.post("/api/cart/items", { productId: p.id }).expect(201);
    const o = (await siti.post("/api/checkout", { expectedTotal: 75000 }).expect(201)).body as { orderId: string };
    expect((await siti.get(`/api/orders/${o.orderId}/payment`).expect(200)).body.bankAccount).toEqual(BANK);
    const order = (await ctx.emails()).find((m) => m.subject === "Pesananmu sudah dibuat, tinggal bayar")!;
    expect(order.text).toContain("1234567890");
    await putBank(NEW_BANK).expect(200);
    expect((await siti.get(`/api/orders/${o.orderId}/payment`).expect(200)).body.bankAccount).toEqual(NEW_BANK); // pesanan lama pun menampilkan yang terbaru
  });

  it("kolom tidak sah ditolak dengan pesan per kolom; rekening tidak bisa dikosongkan", async () => {
    await putBank(BANK).expect(200);
    const bad: [object, string, string][] = [
      [{ ...BANK, bank: "" }, "bank", "Nama bank diisi dulu ya."], [{ ...BANK, bank: "B" }, "bank", "Nama bank terlalu pendek."], [{ ...BANK, bank: "a".repeat(41) }, "bank", "Nama bank maksimal 40 karakter."],
      [{ ...BANK, number: "" }, "number", "Nomor rekening diisi dulu ya."], [{ ...BANK, number: "12ab5678" }, "number", "Nomor rekening hanya boleh berisi angka."],
      [{ ...BANK, number: "12345" }, "number", "Nomor rekening harus 6 sampai 25 angka."], [{ ...BANK, number: "1".repeat(26) }, "number", "Nomor rekening harus 6 sampai 25 angka."],
      [{ ...BANK, holder: "" }, "holder", "Atas nama diisi dulu ya."], [{ ...BANK, holder: "H" }, "holder", "Atas nama terlalu pendek."], [{ ...BANK, holder: "a".repeat(81) }, "holder", "Atas nama maksimal 80 karakter."],
      [{}, "bank", "Nama bank diisi dulu ya."], [{ bank: null, number: null, holder: null }, "holder", "Atas nama diisi dulu ya."],
    ];
    for (const [body, field, message] of bad) expect((await fieldsOf(putBank(body).expect(422)))[field], JSON.stringify(body)).toBe(message);
    expect((await get().expect(200)).body.bankAccount).toEqual(BANK);
    expect(await audit("settings.bank_account_changed")).toHaveLength(1);
    expect(await mails(SUBJECT)).toHaveLength(2); // hanya dari penyimpanan pertama (dua admin aktif)
  });

  it("diubah: semua admin aktif diemail (termasuk yang mengubah), tidak ke admin nonaktif, undangan, atau pembeli; isi lama dan baru", async () => {
    await putBank(BANK).expect(200);
    const before = (await ctx.emails()).length; // email penyimpanan pertama tidak dihitung
    await putBank(NEW_BANK).expect(200);
    const sent = (await ctx.emails()).slice(before).filter((m) => m.subject === SUBJECT);
    expect(sent.map((m) => m.to).sort()).toEqual(["admin-dua@hayatun.test", "admin1@hayatun.test"]);
    for (const m of sent) {
      expect(m.text).toContain("admin 1"); // yang mengubah
      expect(m.text).toContain("26 Okt 2026, 14.00 WIB");
      for (const t of ["BCA", "1234567890", "Hayatun Toko", "Mandiri", "9876543210", "Hayatun Jaya"]) expect(m.text, t).toContain(t);
      expect(m.text).toContain(`${APP_URL}/admin/pengaturan`);
      expect(m.text + m.html).not.toMatch(/Siti|siti@/);
    }
    expect(sent.find((m) => m.to === "admin-dua@hayatun.test")!.text).toContain("Halo Dewi");
  });

  it("pertama kali diatur: email menyebut sebelumnya belum diatur", async () => {
    await putBank(BANK).expect(200);
    const [m] = (await ctx.emails()).filter((x) => x.subject === SUBJECT && x.to === "admin-dua@hayatun.test");
    expect(m.text).toContain("belum diatur");
    expect(m.text).toContain("1234567890");
  });

  it("log mencatat nilai lama dan baru; nilai yang sama tidak mencatat dan tidak mengirim email", async () => {
    await putBank(BANK).expect(200);
    await putBank(NEW_BANK).expect(200);
    const emailsBefore = (await mails(SUBJECT)).length;
    await putBank({ bank: " Mandiri ", number: "9876 5432 10", holder: "Hayatun Jaya" }).expect(200);
    const log = await audit("settings.bank_account_changed");
    expect(log).toHaveLength(2);
    expect(log[0].details).toMatchObject({ oldBank: "", oldNumber: "", newBank: "BCA", newNumber: "1234567890", newHolder: "Hayatun Toko" });
    expect(log[1]).toMatchObject({ entity_id: "bankAccount", details: { oldBank: "BCA", oldNumber: "1234567890", oldHolder: "Hayatun Toko", newBank: "Mandiri", newNumber: "9876543210", newHolder: "Hayatun Jaya" } });
    expect((await mails(SUBJECT)).length).toBe(emailsBefore);
  });

  it("antrean email mati: rekening tetap tersimpan (F11.4)", async () => {
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await putBank(BANK).expect(200);
    expect((await get().expect(200)).body.bankAccount).toEqual(BANK);
  });

  it("dua admin menyimpan bersamaan: tersimpan satu nilai utuh, dan nilai lama di log nyambung", async () => {
    await putBank(BANK).expect(200);
    const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await client.connect();
    let results: { status: number }[];
    try {
      await client.query("begin");
      await client.query("select key from store_settings where key = 'bankAccount' for update");
      const running = Promise.all([putBank(NEW_BANK), putBank({ bank: "BNI", number: "5555555555", holder: "Hayatun Dua" })]);
      for (let i = 0; i < 150; i++) {
        const { rows: waits } = await client.query<{ n: number }>("select count(distinct pid)::int as n from pg_locks where not granted");
        if (waits[0].n >= 2) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await client.query("commit");
      results = await running;
    } finally {
      await client.end();
    }
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const log = await audit("settings.bank_account_changed");
    expect(log).toHaveLength(3);
    const [, a, b] = log;
    const stored = (await get().expect(200)).body.bankAccount;
    const last = [a, b].find((l) => l.details.newNumber === stored.number)!;
    const first = [a, b].find((l) => l !== last)!;
    expect(first.details.oldNumber).toBe("1234567890");
    expect(last.details.oldNumber).toBe(first.details.newNumber); // tidak ada dua perubahan yang sama-sama mengira "lama" adalah rekening awal
  });

  it("rekening yang rusak di database tetap dibaca sebagai belum diatur (aturan lama)", async () => {
    await ctx.db.execute(sql`insert into store_settings (key, value) values ('bankAccount', '{"bank":"BCA","number":"","holder":"X"}'::jsonb)`);
    expect((await get().expect(200)).body.bankAccount).toBeNull();
    await putBank(BANK).expect(200);
    expect((await get().expect(200)).body.bankAccount).toEqual(BANK);
  });
});

describe("templat email perubahan rekening", () => {
  it("subjek tetap; di-escape; data wajib", async () => {
    const { renderEmail } = await import("../notifications/templates.js");
    const data = { name: "Dewi", changedBy: "<b>Admin</b>", changedAt: "26 Okt 2026, 14.00 WIB", oldBank: BANK, bank: NEW_BANK, link: `${APP_URL}/admin/pengaturan` };
    const e = renderEmail("bank_account_changed", data);
    expect(e.subject).toBe(SUBJECT);
    expect(e.html).not.toContain("<b>Admin</b>");
    expect(e.text + e.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(() => renderEmail("bank_account_changed", { ...data, bank: undefined })).toThrow(/bank/);
    expect(() => renderEmail("bank_account_changed", { ...data, changedBy: undefined })).toThrow(/changedBy/);
  });
});
