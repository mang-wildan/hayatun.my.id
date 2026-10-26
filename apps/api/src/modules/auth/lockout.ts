import { and, desc, eq, gt, max } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { loginAttempts } from "../../db/schema.js";

// F1.8: 5 kali gagal dalam 15 menit mengunci 15 menit sejak kegagalan ke-5
export const LOCKOUT = { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

export async function isLocked(db: Db, emailIndex: string, now: Date): Promise<boolean> {
  const [{ lastOk }] = await db
    .select({ lastOk: max(loginAttempts.attemptedAt) })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.emailIndex, emailIndex), eq(loginAttempts.success, true)));
  const fails = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.emailIndex, emailIndex), eq(loginAttempts.success, false), gt(loginAttempts.attemptedAt, lastOk ?? new Date(0))))
    .orderBy(desc(loginAttempts.attemptedAt))
    .limit(LOCKOUT.maxFailures);
  if (fails.length < LOCKOUT.maxFailures) return false;
  const newest = fails[0].at.getTime();
  const oldest = fails[fails.length - 1].at.getTime();
  return newest - oldest <= LOCKOUT.windowMs && now.getTime() < newest + LOCKOUT.lockMs;
}

// Percobaan saat terkunci tidak dicatat (pemanggil memeriksa isLocked lebih dulu), jadi kunci tidak bisa diperpanjang.
export async function recordAttempt(db: Db, emailIndex: string, success: boolean, now: Date): Promise<{ justLocked: boolean }> {
  await db.insert(loginAttempts).values({ emailIndex, success, attemptedAt: now });
  return { justLocked: !success && (await isLocked(db, emailIndex, now)) };
}
