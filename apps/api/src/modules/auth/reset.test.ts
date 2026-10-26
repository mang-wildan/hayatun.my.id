import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema.js";
import { APP_URL, cookieOf, createTestContext, linkFrom, tokenFrom, type TestContext } from "../../test/context.js";

const PW = "rahasia-hayatun-1";
const NEW_PW = "baru-sekali-2026";
const FORGOT_MSG = "Kalau emailnya terdaftar, kami sudah kirim tautan untuk atur ulang password.";
const RESET_SUBJECT = "Atur ulang password Hayatun-mu";

let ctx: TestContext;
let userId: string;
beforeEach(async () => {
  ctx = await createTestContext();
  userId = await ctx.createUser({ email: "budi@mail.com", password: PW });
});
afterEach(() => ctx.close());

const forgot = (email: string) => ctx.post("/api/auth/forgot-password", { email });
const reset = (token: string, password: string) => ctx.post("/api/auth/reset-password", { token, password });
const login = (password: string) => ctx.post("/api/auth/login", { email: "budi@mail.com", password });
async function resetToken() {
  await forgot("budi@mail.com").expect(202);
  const mail = (await ctx.emails()).filter((m) => m.subject === RESET_SUBJECT).at(-1)!;
  return tokenFrom(linkFrom(mail.text));
}

describe("POST /api/auth/forgot-password", () => {
  it("email tak dikenal: tetap 202 tanpa email", async () => {
    expect((await forgot("tidakada@mail.com").expect(202)).body).toEqual({ message: FORGOT_MSG });
    expect(await ctx.emails()).toHaveLength(0);
  });

  it("email terdaftar (huruf besar dan spasi diabaikan): tautan reset dikirim", async () => {
    expect((await forgot(" Budi@Mail.com ").expect(202)).body).toEqual({ message: FORGOT_MSG });
    const [mail] = await ctx.emails();
    expect(mail).toMatchObject({ to: "budi@mail.com", subject: RESET_SUBJECT });
    expect(linkFrom(mail.text).startsWith(`${APP_URL}/reset-password?token=`)).toBe(true);
  });

  it("akun nonaktif tidak dikirimi tautan", async () => {
    await ctx.db.update(users).set({ status: "disabled" }).where(eq(users.id, userId));
    await forgot("budi@mail.com").expect(202);
    expect(await ctx.emails()).toHaveLength(0);
  });
});

describe("POST /api/auth/reset-password (F1.3, F1.7)", () => {
  it("mengganti password dan mencabut semua sesi lama", async () => {
    const oldCookie = cookieOf(await login(PW).expect(200));
    const res = await reset(await resetToken(), NEW_PW).expect(200);
    expect(res.body).toEqual({ message: "Password-mu sudah diganti. Silakan masuk lagi ya." });
    await ctx.get("/api/auth/me", oldCookie).expect(401);
    await login(PW).expect(401);
    await login(NEW_PW).expect(200);
  });

  it("klik ganda bersamaan: satu berhasil, satu TOKEN_USED", async () => {
    const token = await resetToken();
    const results = await Promise.all([reset(token, NEW_PW), reset(token, "lain-lagi-2026")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)!.body.code).toBe("TOKEN_USED");
  });

  it("kedaluwarsa setelah 60 menit", async () => {
    const token = await resetToken();
    ctx.clock.advance(60 * 60_000 + 1);
    expect((await reset(token, NEW_PW).expect(400)).body).toEqual({
      code: "TOKEN_EXPIRED",
      message: "Tautannya tidak berlaku lagi. Minta tautan atur ulang password yang baru ya.",
    });
    await login(PW).expect(200);
  });

  it("menolak password umum tanpa memakai habis tautannya", async () => {
    const token = await resetToken();
    const res = await reset(token, "password1").expect(422);
    expect(res.body.fields.password).toBe("Password ini terlalu umum dan gampang ditebak. Pakai yang lebih unik ya.");
    await reset(token, NEW_PW).expect(200);
  });

  it("tautan reset lain yang masih aktif ikut dibatalkan", async () => {
    const first = await resetToken();
    const second = await resetToken();
    await reset(second, NEW_PW).expect(200);
    expect((await reset(first, "lain-lagi-2026").expect(400)).body.code).toBe("TOKEN_USED");
  });

  it("menandai email terverifikasi bila belum", async () => {
    await ctx.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    await reset(await resetToken(), NEW_PW).expect(200);
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u.emailVerifiedAt).toEqual(ctx.clock.now);
  });

  it("membuka penguncian login", async () => {
    for (let i = 0; i < 5; i++) await login("salah-salah-1").expect(401);
    await login(PW).expect(429);
    await reset(await resetToken(), NEW_PW).expect(200);
    await login(NEW_PW).expect(200);
  });
});
