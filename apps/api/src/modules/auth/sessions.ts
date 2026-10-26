import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import type { Db } from "../../db/client.js";
import { sessions, users } from "../../db/schema.js";
import { hashToken } from "./tokens.js";

export const SESSION_COOKIE = "hayatun_sid";
export const ADMIN_IDLE_MS = 30 * 60_000; // N4
export const ADMIN_MAX_AGE_MS = 12 * 3600_000; // R9
export const BUYER_MAX_AGE_MS = 30 * 24 * 3600_000; // N4

export type Role = "buyer" | "admin";
export interface SessionUser { userId: string; role: Role; sessionId: string }

export async function createSession(db: Db, user: { id: string; role: Role }, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + (user.role === "admin" ? ADMIN_MAX_AGE_MS : BUYER_MAX_AGE_MS));
  await db.insert(sessions).values({ idHash: hashToken(token), userId: user.id, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

// Peran dan status dibaca dari users setiap permintaan, jadi admin yang dinonaktifkan langsung kehilangan akses (F15.5)
export async function resolveSession(db: Db, token: string, now: Date): Promise<SessionUser | null> {
  const [row] = await db
    .select({ sessionId: sessions.id, userId: users.id, role: users.role, status: users.status, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.idHash, hashToken(token)));
  if (!row || row.status !== "active" || row.expiresAt <= now) return null;
  if (row.role === "admin") {
    if (now.getTime() - row.lastSeenAt.getTime() > ADMIN_IDLE_MS) return null;
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return { userId: row.userId, role: row.role, sessionId: row.sessionId };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessions(db: Db, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

const cookieOptions = { httpOnly: true, sameSite: "lax", path: "/" } as const;

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, secure, expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
