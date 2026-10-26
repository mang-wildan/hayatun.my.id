import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "../../db/schema.js";
import { errorHandler } from "../../errors.js";
import { insertUser, resetDb, testDb } from "../../test/db.js";
import { loadSession, requireAdmin, requireBuyer } from "./middleware.js";
import {
  ADMIN_IDLE_MS, ADMIN_MAX_AGE_MS, BUYER_MAX_AGE_MS, SESSION_COOKIE,
  clearSessionCookie, createSession, resolveSession, revokeSession, revokeUserSessions, setSessionCookie,
} from "./sessions.js";

const { db, pool } = testDb();
const MIN = 60_000;
const t0 = new Date("2026-10-26T07:00:00Z");
let clock = t0;
const at = (ms: number) => (clock = new Date(t0.getTime() + ms));

let buyerId: string;
let adminId: string;
beforeEach(async () => {
  await resetDb();
  clock = t0;
  buyerId = await insertUser(db, { role: "buyer" });
  adminId = await insertUser(db, { role: "admin" });
});
afterAll(() => pool.end());

describe("konstanta (N4, R9)", () => {
  it("sesuai SPEC", () => {
    expect(SESSION_COOKIE).toBe("hayatun_sid");
    expect(ADMIN_IDLE_MS).toBe(30 * MIN);
    expect(ADMIN_MAX_AGE_MS).toBe(12 * 60 * MIN);
    expect(BUYER_MAX_AGE_MS).toBe(30 * 24 * 60 * MIN);
  });
});

describe("resolveSession", () => {
  it("admin yang terus aktif tidak habis; diam lebih dari 30 menit habis", async () => {
    const { token } = await createSession(db, { id: adminId, role: "admin" }, clock);
    expect(await resolveSession(db, token, at(29 * MIN))).toMatchObject({ userId: adminId, role: "admin" });
    expect(await resolveSession(db, token, at(58 * MIN))).not.toBeNull(); // dihitung dari aktivitas terakhir
    expect(await resolveSession(db, token, at(89 * MIN + 1))).toBeNull();
  });

  it("admin habis setelah 12 jam walau terus aktif", async () => {
    const { token, expiresAt } = await createSession(db, { id: adminId, role: "admin" }, clock);
    expect(expiresAt.getTime()).toBe(t0.getTime() + ADMIN_MAX_AGE_MS);
    for (let m = 20; m <= 700; m += 20) expect(await resolveSession(db, token, at(m * MIN))).not.toBeNull();
    expect(await resolveSession(db, token, at(ADMIN_MAX_AGE_MS + 1))).toBeNull();
  });

  it("pembeli tidak punya batas diam, tapi habis setelah 30 hari", async () => {
    const { token, expiresAt } = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    expect(expiresAt.getTime()).toBe(t0.getTime() + BUYER_MAX_AGE_MS);
    expect(await resolveSession(db, token, at(10 * 24 * 60 * MIN))).toMatchObject({ userId: buyerId, role: "buyer" });
    expect(await resolveSession(db, token, at(BUYER_MAX_AGE_MS + 1))).toBeNull();
  });

  it("hanya hash token yang disimpan; token acak tidak dikenal ditolak", async () => {
    const { token } = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    const rows = await db.select().from(sessions);
    expect(rows[0].idHash).not.toBe(token);
    expect(rows[0].idHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await resolveSession(db, "token-ngawur", clock)).toBeNull();
  });

  it("menolak sesi pengguna yang dinonaktifkan atau dihapus (F15.5)", async () => {
    const { token } = await createSession(db, { id: adminId, role: "admin" }, clock);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, adminId));
    expect(await resolveSession(db, token, clock)).toBeNull();
    const b = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    await db.update(users).set({ status: "deleted" }).where(eq(users.id, buyerId));
    expect(await resolveSession(db, b.token, clock)).toBeNull();
  });

  it("revokeSession mencabut satu sesi; revokeUserSessions mencabut semua milik pengguna itu saja", async () => {
    const a = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    const b = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    const lain = await createSession(db, { id: adminId, role: "admin" }, clock);
    const sa = (await resolveSession(db, a.token, clock))!;
    await revokeSession(db, sa.sessionId);
    expect(await resolveSession(db, a.token, clock)).toBeNull();
    expect(await resolveSession(db, b.token, clock)).not.toBeNull();
    await revokeUserSessions(db, buyerId);
    expect(await resolveSession(db, b.token, clock)).toBeNull();
    expect(await resolveSession(db, lain.token, clock)).not.toBeNull();
  });
});

describe("cookie sesi", () => {
  const app = (secure: boolean) =>
    express()
      .get("/masuk", (_req, res) => { setSessionCookie(res, "tok123", new Date("2026-11-25T07:00:00Z"), secure); res.end(); })
      .get("/keluar", (_req, res) => { clearSessionCookie(res); res.end(); });

  it("HttpOnly, SameSite=Lax, Path=/, dan Secure bila diminta", async () => {
    const res = await request(app(true)).get("/masuk");
    const c = res.headers["set-cookie"][0];
    expect(c).toMatch(/^hayatun_sid=tok123;/);
    expect(c).toContain("Path=/");
    expect(c).toContain("Expires=Wed, 25 Nov 2026 07:00:00 GMT");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
  });

  it("tanpa Secure untuk test dan development", async () => {
    expect((await request(app(false)).get("/masuk")).headers["set-cookie"][0]).not.toContain("Secure");
  });

  it("clearSessionCookie menghapus cookie", async () => {
    expect((await request(app(true)).get("/keluar")).headers["set-cookie"][0]).toMatch(/^hayatun_sid=;.*Expires=Thu, 01 Jan 1970/);
  });
});

describe("pemeriksa akses (N6)", () => {
  const app = express()
    .use(cookieParser())
    .use(loadSession({ db, now: () => clock }))
    .get("/pembeli", requireBuyer, (req, res) => { res.json(req.session); })
    .get("/admin", requireAdmin, (req, res) => { res.json(req.session); })
    .use(errorHandler);
  const withCookie = (path: string, token: string) => request(app).get(path).set("Cookie", `${SESSION_COOKIE}=${token}`);

  it("tanpa cookie: 401 UNAUTHENTICATED", async () => {
    const res = await request(app).get("/pembeli").expect(401);
    expect(res.body).toEqual({ message: "Kamu perlu masuk dulu ya.", code: "UNAUTHENTICATED" });
  });

  it("cookie tidak berlaku: 401 SESSION_EXPIRED", async () => {
    const res = await withCookie("/admin", "kedaluwarsa").expect(401);
    expect(res.body).toEqual({ message: "Sesimu sudah habis, silakan masuk lagi ya.", code: "SESSION_EXPIRED" });
  });

  it("peran yang salah: 403 FORBIDDEN, dua arah", async () => {
    const b = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    const a = await createSession(db, { id: adminId, role: "admin" }, clock);
    const res = await withCookie("/admin", b.token).expect(403);
    expect(res.body).toEqual({ message: "Kamu tidak punya akses ke halaman ini.", code: "FORBIDDEN" });
    await withCookie("/pembeli", a.token).expect(403);
  });

  it("peran yang benar lolos dan req.session terisi", async () => {
    const b = await createSession(db, { id: buyerId, role: "buyer" }, clock);
    expect((await withCookie("/pembeli", b.token).expect(200)).body).toMatchObject({ userId: buyerId, role: "buyer" });
    const a = await createSession(db, { id: adminId, role: "admin" }, clock);
    expect((await withCookie("/admin", a.token).expect(200)).body).toMatchObject({ userId: adminId, role: "admin" });
  });

  it("admin yang dinonaktifkan langsung kehilangan akses di permintaan berikutnya (F15.5)", async () => {
    const a = await createSession(db, { id: adminId, role: "admin" }, clock);
    await withCookie("/admin", a.token).expect(200);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, adminId));
    expect((await withCookie("/admin", a.token).expect(401)).body.code).toBe("SESSION_EXPIRED");
  });

  it("admin yang diam 31 menit ditolak (Review Focus 4)", async () => {
    const a = await createSession(db, { id: adminId, role: "admin" }, clock);
    at(31 * MIN);
    expect((await withCookie("/admin", a.token).expect(401)).body.code).toBe("SESSION_EXPIRED");
  });
});
