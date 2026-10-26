import { eq } from "drizzle-orm";
import { generateSync } from "otplib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema.js";
import { cookieOf, createTestContext, type TestContext } from "../../test/context.js";

const PW = "rahasia-hayatun-1";
const BAD_TOTP = { code: "BAD_TOTP", message: "Kodenya belum cocok. Coba kode terbaru di aplikasi authenticator-mu." };
const CHALLENGE_DEAD = { code: "CHALLENGE_EXPIRED", message: "Waktunya habis. Silakan masuk lagi dari awal ya." };
const code = (secret: string, at: Date) => generateSync({ secret, epoch: Math.floor(at.getTime() / 1000) });

let ctx: TestContext;
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(() => ctx.close());

const login = (email: string) => ctx.post("/api/auth/login", { email, password: PW });
const loginTotp = (challenge: string, c: string) => ctx.post("/api/auth/login/totp", { challenge, code: c });

// admin baru: login → pasang TOTP lewat challenge → sesi
async function enrollAdmin(email = "admin@hayatun.my.id") {
  await ctx.createUser({ email, password: PW, role: "admin" });
  const { challenge } = (await login(email).expect(200)).body;
  const { secret } = (await ctx.post("/api/auth/totp/setup", { challenge }).expect(200)).body;
  const res = await ctx.post("/api/auth/totp/confirm", { challenge, code: code(secret, ctx.clock.now) }).expect(200);
  return { secret, cookie: cookieOf(res) };
}

describe("admin wajib TOTP (F15.2)", () => {
  it("memasang TOTP lewat challenge, lalu langsung mendapat sesi", async () => {
    await ctx.createUser({ email: "admin@hayatun.my.id", password: PW, role: "admin" });
    const { challenge } = (await login("admin@hayatun.my.id").expect(200)).body;
    const setup = (await ctx.post("/api/auth/totp/setup", { challenge }).expect(200)).body;
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/Hayatun:admin%40hayatun\.my\.id\?secret=[A-Z2-7]+&issuer=Hayatun/);
    expect(setup.secret).toMatch(/^[A-Z2-7]{16,}$/);

    const [u] = await ctx.db.select().from(users).where(eq(users.role, "admin"));
    expect(u.totpEnabled).toBe(false);
    expect(u.totpSecretEnc).not.toContain(setup.secret);
    expect(ctx.crypto.decrypt(u.totpSecretEnc!)).toBe(setup.secret);

    expect((await ctx.post("/api/auth/totp/confirm", { challenge, code: "000000" }).expect(401)).body).toEqual(BAD_TOTP);
    const res = await ctx.post("/api/auth/totp/confirm", { challenge, code: code(setup.secret, ctx.clock.now) }).expect(200);
    expect(res.body).toMatchObject({ next: "done", user: { role: "admin" } });
    const me = (await ctx.get("/api/auth/me", cookieOf(res)).expect(200)).body;
    expect(me.totpEnabled).toBe(true);
  });

  it("login berikutnya wajib kode; kode salah tidak membakar challenge", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const first = await login("admin@hayatun.my.id").expect(200);
    expect(first.body).toEqual({ next: "totp", challenge: expect.any(String) });
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect((await loginTotp(first.body.challenge, "000000").expect(401)).body).toEqual(BAD_TOTP);
    const ok = await loginTotp(first.body.challenge, code(secret, ctx.clock.now)).expect(200);
    expect(ok.body).toMatchObject({ next: "done", user: { role: "admin" } });
    expect(cookieOf(ok)).toMatch(/^hayatun_sid=/);
  });

  it("admin tidak bisa mematikan TOTP", async () => {
    const { secret, cookie } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const res = await ctx.post("/api/auth/totp/disable", { code: code(secret, ctx.clock.now) }, cookie).expect(403);
    expect(res.body).toEqual({ code: "TOTP_REQUIRED", message: "Admin wajib memakai verifikasi dua langkah." });
  });
});

describe("POST /api/auth/login/totp", () => {
  it("challenge habis setelah 5 menit; challenge ngawur ditolak", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const { challenge } = (await login("admin@hayatun.my.id").expect(200)).body;
    ctx.clock.advance(5 * 60_000 + 1);
    expect((await loginTotp(challenge, code(secret, ctx.clock.now)).expect(400)).body).toEqual(CHALLENGE_DEAD);
    expect((await loginTotp("ngawur", code(secret, ctx.clock.now)).expect(400)).body).toEqual(CHALLENGE_DEAD);
  });

  it("challenge hanya bisa dipakai sekali", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const { challenge } = (await login("admin@hayatun.my.id").expect(200)).body;
    await loginTotp(challenge, code(secret, ctx.clock.now)).expect(200);
    ctx.clock.advance(30_000);
    expect((await loginTotp(challenge, code(secret, ctx.clock.now)).expect(400)).body).toEqual(CHALLENGE_DEAD);
  });

  it("kode yang sama tidak bisa dipakai dua kali", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const c = code(secret, ctx.clock.now);
    await loginTotp((await login("admin@hayatun.my.id")).body.challenge, c).expect(200);
    expect((await loginTotp((await login("admin@hayatun.my.id")).body.challenge, c).expect(401)).body).toEqual(BAD_TOTP);
  });

  it("menerima kode dari langkah 30 detik sebelumnya, menolak yang lebih tua", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(5 * 60_000);
    const prev = code(secret, new Date(ctx.clock.now.getTime() - 30_000));
    const old = code(secret, new Date(ctx.clock.now.getTime() - 90_000));
    await loginTotp((await login("admin@hayatun.my.id")).body.challenge, old).expect(401);
    await loginTotp((await login("admin@hayatun.my.id")).body.challenge, prev).expect(200);
  });

  it("5 kode salah mengunci login, termasuk dengan kode benar", async () => {
    const { secret } = await enrollAdmin();
    ctx.clock.advance(60_000);
    const { challenge } = (await login("admin@hayatun.my.id").expect(200)).body;
    for (let i = 0; i < 5; i++) await loginTotp(challenge, "000000").expect(401);
    expect((await loginTotp(challenge, code(secret, ctx.clock.now)).expect(429)).body.code).toBe("LOCKED");
    await login("admin@hayatun.my.id").expect(429);
  });
});

describe("TOTP opsional untuk pembeli (F1.4)", () => {
  async function buyerCookie() {
    await ctx.createUser({ email: "budi@mail.com", password: PW });
    return cookieOf(await login("budi@mail.com").expect(200));
  }

  it("bisa diaktifkan lewat sesi, lalu login meminta kode", async () => {
    const cookie = await buyerCookie();
    expect((await ctx.get("/api/auth/me", cookie)).body.totpEnabled).toBe(false);
    const { secret } = (await ctx.post("/api/auth/totp/setup", {}, cookie).expect(200)).body;
    await ctx.post("/api/auth/totp/confirm", { code: "000000" }, cookie).expect(401);
    const res = await ctx.post("/api/auth/totp/confirm", { code: code(secret, ctx.clock.now) }, cookie).expect(200);
    expect(res.body).toEqual({ message: "Verifikasi dua langkah sudah aktif." });
    expect((await ctx.get("/api/auth/me", cookie)).body.totpEnabled).toBe(true);
    expect((await login("budi@mail.com").expect(200)).body.next).toBe("totp");
  });

  it("tidak bisa memasang ulang saat sudah aktif", async () => {
    const cookie = await buyerCookie();
    const { secret } = (await ctx.post("/api/auth/totp/setup", {}, cookie)).body;
    await ctx.post("/api/auth/totp/confirm", { code: code(secret, ctx.clock.now) }, cookie).expect(200);
    const res = await ctx.post("/api/auth/totp/setup", {}, cookie).expect(409);
    expect(res.body).toEqual({ code: "TOTP_ALREADY_ENABLED", message: "Verifikasi dua langkah sudah aktif." });
  });

  it("bisa dimatikan dengan kode yang benar", async () => {
    const cookie = await buyerCookie();
    const { secret } = (await ctx.post("/api/auth/totp/setup", {}, cookie)).body;
    await ctx.post("/api/auth/totp/confirm", { code: code(secret, ctx.clock.now) }, cookie).expect(200);
    ctx.clock.advance(60_000);
    await ctx.post("/api/auth/totp/disable", { code: "000000" }, cookie).expect(401);
    const res = await ctx.post("/api/auth/totp/disable", { code: code(secret, ctx.clock.now) }, cookie).expect(200);
    expect(res.body).toEqual({ message: "Verifikasi dua langkah sudah dimatikan." });
    expect((await login("budi@mail.com").expect(200)).body.next).toBe("done");
    const [u] = await ctx.db.select().from(users).where(eq(users.role, "buyer"));
    expect(u.totpSecretEnc).toBeNull();
  });

  it("setup tanpa sesi dan tanpa challenge ditolak", async () => {
    expect((await ctx.post("/api/auth/totp/setup", {}).expect(401)).body.code).toBe("UNAUTHENTICATED");
  });
});
