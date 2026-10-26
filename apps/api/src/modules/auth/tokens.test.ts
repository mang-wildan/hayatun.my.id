import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authTokens } from "../../db/schema.js";
import { insertUser, resetDb, testDb } from "../../test/db.js";
import { consumeToken, issueToken, TOKEN_TTL } from "./tokens.js";

const { db, pool } = testDb();
const now = new Date("2026-10-26T07:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
let userId: string;

beforeEach(async () => {
  await resetDb();
  userId = await insertUser(db);
});
afterAll(() => pool.end());

describe("TOKEN_TTL", () => {
  it("sesuai SPEC F1.3 dan keputusan R1–R3", () => {
    expect(TOKEN_TTL).toEqual({
      verify_email: 24 * 3600_000,
      reset_password: 60 * 60_000,
      admin_invite: 72 * 3600_000,
      mfa_challenge: 5 * 60_000,
    });
  });
});

describe("issueToken", () => {
  it("mengembalikan token acak dan hanya menyimpan hash-nya", async () => {
    const t = await issueToken(db, "reset_password", userId, now);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 byte base64url
    expect(await issueToken(db, "reset_password", userId, now)).not.toBe(t);
    const rows = await db.select().from(authTokens);
    expect(rows.map((r) => r.tokenHash)).not.toContain(t);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.every((r) => r.expiresAt.getTime() === later(TOKEN_TTL.reset_password).getTime())).toBe(true);
  });
});

describe("consumeToken (F1.7)", () => {
  it("berhasil sekali dan mengembalikan pemilik token", async () => {
    const t = await issueToken(db, "verify_email", userId, now);
    expect(await consumeToken(db, "verify_email", t, now)).toEqual({ userId });
    expect(await consumeToken(db, "verify_email", t, now)).toEqual({ error: "used" });
  });

  it("pemakaian bersamaan: tepat satu berhasil", async () => {
    const t = await issueToken(db, "reset_password", userId, now);
    const results = await Promise.all([1, 2, 3].map(() => consumeToken(db, "reset_password", t, now)));
    expect(results.filter((r) => "userId" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r && r.error === "used")).toHaveLength(2);
  });

  it("masih berlaku tepat sebelum batas, kedaluwarsa setelahnya (F1.3: 60 menit)", async () => {
    const a = await issueToken(db, "reset_password", userId, now);
    const b = await issueToken(db, "reset_password", userId, now);
    expect(await consumeToken(db, "reset_password", a, later(60 * 60_000 - 1))).toEqual({ userId });
    expect(await consumeToken(db, "reset_password", b, later(60 * 60_000 + 1))).toEqual({ error: "expired" });
  });

  it("token kedaluwarsa tidak ditandai terpakai", async () => {
    const t = await issueToken(db, "reset_password", userId, now);
    await consumeToken(db, "reset_password", t, later(TOKEN_TTL.reset_password + 1));
    const [row] = await db.select().from(authTokens).where(eq(authTokens.userId, userId));
    expect(row.usedAt).toBeNull();
  });

  it("jenis yang salah atau token tak dikenal dianggap tidak berlaku", async () => {
    const t = await issueToken(db, "reset_password", userId, now);
    expect(await consumeToken(db, "verify_email", t, now)).toEqual({ error: "invalid" });
    expect(await consumeToken(db, "reset_password", "token-ngawur", now)).toEqual({ error: "invalid" });
    expect(await consumeToken(db, "reset_password", t, now)).toEqual({ userId }); // masih utuh untuk jenis yang benar
  });
});
