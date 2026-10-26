import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessions } from "../../db/schema.js";
import { cookieOf, createTestContext, type TestContext } from "../../test/context.js";

const MIN = 60_000;
const PW = "rahasia-hayatun-1";
const BAD = { code: "BAD_CREDENTIALS", message: "Email atau password-nya belum cocok." };
const LOCKED = { code: "LOCKED", message: "Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi ya." };
const LOCK_SUBJECT = "Ada percobaan masuk ke akun Hayatun-mu";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
  await ctx.createUser({ email: "budi@mail.com", password: PW });
});
afterEach(() => ctx.close());

const login = (email: string, password: string) => ctx.post("/api/auth/login", { email, password });
async function failTimes(n: number, email = "budi@mail.com", gapMs = 0) {
  for (let i = 0; i < n; i++) {
    await login(email, "salah-salah-1").expect(401);
    if (gapMs) ctx.clock.advance(gapMs);
  }
}

describe("POST /api/auth/login", () => {
  it("pembeli tanpa TOTP: sesi dibuat dan cookie dikirim", async () => {
    const res = await login("  BUDI@mail.com ", PW).expect(200);
    expect(res.body).toMatchObject({ next: "done", user: { email: "budi@mail.com", role: "buyer", name: "Budi" } });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^hayatun_sid=.+/);
    expect((await ctx.get("/api/auth/me", cookie).expect(200)).body.email).toBe("budi@mail.com");
  });

  it("password salah dan email tak dikenal: jawaban sama", async () => {
    expect((await login("budi@mail.com", "salah-salah-1").expect(401)).body).toEqual(BAD);
    expect((await login("tidakada@mail.com", "salah-salah-1").expect(401)).body).toEqual(BAD);
  });

  it.each(["invited", "disabled", "deleted"] as const)("akun %s tidak bisa masuk, jawaban sama", async (status) => {
    await ctx.createUser({ email: `${status}@mail.com`, password: PW, status });
    expect((await login(`${status}@mail.com`, PW).expect(401)).body).toEqual(BAD);
  });

  it("validasi input memakai pesan per kolom", async () => {
    expect((await login("budi@", "").expect(422)).body.fields.email).toBe("Format emailnya belum benar, coba cek lagi ya.");
  });

  it("waktu jawab email tak dikenal tidak jauh lebih cepat dari password salah", async () => {
    let t = Date.now();
    await login("budi@mail.com", "salah-salah-1").expect(401);
    const known = Date.now() - t;
    t = Date.now();
    await login("tidakada@mail.com", "salah-salah-1").expect(401);
    expect(Date.now() - t).toBeGreaterThanOrEqual(known * 0.5);
  });

  it("admin tanpa TOTP: wajib memasang TOTP, belum ada sesi (F15.2)", async () => {
    await ctx.createUser({ email: "admin@hayatun.my.id", password: PW, role: "admin" });
    const res = await login("admin@hayatun.my.id", PW).expect(200);
    expect(res.body).toEqual({ next: "totp_setup", challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it("pengguna dengan TOTP aktif: diminta kode, belum ada sesi (F1.4)", async () => {
    await ctx.createUser({ email: "aman@mail.com", password: PW, totpSecret: "JBSWY3DPEHPK3PXP" });
    const res = await login("aman@mail.com", PW).expect(200);
    expect(res.body).toEqual({ next: "totp", challenge: expect.any(String) });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("penguncian (F1.8)", () => {
  it("5 gagal dalam 15 menit: password benar pun ditolak, email dikirim sekali", async () => {
    await failTimes(5);
    expect((await login("budi@mail.com", PW).expect(429)).body).toEqual(LOCKED);
    await login("budi@mail.com", PW).expect(429);
    const mails = (await ctx.emails()).filter((m) => m.subject === LOCK_SUBJECT);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("budi@mail.com");
  });

  it("terkunci 15 menit sejak kegagalan ke-5, bukan sejak yang pertama", async () => {
    await failTimes(5, "budi@mail.com", MIN); // gagal pada menit 0,1,2,3,4; jam kini di menit 5
    ctx.clock.advance(14 * MIN - 1); // menit 19 kurang 1 ms: masih dalam 15 menit dari menit 4
    await login("budi@mail.com", PW).expect(429);
    ctx.clock.advance(2);
    await login("budi@mail.com", PW).expect(200);
  });

  it("percobaan saat terkunci tidak memperpanjang kunci", async () => {
    await failTimes(5);
    for (let i = 0; i < 10; i++) {
      ctx.clock.advance(MIN);
      await login("budi@mail.com", "salah-salah-1").expect(429);
    }
    ctx.clock.advance(5 * MIN + 1);
    await login("budi@mail.com", PW).expect(200);
  });

  it("gagal yang terpisah lebih dari 15 menit tidak mengunci", async () => {
    await failTimes(4);
    ctx.clock.advance(15 * MIN + 1);
    await failTimes(1);
    await login("budi@mail.com", PW).expect(200);
  });

  it("login sukses mengatur ulang hitungan", async () => {
    await failTimes(4);
    await login("budi@mail.com", PW).expect(200);
    await failTimes(4);
    await login("budi@mail.com", PW).expect(200);
  });

  it("email tak dikenal juga terkunci, tanpa email peringatan", async () => {
    await failTimes(5, "tidakada@mail.com");
    expect((await login("tidakada@mail.com", "apa-saja-123").expect(429)).body).toEqual(LOCKED);
    expect(await ctx.emails()).toHaveLength(0);
  });

  it("kunci satu akun tidak memengaruhi akun lain", async () => {
    await ctx.createUser({ email: "siti@mail.com", password: PW });
    await failTimes(5);
    await login("siti@mail.com", PW).expect(200);
  });
});

describe("POST /api/auth/logout", () => {
  it("mencabut sesi dan menghapus cookie", async () => {
    const cookie = cookieOf(await login("budi@mail.com", PW).expect(200));
    const res = await ctx.post("/api/auth/logout", {}, cookie).expect(204);
    expect(res.headers["set-cookie"][0]).toMatch(/^hayatun_sid=;.*Expires=Thu, 01 Jan 1970/);
    await ctx.get("/api/auth/me", cookie).expect(401);
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it("tanpa sesi pun tetap 204", async () => {
    await ctx.post("/api/auth/logout").expect(204);
  });
});
