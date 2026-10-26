import { emailSchema, registerSchema } from "@hayatun/shared";
import { eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { enqueueEmail } from "../notifications/worker.js";
import { hashPassword, isCommonPassword } from "./password.js";
import { consumeToken, issueToken, type ConsumeResult } from "./tokens.js";

type Deps = Pick<AppDeps, "config" | "db" | "queue" | "crypto" | "now">;
type User = typeof users.$inferSelect;

export const CHECK_EMAIL = "Cek emailmu ya. Kami kirim tautan untuk verifikasi akun.";

export function assertNotCommon(password: string) {
  if (isCommonPassword(password)) {
    const message = "Password ini terlalu umum dan gampang ditebak. Pakai yang lebih unik ya.";
    throw new HttpError(422, message, "VALIDATION", { password: message });
  }
}

export async function findUserByEmail(deps: Deps, email: string): Promise<User | undefined> {
  const [u] = await deps.db.select().from(users).where(eq(users.emailIndex, deps.crypto.blindIndex(email)));
  return u;
}

export function publicUser(deps: Deps, u: User) {
  return {
    id: u.id,
    name: u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : null,
    email: deps.crypto.decrypt(u.emailEnc),
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
    totpEnabled: u.totpEnabled,
  };
}

// Mengubah hasil consumeToken menjadi error HTTP dengan pesan yang sesuai jenis tautannya.
export function tokenError(result: Exclude<ConsumeResult, { userId: string }>, messages: { dead: string; used: string }) {
  const code = { invalid: "TOKEN_INVALID", expired: "TOKEN_EXPIRED", used: "TOKEN_USED" }[result.error];
  return new HttpError(400, result.error === "used" ? messages.used : messages.dead, code);
}

const VERIFY_MESSAGES = {
  dead: "Tautannya tidak berlaku lagi. Minta tautan verifikasi baru ya.",
  used: "Tautannya sudah dipakai. Kalau emailmu belum terverifikasi, minta tautan baru ya.",
};

async function sendVerification(deps: Deps, u: Pick<User, "id">, email: string, name: string | undefined) {
  const token = await issueToken(deps.db, "verify_email", u.id, deps.now());
  await enqueueEmail(deps.queue, deps.crypto, "verify_email", email, { name, link: `${deps.config.appUrl}/verifikasi-email?token=${token}` });
}

// F1.1, F1.2, F1.6: jawaban selalu sama, ada atau tidak ada akun dengan email itu
export async function registerBuyer(deps: Deps, input: unknown): Promise<void> {
  const body = registerSchema.parse(input);
  assertNotCommon(body.password);
  // hash selalu dihitung supaya waktu jawab tidak membocorkan apakah email sudah terdaftar
  const passwordHash = await hashPassword(body.password);

  const existing = await findUserByEmail(deps, body.email);
  if (existing) {
    const name = existing.nameEnc ? deps.crypto.decrypt(existing.nameEnc) : undefined;
    await enqueueEmail(deps.queue, deps.crypto, "email_already_registered", body.email, { name });
    return;
  }

  const [created] = await deps.db
    .insert(users)
    .values({
      role: "buyer",
      emailEnc: deps.crypto.encrypt(body.email),
      emailIndex: deps.crypto.blindIndex(body.email),
      nameEnc: deps.crypto.encrypt(body.name),
      passwordHash,
    })
    .onConflictDoNothing({ target: users.emailIndex }) // pendaftaran bersamaan dengan email sama
    .returning({ id: users.id });
  if (created) await sendVerification(deps, created, body.email, body.name);
}

export async function verifyEmail(deps: Deps, token: unknown): Promise<void> {
  const result = await consumeToken(deps.db, "verify_email", String(token ?? ""), deps.now());
  if ("error" in result) throw tokenError(result, VERIFY_MESSAGES);
  const [u] = await deps.db.select().from(users).where(eq(users.id, result.userId));
  if (u?.status !== "active") throw tokenError({ error: "invalid" }, VERIFY_MESSAGES);
  await deps.db.update(users).set({ emailVerifiedAt: deps.now() }).where(eq(users.id, u.id));
}

export async function resendVerification(deps: Deps, input: unknown): Promise<void> {
  const email = emailSchema.parse((input as { email?: unknown } | undefined)?.email);
  const u = await findUserByEmail(deps, email);
  if (u && u.status === "active" && !u.emailVerifiedAt) {
    await sendVerification(deps, u, email, u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined);
  }
}

export async function getMe(deps: Deps, userId: string) {
  const [u] = await deps.db.select().from(users).where(eq(users.id, userId));
  return publicUser(deps, u);
}
