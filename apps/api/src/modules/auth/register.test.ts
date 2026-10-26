import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema.js";
import { APP_URL, createTestContext, linkFrom, tokenFrom, type TestContext } from "../../test/context.js";
import { createSession } from "./sessions.js";

const CHECK_EMAIL = "Cek emailmu ya. Kami kirim tautan untuk verifikasi akun.";
const LINK_DEAD = "Tautannya tidak berlaku lagi. Minta tautan verifikasi baru ya.";
const valid = { name: "Budi", email: "budi@mail.com", password: "rahasia-hayatun-1" };

let ctx: TestContext;
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(() => ctx.close());

const register = (body: object) => ctx.post("/api/auth/register", body);
const verify = (token: string) => ctx.post("/api/auth/verify-email", { token });
const loginCookie = async (userId: string, role: "buyer" | "admin" = "buyer") =>
  `hayatun_sid=${(await createSession(ctx.db, { id: userId, role }, ctx.clock.now)).token}`;
async function verifyToken() {
  const mail = (await ctx.emails()).find((m) => m.subject === "Verifikasi email akun Hayatun-mu")!;
  return tokenFrom(linkFrom(mail.text));
}

describe("POST /api/auth/register (F1.1, F1.2)", () => {
  it("membuat akun pembeli dengan data terenkripsi dan mengirim tautan verifikasi", async () => {
    const res = await register({ ...valid, email: "  Budi@Mail.COM " }).expect(202);
    expect(res.body).toEqual({ message: CHECK_EMAIL });

    const [u] = await ctx.db.select().from(users);
    expect(u).toMatchObject({ role: "buyer", status: "active", emailVerifiedAt: null, totpEnabled: false });
    expect(u.emailEnc).not.toContain("budi");
    expect(ctx.crypto.decrypt(u.emailEnc)).toBe("budi@mail.com");
    expect(ctx.crypto.decrypt(u.nameEnc!)).toBe("Budi");
    expect(u.emailIndex).toBe(ctx.crypto.blindIndex("budi@mail.com"));
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);

    const [mail] = await ctx.emails();
    expect(mail).toMatchObject({ to: "budi@mail.com", subject: "Verifikasi email akun Hayatun-mu" });
    expect(linkFrom(mail.text).startsWith(`${APP_URL}/verifikasi-email?token=`)).toBe(true);
  });

  it("email terdaftar: jawaban sama, tidak ada akun kedua, pemilik email diberi tahu (F1.6)", async () => {
    await register(valid).expect(202);
    await ctx.emails();
    const again = await register({ name: "Orang Lain", email: "BUDI@mail.com", password: "lain-lagi-123" }).expect(202);
    expect(again.body).toEqual({ message: CHECK_EMAIL });
    expect(await ctx.db.$count(users)).toBe(1);
    const sent = await ctx.emails();
    expect(sent.map((m) => m.subject)).toEqual(["Verifikasi email akun Hayatun-mu", "Ada yang mencoba daftar dengan emailmu"]);
  });

  it("waktu jawab email terdaftar tidak jauh lebih cepat (tidak membocorkan keberadaan akun)", async () => {
    let t = Date.now();
    await register(valid).expect(202);
    const fresh = Date.now() - t;
    t = Date.now();
    await register(valid).expect(202);
    expect(Date.now() - t).toBeGreaterThanOrEqual(fresh * 0.5);
  });

  it("menolak password umum (N3)", async () => {
    const res = await register({ ...valid, password: "password123" }).expect(422);
    expect(res.body.fields.password).toBe("Password ini terlalu umum dan gampang ditebak. Pakai yang lebih unik ya.");
    expect(await ctx.db.$count(users)).toBe(0);
  });

  it("menolak input tidak valid dengan pesan per kolom (N10)", async () => {
    const res = await register({ name: "", email: "budi@", password: "1" }).expect(422);
    expect(res.body.fields).toEqual({
      name: "Namanya diisi dulu ya.",
      email: "Format emailnya belum benar, coba cek lagi ya.",
      password: "Password minimal 8 karakter ya.",
    });
  });

  it("password 10.000 karakter ditolak cepat, bukan diproses Argon2", async () => {
    const t = Date.now();
    await register({ ...valid, password: "a".repeat(10_000) }).expect(422);
    expect(Date.now() - t).toBeLessThan(200);
  });

  it("SMTP mati: pendaftaran tetap berhasil", async () => {
    const down = await createTestContext({ mailer: { send: async () => { throw new Error("SMTP mati"); } } });
    try {
      await down.post("/api/auth/register", valid).expect(202);
      expect(await down.db.$count(users)).toBe(1);
    } finally {
      await down.close();
    }
  });
});

describe("POST /api/auth/verify-email (F1.7)", () => {
  it("menandai email terverifikasi", async () => {
    await register(valid).expect(202);
    const res = await verify(await verifyToken()).expect(200);
    expect(res.body).toEqual({ message: "Emailmu sudah terverifikasi. Selamat belanja!" });
    const [u] = await ctx.db.select().from(users);
    expect(u.emailVerifiedAt).toEqual(ctx.clock.now);
  });

  it("klik ganda bersamaan: satu berhasil, satu TOKEN_USED", async () => {
    await register(valid).expect(202);
    const token = await verifyToken();
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)!.body).toEqual({
      code: "TOKEN_USED",
      message: "Tautannya sudah dipakai. Kalau emailmu belum terverifikasi, minta tautan baru ya.",
    });
  });

  it("kedaluwarsa setelah 24 jam; token ngawur tidak berlaku", async () => {
    await register(valid).expect(202);
    const token = await verifyToken();
    ctx.clock.advance(24 * 3600_000 + 1);
    expect((await verify(token).expect(400)).body).toEqual({ code: "TOKEN_EXPIRED", message: LINK_DEAD });
    expect((await verify("ngawur").expect(400)).body).toEqual({ code: "TOKEN_INVALID", message: LINK_DEAD });
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("selalu 202; hanya mengirim ke akun yang belum terverifikasi", async () => {
    await ctx.post("/api/auth/resend-verification", { email: "tidakada@mail.com" }).expect(202, { message: CHECK_EMAIL });
    expect(await ctx.emails()).toHaveLength(0);

    await ctx.createUser({ email: "sudah@mail.com", password: "rahasia-hayatun-1" });
    await ctx.post("/api/auth/resend-verification", { email: "sudah@mail.com" }).expect(202);
    expect(await ctx.emails()).toHaveLength(0);

    await ctx.createUser({ email: "belum@mail.com", password: "rahasia-hayatun-1", verified: false });
    await ctx.post("/api/auth/resend-verification", { email: " Belum@mail.com" }).expect(202);
    const sent = await ctx.emails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "belum@mail.com", subject: "Verifikasi email akun Hayatun-mu" });
    await verify(tokenFrom(linkFrom(sent[0].text))).expect(200);
  });
});

describe("GET /api/auth/me", () => {
  it("tanpa sesi: 401", async () => {
    expect((await ctx.get("/api/auth/me").expect(401)).body.code).toBe("UNAUTHENTICATED");
  });

  it("mengembalikan data terdekripsi tanpa membocorkan kolom rahasia", async () => {
    const id = await ctx.createUser({ email: "budi@mail.com", password: "rahasia-hayatun-1", verified: false });
    const res = await ctx.get("/api/auth/me", await loginCookie(id)).expect(200);
    expect(res.body).toEqual({ id, name: "Budi", email: "budi@mail.com", role: "buyer", emailVerified: false, totpEnabled: false });
  });

  it("berlaku juga untuk admin", async () => {
    const id = await ctx.createUser({ email: "admin@hayatun.my.id", password: "admin-hayatun-2026", role: "admin" });
    expect((await ctx.get("/api/auth/me", await loginCookie(id, "admin")).expect(200)).body.role).toBe("admin");
  });
});

describe("pemeriksaan Origin (N7, CSRF)", () => {
  it("menolak permintaan pengubah data dari situs lain", async () => {
    const res = await register(valid).set("Origin", "https://jahat.example").expect(403);
    expect(res.body).toEqual({ code: "BAD_ORIGIN", message: "Permintaan ditolak karena berasal dari situs lain." });
    expect(await ctx.db.$count(users)).toBe(0);
  });

  it("mengizinkan Origin toko sendiri dan permintaan tanpa Origin", async () => {
    await register(valid).set("Origin", APP_URL).expect(202);
    await register({ ...valid, email: "lain@mail.com" }).expect(202);
  });

  it("GET tidak diperiksa", async () => {
    await ctx.get("/api/health").set("Origin", "https://jahat.example").expect(200);
  });
});

describe("akun nonaktif tidak bisa memakai tautan verifikasi", () => {
  it("token milik akun nonaktif dianggap tidak berlaku", async () => {
    await register(valid).expect(202);
    const token = await verifyToken();
    await ctx.db.update(users).set({ status: "disabled" }).where(eq(users.emailIndex, ctx.crypto.blindIndex("budi@mail.com")));
    expect((await verify(token).expect(400)).body.code).toBe("TOKEN_INVALID");
  });
});
