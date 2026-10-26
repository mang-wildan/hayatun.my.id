import { emailSchema, loginSchema, registerSchema, resetPasswordSchema, totpCodeSchema } from "@hayatun/shared";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { authTokens, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { enqueueEmail } from "../notifications/worker.js";
import { isLocked, recordAttempt } from "./lockout.js";
import { hashPassword, isCommonPassword, verifyPassword } from "./password.js";
import { createSession, revokeUserSessions } from "./sessions.js";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp.js";
import { consumeToken, issueToken, peekToken, type ConsumeResult } from "./tokens.js";

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

const BAD_CREDENTIALS = () => new HttpError(401, "Email atau password-nya belum cocok.", "BAD_CREDENTIALS");
export const LOCKED = () => new HttpError(429, "Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi ya.", "LOCKED");

// dipakai saat email tidak dikenal, supaya waktu jawabnya sama dengan password salah
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("bukan-password-siapa-pun"));

export async function recordFailure(deps: Deps, emailIndex: string, u: User | undefined, email: string) {
  const { justLocked } = await recordAttempt(deps.db, emailIndex, false, deps.now());
  if (justLocked && u?.status === "active") {
    const name = u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined;
    await enqueueEmail(deps.queue, deps.crypto, "login_locked", email, { name });
  }
}

// Login sukses baru dicatat saat sesi dibuat. Bila dicatat saat password benar, penyerang yang tahu password
// bisa mengatur ulang hitungan gagal dan menebak kode TOTP tanpa batas.
export async function finishLogin(deps: Deps, u: User) {
  await recordAttempt(deps.db, u.emailIndex, true, deps.now());
  const session = await createSession(deps.db, { id: u.id, role: u.role }, deps.now());
  return { session, user: publicUser(deps, u) };
}

export type LoginResult =
  | { next: "done"; session: { token: string; expiresAt: Date }; user: ReturnType<typeof publicUser> }
  | { next: "totp" | "totp_setup"; challenge: string };

export async function login(deps: Deps, input: unknown): Promise<LoginResult> {
  const body = loginSchema.parse(input);
  const emailIndex = deps.crypto.blindIndex(body.email);
  if (await isLocked(deps.db, emailIndex, deps.now())) throw LOCKED();

  const u = await findUserByEmail(deps, body.email);
  const passwordOk = await verifyPassword(u?.passwordHash ?? (await getDummyHash()), body.password);
  if (!u || !u.passwordHash || !passwordOk || u.status !== "active") {
    await recordFailure(deps, emailIndex, u, body.email);
    throw BAD_CREDENTIALS();
  }

  // F15.2: admin tidak pernah mendapat sesi tanpa TOTP; F1.4: pembeli dengan TOTP aktif diminta kode
  if (u.totpEnabled || u.role === "admin") {
    const challenge = await issueToken(deps.db, "mfa_challenge", u.id, deps.now());
    return { next: u.totpEnabled ? "totp" : "totp_setup", challenge };
  }
  return { next: "done", ...(await finishLogin(deps, u)) };
}

export const FORGOT_MESSAGE = "Kalau emailnya terdaftar, kami sudah kirim tautan untuk atur ulang password.";

const RESET_MESSAGES = {
  dead: "Tautannya tidak berlaku lagi. Minta tautan atur ulang password yang baru ya.",
  used: "Tautannya sudah dipakai. Minta tautan atur ulang password yang baru kalau masih perlu.",
};

// F1.3: jawaban selalu sama; tautan hanya untuk akun aktif yang sudah punya password
export async function forgotPassword(deps: Deps, input: unknown): Promise<void> {
  const email = emailSchema.parse((input as { email?: unknown } | undefined)?.email);
  const u = await findUserByEmail(deps, email);
  if (!u || u.status !== "active" || !u.passwordHash) return;
  const token = await issueToken(deps.db, "reset_password", u.id, deps.now());
  const name = u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined;
  await enqueueEmail(deps.queue, deps.crypto, "reset_password", email, { name, link: `${deps.config.appUrl}/reset-password?token=${token}` });
}

export async function resetPassword(deps: Deps, input: unknown): Promise<void> {
  const body = resetPasswordSchema.parse(input);
  assertNotCommon(body.password); // sebelum memakai token, supaya tautannya tetap bisa dipakai lagi
  const now = deps.now();
  const result = await consumeToken(deps.db, "reset_password", body.token, now);
  if ("error" in result) throw tokenError(result, RESET_MESSAGES);
  const [u] = await deps.db.select().from(users).where(eq(users.id, result.userId));
  if (u?.status !== "active") throw tokenError({ error: "invalid" }, RESET_MESSAGES);

  await deps.db
    .update(users)
    .set({ passwordHash: await hashPassword(body.password), emailVerifiedAt: u.emailVerifiedAt ?? now })
    .where(eq(users.id, u.id));
  await revokeUserSessions(deps.db, u.id);
  // tautan reset lain yang masih aktif tidak boleh dipakai lagi
  await deps.db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.userId, u.id), eq(authTokens.type, "reset_password"), isNull(authTokens.usedAt)));
  // pemilik email terbukti; buka penguncian login
  await recordAttempt(deps.db, u.emailIndex, true, now);
}

// ---- TOTP (F1.4, F15.2) ----

const CHALLENGE_DEAD = () => new HttpError(400, "Waktunya habis. Silakan masuk lagi dari awal ya.", "CHALLENGE_EXPIRED");
const BAD_TOTP = () => new HttpError(401, "Kodenya belum cocok. Coba kode terbaru di aplikasi authenticator-mu.", "BAD_TOTP");
const ALREADY_ENABLED = () => new HttpError(409, "Verifikasi dua langkah sudah aktif.", "TOTP_ALREADY_ENABLED");

const getUser = async (deps: Deps, id: string) => (await deps.db.select().from(users).where(eq(users.id, id)))[0];

// Pengguna untuk setup/confirm: dari sesi (pembeli yang sudah masuk) atau challenge (admin yang baru memasang TOTP)
async function userFor(deps: Deps, sessionUserId: string | undefined, challenge: unknown): Promise<User> {
  if (sessionUserId) return getUser(deps, sessionUserId);
  if (typeof challenge !== "string" || !challenge) throw new HttpError(401, "Kamu perlu masuk dulu ya.", "UNAUTHENTICATED");
  const found = await peekToken(deps.db, "mfa_challenge", challenge, deps.now());
  const u = found && (await getUser(deps, found.userId));
  if (!u || u.status !== "active") throw CHALLENGE_DEAD();
  return u;
}

// Kode salah dihitung sebagai login gagal, jadi menebak 6 angka terhenti oleh penguncian (F1.8).
async function checkCode(deps: Deps, u: User, rawCode: unknown, secret: string): Promise<number> {
  const code = totpCodeSchema.parse(rawCode);
  if (await isLocked(deps.db, u.emailIndex, deps.now())) throw LOCKED();
  const step = verifyTotp(secret, code, deps.now());
  if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep)) {
    await recordFailure(deps, u.emailIndex, u, deps.crypto.decrypt(u.emailEnc));
    throw BAD_TOTP();
  }
  return step;
}

export async function loginTotp(deps: Deps, input: { challenge?: unknown; code?: unknown }) {
  const u = await userFor(deps, undefined, input.challenge);
  if (!u.totpEnabled || !u.totpSecretEnc) throw CHALLENGE_DEAD();
  const step = await checkCode(deps, u, input.code, deps.crypto.decrypt(u.totpSecretEnc));
  // atomik: dari dua login bersamaan dengan kode yang sama, hanya satu yang lolos
  const [claimed] = await deps.db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, u.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  if (!claimed) throw BAD_TOTP();
  if ("error" in (await consumeToken(deps.db, "mfa_challenge", String(input.challenge), deps.now()))) throw CHALLENGE_DEAD();
  return finishLogin(deps, u);
}

export async function totpSetup(deps: Deps, sessionUserId: string | undefined, input: { challenge?: unknown }) {
  const u = await userFor(deps, sessionUserId, input.challenge);
  if (u.totpEnabled) throw ALREADY_ENABLED();
  const secret = generateTotpSecret();
  await deps.db.update(users).set({ totpSecretEnc: deps.crypto.encrypt(secret), totpLastStep: null }).where(eq(users.id, u.id));
  return { otpauthUri: totpUri(secret, deps.crypto.decrypt(u.emailEnc), deps.config.totpIssuer), secret };
}

export async function totpConfirm(deps: Deps, sessionUserId: string | undefined, input: { challenge?: unknown; code?: unknown }) {
  const u = await userFor(deps, sessionUserId, input.challenge);
  if (u.totpEnabled) throw ALREADY_ENABLED();
  if (!u.totpSecretEnc) throw new HttpError(400, "Mulai pasang verifikasi dua langkah dulu ya.", "TOTP_NOT_STARTED");
  const step = await checkCode(deps, u, input.code, deps.crypto.decrypt(u.totpSecretEnc));
  await deps.db.update(users).set({ totpEnabled: true, totpLastStep: step }).where(eq(users.id, u.id));
  if (sessionUserId) return null;
  // admin baru: TOTP aktif sekaligus masuk
  if ("error" in (await consumeToken(deps.db, "mfa_challenge", String(input.challenge), deps.now()))) throw CHALLENGE_DEAD();
  return finishLogin(deps, { ...u, totpEnabled: true });
}

export async function totpDisable(deps: Deps, sessionUserId: string, input: { code?: unknown }) {
  const u = await getUser(deps, sessionUserId);
  if (u.role === "admin") throw new HttpError(403, "Admin wajib memakai verifikasi dua langkah.", "TOTP_REQUIRED");
  if (!u.totpEnabled || !u.totpSecretEnc) throw new HttpError(409, "Verifikasi dua langkah belum aktif.", "TOTP_NOT_ENABLED");
  await checkCode(deps, u, input.code, deps.crypto.decrypt(u.totpSecretEnc));
  await deps.db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, u.id));
}
