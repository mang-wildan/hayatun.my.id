import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, createTestContext, type TestContext } from "../../test/context.js";
import { createSession } from "../auth/sessions.js";
import { renderEmail } from "../notifications/templates.js";

const PASSWORD = "rahasia-hayatun-1";
const INVITE = "Undangan jadi admin Hayatun";
const ADDED = "Admin baru ditambahkan";
const DISABLED = "Admin dinonaktifkan";
const TOTP_OFF = "Verifikasi dua langkahmu dimatikan oleh toko";
const SECRET = "JBSWY3DPEHPK3PXP";

let ctx: TestContext;
let aCookie: string; // admin 1, admin1@hayatun.test
let bCookie: string; // admin 2
let buyerId: string;
beforeEach(async () => {
  ctx = await createTestContext();
  aCookie = await ctx.adminCookie();
  bCookie = await ctx.adminCookie();
  await ctx.createUser({ email: "admin-undangan@hayatun.test", role: "admin", status: "invited" });
  await ctx.db.execute(sql`update users set name_enc = null where email_index = ${ctx.crypto.blindIndex("admin-undangan@hayatun.test")}`); // undangan sungguhan belum punya nama
  buyerId = await ctx.createUser({ email: "siti@hayatun.test", password: PASSWORD, name: "Siti Aminah", totpSecret: SECRET });
});
afterEach(() => ctx.close());

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as T[];
const audit = async (action: string) => rows<{ actor_id: string; entity_id: string; details: Record<string, unknown> }>(sql`select actor_id, entity_id, details from audit_logs where action = ${action} order by id`);
const mails = async (subject: string) => (await ctx.emails()).filter((m) => m.subject === subject);
const status = async (email: string) => (await rows<{ status: string }>(sql`select status from users where email_index = ${ctx.crypto.blindIndex(email)}`))[0]?.status;
const send = (method: "get" | "post", path: string, cookie?: string, body: object = {}) => {
  const r = request(ctx.app)[method](path);
  if (cookie) r.set("Cookie", cookie);
  return method === "get" ? r : r.send(body);
};
const invite = (email: unknown, cookie = aCookie) => send("post", "/api/admin/admins", cookie, { email });
const adminId = async (email: string) => (await rows<{ id: string }>(sql`select id from users where email_index = ${ctx.crypto.blindIndex(email)}`))[0].id;
const disable = (id: string, cookie = aCookie) => send("post", `/api/admin/admins/${id}/disable`, cookie);
const buyerCookie = async () => `hayatun_sid=${(await createSession(ctx.db, { id: buyerId, role: "buyer" }, ctx.clock.now)).token}`;
const tokenFrom = (text: string) => new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

describe("daftar admin", () => {
  it("nama, email, dan status tiap admin, yang paling lama dulu", async () => {
    const res = (await send("get", "/api/admin/admins", aCookie).expect(200)).body.admins;
    expect(res.map((a: { email: string }) => a.email)).toEqual(["admin1@hayatun.test", "admin2@hayatun.test", "admin-undangan@hayatun.test"]);
    expect(res[0]).toEqual({ id: expect.any(String), name: "admin 1", email: "admin1@hayatun.test", status: "active", createdAt: expect.any(String) });
    expect(res[2]).toMatchObject({ name: null, status: "invited" });
    expect(JSON.stringify(res)).not.toMatch(/siti@/); // pembeli tidak ikut
  });

  it("hanya admin: pembeli 403, tanpa masuk 401, untuk semua rute", async () => {
    const buyer = await buyerCookie();
    const routes: ["get" | "post", string][] = [["get", "/api/admin/admins"], ["post", "/api/admin/admins"], ["post", `/api/admin/admins/${buyerId}/disable`], ["post", "/api/admin/users/lookup"], ["post", `/api/admin/users/${buyerId}/totp/disable`]];
    for (const [m, p] of routes) {
      await send(m, p, buyer).expect(403);
      await send(m, p).expect(401);
    }
  });
});

describe("mengundang admin (F15.1)", () => {
  it("membuat admin berstatus Diundang, email undangan terkirim, dan undangan bisa diterima sampai jadi aktif", async () => {
    const res = (await invite("Baru@Hayatun.test").expect(201)).body;
    expect(res).toEqual({ id: expect.any(String), status: "invited" });
    expect(await status("baru@hayatun.test")).toBe("invited");
    const [m] = await mails(INVITE).then((all) => all.filter((x) => x.to === "baru@hayatun.test"));
    expect(m.text).toContain(`${APP_URL}/admin/undangan?token=`);
    const accepted = await request(ctx.app).post("/api/auth/accept-invite").send({ token: tokenFrom(m.text), name: "Admin Baru", password: PASSWORD }).expect(200);
    expect(accepted.body.next).toBe("totp_setup");
    expect(await status("baru@hayatun.test")).toBe("active");
  });

  it("log mencatat siapa mengundang, dan semua admin aktif dikabari (bukan yang diundang)", async () => {
    await invite("baru@hayatun.test").expect(201);
    const log = await audit("admin.invited");
    expect(log).toHaveLength(1);
    expect(log[0].actor_id).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain("baru@hayatun.test");
    const sent = await mails(ADDED);
    expect(sent.map((m) => m.to).sort()).toEqual(["admin1@hayatun.test", "admin2@hayatun.test"]);
    for (const m of sent) {
      expect(m.text).toContain("baru@hayatun.test");
      expect(m.text).toContain("admin 1");
      expect(m.text).toContain("26 Okt 2026, 14.00 WIB");
    }
  });

  it("email salah ditolak per kolom; admin aktif dan akun pembeli ditolak 409", async () => {
    expect((await invite("").expect(422)).body.fields.email).toBe("Email diisi dulu ya.");
    expect((await invite(undefined).expect(422)).body.fields.email).toBe("Email diisi dulu ya.");
    expect((await invite("bukan-email").expect(422)).body.fields.email).toBe("Format email belum benar.");
    expect((await invite("admin2@hayatun.test").expect(409)).body).toMatchObject({ code: "ADMIN_EXISTS", message: "Email ini sudah menjadi admin aktif." });
    expect((await invite("siti@hayatun.test").expect(409)).body).toMatchObject({ code: "EMAIL_IS_BUYER", message: "Email ini sudah dipakai akun pembeli." });
    expect(await mails(INVITE)).toHaveLength(0);
  });

  it("yang masih Diundang dikirimi ulang dengan token baru, tanpa membuat admin kedua", async () => {
    await invite("admin-undangan@hayatun.test").expect(201);
    await invite("admin-undangan@hayatun.test").expect(201);
    expect(await mails(INVITE)).toHaveLength(2);
    expect(await mails("Admin baru ditambahkan")).toHaveLength(0); // kirim ulang bukan admin baru
    expect((await rows(sql`select 1 from users where email_index = ${ctx.crypto.blindIndex("admin-undangan@hayatun.test")}`))).toHaveLength(1);
  });

  it("antrean email mati: undangan tetap tersimpan (F11.4)", async () => {
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await invite("baru@hayatun.test").expect(201);
    expect(await status("baru@hayatun.test")).toBe("invited");
  });
});

describe("menonaktifkan admin (F15.1, F15.5, F15.6)", () => {
  it("status Dinonaktifkan, sesi dan token tantangan hilang, tidak bisa lagi memakai panel maupun masuk", async () => {
    const b = await adminId("admin2@hayatun.test");
    await ctx.db.execute(sql`insert into auth_tokens (user_id, type, token_hash, expires_at) values (${b}, 'mfa_challenge', 'h', now() + interval '5 minutes')`);
    await send("get", "/api/admin/admins", bCookie).expect(200);
    expect((await disable(b).expect(200)).body).toEqual({ status: "disabled" });
    expect(await status("admin2@hayatun.test")).toBe("disabled");
    await send("get", "/api/admin/admins", bCookie).expect(401); // seketika, jauh di bawah 1 menit
    expect(await rows(sql`select 1 from sessions where user_id = ${b}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from auth_tokens where user_id = ${b}`)).toHaveLength(0);
    await request(ctx.app).post("/api/auth/login").send({ email: "admin2@hayatun.test", password: PASSWORD }).expect(401);
  });

  it("log mencatat siapa dan siapa; semua admin aktif yang tersisa dikabari, bukan yang dinonaktifkan", async () => {
    const b = await adminId("admin2@hayatun.test");
    await disable(b).expect(200);
    const log = await audit("admin.disabled");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: b });
    expect(JSON.stringify(log)).not.toContain("admin2@hayatun.test");
    const sent = await mails(DISABLED);
    expect(sent.map((m) => m.to)).toEqual(["admin1@hayatun.test"]);
    expect(sent[0].text).toContain("admin 2");
    expect(sent[0].text).toContain("admin 1");
  });

  it("admin yang masih Diundang bisa dibatalkan undangannya; yang sudah Dinonaktifkan 409; tidak ada 404", async () => {
    const inv = await adminId("admin-undangan@hayatun.test");
    await disable(inv).expect(200);
    expect(await status("admin-undangan@hayatun.test")).toBe("disabled");
    expect((await disable(inv).expect(409)).body).toMatchObject({ code: "ADMIN_NOT_ACTIVE" });
    await disable("00000000-0000-0000-0000-000000000000").expect(404);
    await disable("bukan-uuid").expect(404);
    await disable(buyerId).expect(404); // pembeli bukan admin
  });

  it("admin terakhir yang aktif tidak bisa dinonaktifkan, juga oleh dirinya sendiri", async () => {
    const a = await adminId("admin1@hayatun.test");
    const b = await adminId("admin2@hayatun.test");
    await disable(b).expect(200);
    expect((await disable(a).expect(409)).body).toMatchObject({ code: "LAST_ADMIN", message: "Admin terakhir tidak bisa dinonaktifkan." });
    expect(await status("admin1@hayatun.test")).toBe("active");
    await send("get", "/api/admin/admins", aCookie).expect(200); // sesinya tetap hidup
    expect(await audit("admin.disabled")).toHaveLength(1);
  });

  it("boleh menonaktifkan diri sendiri bila masih ada admin aktif lain; sesinya ikut berakhir", async () => {
    const a = await adminId("admin1@hayatun.test");
    await disable(a).expect(200);
    await send("get", "/api/admin/admins", aCookie).expect(401);
    await send("get", "/api/admin/admins", bCookie).expect(200);
  });

  it("dua admin saling menonaktifkan bersamaan: tetap tersisa satu admin aktif", async () => {
    const a = await adminId("admin1@hayatun.test");
    const b = await adminId("admin2@hayatun.test");
    const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await client.connect();
    let results: { status: number }[];
    try {
      await client.query("begin");
      await client.query("select id from users where id = $1 for update", [a]);
      const running = Promise.all([disable(b, aCookie), disable(a, bCookie)]);
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
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await rows<{ id: string }>(sql`select id from users where role = 'admin' and status = 'active'`);
    expect(active).toHaveLength(1);
    expect(await audit("admin.disabled")).toHaveLength(1);
  });

  it("diundang ulang: admin yang dinonaktifkan kembali Diundang dan harus membuat password dan TOTP baru", async () => {
    const b = await adminId("admin2@hayatun.test");
    await ctx.db.execute(sql`update users set totp_secret_enc = ${ctx.crypto.encrypt(SECRET)}, totp_enabled = true where id = ${b}`);
    await disable(b).expect(200);
    await invite("admin2@hayatun.test").expect(201);
    const u = (await rows<Record<string, unknown>>(sql`select status, password_hash, totp_enabled, totp_secret_enc from users where id = ${b}`))[0];
    expect(u).toMatchObject({ status: "invited", password_hash: null, totp_enabled: false, totp_secret_enc: null });
    await request(ctx.app).post("/api/auth/login").send({ email: "admin2@hayatun.test", password: PASSWORD }).expect(401); // password lama tidak berlaku
    const m = (await mails(INVITE)).find((x) => x.to === "admin2@hayatun.test")!;
    await request(ctx.app).post("/api/auth/accept-invite").send({ token: tokenFrom(m.text), name: "Dewi", password: "rahasia-baru-2026" }).expect(200);
    expect(await status("admin2@hayatun.test")).toBe("active");
  });
});

describe("membantu pembeli yang kehilangan HP (F15.1)", () => {
  const lookup = (email: unknown, cookie = aCookie) => send("post", "/api/admin/users/lookup", cookie, { email });
  const reset = (id: string, cookie = aCookie) => send("post", `/api/admin/users/${id}/totp/disable`, cookie);

  it("cari pembeli dengan email persis (tanpa membedakan huruf), dicatat sebagai pembukaan data pribadi", async () => {
    const res = (await lookup(" SITI@hayatun.test ").expect(200)).body;
    expect(res).toEqual({ id: buyerId, name: "Siti Aminah", status: "active", totpEnabled: true });
    const log = await audit("user.viewed");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: buyerId });
    expect(log[0].actor_id).toBeTruthy();
    expect(JSON.stringify(log)).not.toMatch(/Siti|siti@/);
  });

  it("tidak ketemu, email admin, atau kosong: jawaban sama dan tidak dicatat; tidak ada daftar pembeli", async () => {
    expect((await lookup("tidak-ada@hayatun.test").expect(404)).body).toMatchObject({ code: "USER_NOT_FOUND", message: "Akun pembeli dengan email itu tidak ditemukan." });
    expect((await lookup("admin2@hayatun.test").expect(404)).body.code).toBe("USER_NOT_FOUND");
    expect((await lookup("").expect(422)).body.fields.email).toBe("Email diisi dulu ya.");
    expect(await audit("user.viewed")).toEqual([]);
    await send("get", "/api/admin/users", aCookie).expect(404);
  });

  it("mematikan TOTP: kolom dikosongkan, sesi pembeli dicabut, pembeli diemail, dicatat, dan ia bisa masuk dengan password saja", async () => {
    const buyer = await buyerCookie();
    await send("get", "/api/orders", buyer).expect(200);
    expect((await reset(buyerId).expect(200)).body).toEqual({ totpEnabled: false });
    expect((await rows(sql`select totp_enabled, totp_secret_enc, totp_last_step from users where id = ${buyerId}`))[0]).toEqual({ totp_enabled: false, totp_secret_enc: null, totp_last_step: null });
    await send("get", "/api/orders", buyer).expect(401);
    const [m, ...rest] = await mails(TOTP_OFF);
    expect(rest).toEqual([]);
    expect(m.to).toBe("siti@hayatun.test");
    expect(m.text).toContain("bukan kamu");
    const log = await audit("user.totp_disabled");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_id: buyerId });
    expect(JSON.stringify(log)).not.toMatch(/Siti|siti@/);
    const login = await request(ctx.app).post("/api/auth/login").send({ email: "siti@hayatun.test", password: PASSWORD }).expect(200);
    expect(login.body.next).toBe("done");
  });

  it("TOTP belum aktif 409; admin, pembeli lain tidak ada, dan id ngawur 404", async () => {
    const other = await ctx.createUser({ email: "rina@hayatun.test", password: PASSWORD });
    expect((await reset(other).expect(409)).body).toMatchObject({ code: "TOTP_NOT_ENABLED" });
    await reset(await adminId("admin2@hayatun.test")).expect(404); // TOTP admin wajib (F15.2)
    await reset("00000000-0000-0000-0000-000000000000").expect(404);
    await reset("bukan-uuid").expect(404);
    expect(await audit("user.totp_disabled")).toEqual([]);
  });

  it("antrean email mati: TOTP tetap dimatikan (F11.4)", async () => {
    ctx.queue.send = async () => { throw new Error("antrean mati"); };
    await reset(buyerId).expect(200);
    expect((await rows<{ totp_enabled: boolean }>(sql`select totp_enabled from users where id = ${buyerId}`))[0].totp_enabled).toBe(false);
  });
});

describe("templat email admin", () => {
  const link = `${APP_URL}/admin/admin`;
  it("subjek tetap, di-escape, data wajib, tanpa emoji", () => {
    const added = renderEmail("admin_added", { name: "Dewi", changedBy: "<b>Admin</b>", changedAt: "26 Okt 2026, 14.00 WIB", target: "baru@hayatun.test", link });
    const off = renderEmail("admin_disabled", { name: "Dewi", changedBy: "admin 1", changedAt: "26 Okt 2026, 14.00 WIB", target: "admin 2", link });
    const totp = renderEmail("totp_reset_by_admin", { name: "Siti" });
    expect(added.subject).toBe(ADDED);
    expect(off.subject).toBe(DISABLED);
    expect(totp.subject).toBe(TOTP_OFF);
    expect(added.html).not.toContain("<b>Admin</b>");
    expect(totp.text).toContain("bukan kamu");
    for (const e of [added, off, totp]) expect(e.text + e.html).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const t of ["admin_added", "admin_disabled"] as const) {
      expect(() => renderEmail(t, { name: "Dewi", changedAt: "x", target: "y", link })).toThrow(/changedBy/);
      expect(() => renderEmail(t, { name: "Dewi", changedBy: "x", changedAt: "y", link })).toThrow(/target/);
    }
  });
});
