import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, users } from "../db/schema.js";
import { linkFrom, tokenFrom, APP_URL, createTestContext, type TestContext } from "../test/context.js";
import { bootstrapAdmin } from "./bootstrap-admin.js";

const OWNER = "pemilik@hayatun.my.id";
const PW = "admin-hayatun-2026";
const INVITE_SUBJECT = "Undangan jadi admin Hayatun";
const DEAD = { code: "TOKEN_EXPIRED", message: "Undangannya tidak berlaku lagi. Minta undangan baru ya." };

let ctx: TestContext;
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(() => ctx.close());

const deps = (email = OWNER) => ({
  config: { ...ctx.config, adminBootstrapEmail: email },
  db: ctx.db, queue: ctx.queue, crypto: ctx.crypto, now: () => ctx.clock.now,
});
const accept = (body: object) => ctx.post("/api/auth/accept-invite", body);
async function inviteToken() {
  const mail = (await ctx.emails()).filter((m) => m.subject === INVITE_SUBJECT).at(-1)!;
  return tokenFrom(linkFrom(mail.text));
}

describe("bootstrapAdmin (F15.1)", () => {
  it("membuat admin berstatus invited dan mengirim undangan", async () => {
    expect(await bootstrapAdmin(deps())).toBe("invited");
    const [u] = await ctx.db.select().from(users);
    expect(u).toMatchObject({ role: "admin", status: "invited", passwordHash: null, emailVerifiedAt: null, totpEnabled: false });
    expect(u.emailEnc).not.toContain("pemilik");
    expect(ctx.crypto.decrypt(u.emailEnc)).toBe(OWNER);

    const [mail] = await ctx.emails();
    expect(mail).toMatchObject({ to: OWNER, subject: INVITE_SUBJECT });
    expect(linkFrom(mail.text).startsWith(`${APP_URL}/admin/undangan?token=`)).toBe(true);
    expect(mail.text).toContain("berlaku 72 jam");
  });

  it("mencatat di log aktivitas tanpa data pribadi", async () => {
    await bootstrapAdmin(deps());
    const [log] = await ctx.db.select().from(auditLogs);
    expect(log).toMatchObject({ actorId: null, action: "admin.bootstrap", entityType: "user" });
    expect(JSON.stringify(log)).not.toContain("pemilik");
  });

  it("email dinormalisasi (huruf besar dan spasi)", async () => {
    await bootstrapAdmin(deps("  Pemilik@Hayatun.my.id "));
    expect(ctx.crypto.decrypt((await ctx.db.select().from(users))[0].emailEnc)).toBe(OWNER);
  });

  it("ADMIN_BOOTSTRAP_EMAIL kosong: error yang menyebut nama variabelnya", async () => {
    await expect(bootstrapAdmin({ ...deps(), config: { ...ctx.config, adminBootstrapEmail: undefined } })).rejects.toThrow(/ADMIN_BOOTSTRAP_EMAIL/);
    expect(await ctx.db.$count(users)).toBe(0);
  });

  it("sudah ada admin aktif: tidak melakukan apa pun", async () => {
    await ctx.createUser({ email: "lain@hayatun.my.id", password: PW, role: "admin" });
    expect(await bootstrapAdmin(deps())).toBe("admin_exists");
    expect(await ctx.db.$count(users)).toBe(1);
    expect(await ctx.emails()).toHaveLength(0);
  });

  it("dijalankan ulang selagi undangan belum diterima: undangan baru dikirim, tetap satu pengguna", async () => {
    await bootstrapAdmin(deps());
    await ctx.emails();
    expect(await bootstrapAdmin(deps())).toBe("invited");
    expect(await ctx.db.$count(users)).toBe(1);
    expect(await ctx.emails()).toHaveLength(2);
  });
});

describe("POST /api/auth/accept-invite", () => {
  it("menerima undangan: akun aktif, email terverifikasi, lanjut pasang TOTP tanpa sesi", async () => {
    await bootstrapAdmin(deps());
    await ctx.post("/api/auth/login", { email: OWNER, password: PW }).expect(401); // invited belum bisa masuk
    const res = await accept({ token: await inviteToken(), name: "Pemilik", password: PW }).expect(200);
    expect(res.body).toEqual({ next: "totp_setup", challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(res.headers["set-cookie"]).toBeUndefined();

    const [u] = await ctx.db.select().from(users);
    expect(u).toMatchObject({ status: "active", role: "admin", totpEnabled: false });
    expect(u.emailVerifiedAt).toEqual(ctx.clock.now);
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(ctx.crypto.decrypt(u.nameEnc!)).toBe("Pemilik");
    const logs = await ctx.db.select().from(auditLogs).orderBy(auditLogs.id);
    expect(logs.map((l) => l.action)).toEqual(["admin.bootstrap", "admin.invite_accepted"]);
    expect(logs[1].actorId).toBe(u.id);
  });

  it("setelah itu admin bisa masuk, tetapi wajib memasang TOTP (F15.2)", async () => {
    await bootstrapAdmin(deps());
    await accept({ token: await inviteToken(), name: "Pemilik", password: PW }).expect(200);
    const res = await ctx.post("/api/auth/login", { email: OWNER, password: PW }).expect(200);
    expect(res.body.next).toBe("totp_setup");
  });

  it("klik ganda bersamaan: satu berhasil, satu TOKEN_USED", async () => {
    await bootstrapAdmin(deps());
    const token = await inviteToken();
    const results = await Promise.all([accept({ token, name: "Pemilik", password: PW }), accept({ token, name: "Pemilik", password: PW })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)!.body).toEqual({ code: "TOKEN_USED", message: "Undangannya sudah dipakai. Silakan masuk." });
  });

  it("kedaluwarsa setelah 72 jam; token ngawur tidak berlaku", async () => {
    await bootstrapAdmin(deps());
    const token = await inviteToken();
    ctx.clock.advance(72 * 3600_000 + 1);
    expect((await accept({ token, name: "Pemilik", password: PW }).expect(400)).body).toEqual(DEAD);
    expect((await accept({ token: "ngawur", name: "Pemilik", password: PW }).expect(400)).body.code).toBe("TOKEN_INVALID");
  });

  it("validasi: pesan per kolom; password umum ditolak tanpa memakai habis undangan", async () => {
    await bootstrapAdmin(deps());
    const token = await inviteToken();
    expect((await accept({ token, name: "", password: "1" }).expect(422)).body.fields).toEqual({
      name: "Namanya diisi dulu ya.",
      password: "Password minimal 8 karakter ya.",
    });
    expect((await accept({ token, name: "Pemilik", password: "password123" }).expect(422)).body.fields.password)
      .toBe("Password ini terlalu umum dan gampang ditebak. Pakai yang lebih unik ya.");
    await accept({ token, name: "Pemilik", password: PW }).expect(200);
  });

  it("token jenis lain atau milik akun yang bukan invited ditolak", async () => {
    await ctx.createUser({ email: "aktif@hayatun.my.id", password: PW, role: "admin" });
    await ctx.post("/api/auth/forgot-password", { email: "aktif@hayatun.my.id" });
    const reset = tokenFrom(linkFrom((await ctx.emails())[0].text));
    expect((await accept({ token: reset, name: "X", password: PW }).expect(400)).body.code).toBe("TOKEN_INVALID");
  });
});
