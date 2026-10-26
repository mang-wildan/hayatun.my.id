import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { authTokens } from "../../db/schema.js";

export type TokenType = (typeof authTokens.type.enumValues)[number];

// SPEC F1.3 (reset 60 menit) dan keputusan R1–R3 di Rencana 1
export const TOKEN_TTL: Record<TokenType, number> = {
  verify_email: 24 * 3600_000,
  reset_password: 60 * 60_000,
  admin_invite: 72 * 3600_000,
  mfa_challenge: 5 * 60_000,
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueToken(db: Db, type: TokenType, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    type,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + TOKEN_TTL[type]),
  });
  return token;
}

export type ConsumeResult = { userId: string } | { error: "invalid" | "expired" | "used" };

// F1.7: satu UPDATE bersyarat, jadi dari beberapa pemakaian bersamaan hanya satu yang berhasil
export async function consumeToken(db: Db, type: TokenType, token: string, now: Date): Promise<ConsumeResult> {
  const tokenHash = hashToken(token);
  const match = and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.type, type));
  const [used] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(match, isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ userId: authTokens.userId });
  if (used) return { userId: used.userId };

  const [row] = await db.select({ usedAt: authTokens.usedAt }).from(authTokens).where(match);
  if (!row) return { error: "invalid" };
  return { error: row.usedAt ? "used" : "expired" };
}

// Memeriksa token tanpa memakainya, misalnya challenge TOTP yang harus tetap berlaku saat kode salah.
export async function peekToken(db: Db, type: TokenType, token: string, now: Date): Promise<{ userId: string } | null> {
  const [row] = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)));
  return row ?? null;
}
