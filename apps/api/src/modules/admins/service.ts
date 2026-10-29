import { formatWIB } from "@hayatun/shared";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { authTokens, sessions, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";
import type { SessionUser } from "../auth/sessions.js";
import { issueToken } from "../auth/tokens.js";
import { notifyAdmins } from "../notifications/admins.js";
import { emailBuyer } from "../notifications/buyer.js";
import { enqueueEmail } from "../notifications/worker.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const emailSchema = z.object({
  email: z.string({ error: "Email diisi dulu ya." }).trim().toLowerCase().min(1, "Email diisi dulu ya.").max(120, "Email maksimal 120 karakter.").regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Format email belum benar."),
});
const userNotFound = () => new HttpError(404, "Akun pembeli dengan email itu tidak ditemukan.", "USER_NOT_FOUND");
const adminNotFound = () => new HttpError(404, "Admin tidak ditemukan.", "ADMIN_NOT_FOUND");

const nameOf = async (deps: Deps, userId: string) => {
  const [u] = await deps.db.select({ nameEnc: users.nameEnc }).from(users).where(eq(users.id, userId));
  return u?.nameEnc ? deps.crypto.decrypt(u.nameEnc) : "seorang admin";
};
const dropAccess = async (tx: Tx, userId: string) => {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(authTokens).where(eq(authTokens.userId, userId));
};

export async function listAdmins(deps: Deps) {
  const rows = await deps.db.select().from(users).where(eq(users.role, "admin")).orderBy(asc(users.createdAt), asc(users.id));
  return { admins: rows.map((u) => ({ id: u.id, name: u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : null, email: deps.crypto.decrypt(u.emailEnc), status: u.status, createdAt: u.createdAt })) };
}

// F15.1: undangan lewat email. Yang masih Diundang dikirimi ulang; yang Dinonaktifkan kembali Diundang dan harus membuat password dan TOTP baru.
export async function inviteAdmin(deps: Deps, actor: SessionUser, input: unknown) {
  const { email } = emailSchema.parse(input);
  const emailIndex = deps.crypto.blindIndex(email);
  const { id, resend } = await deps.db.transaction(async (tx) => {
    const [made] = await tx.insert(users).values({ role: "admin", status: "invited", emailEnc: deps.crypto.encrypt(email), emailIndex }).onConflictDoNothing().returning({ id: users.id });
    if (made) return { id: made.id, resend: false };
    const [u] = await tx.select().from(users).where(eq(users.emailIndex, emailIndex)).for("update");
    if (u.role !== "admin") throw new HttpError(409, "Email ini sudah dipakai akun pembeli.", "EMAIL_IS_BUYER");
    if (u.status === "active") throw new HttpError(409, "Email ini sudah menjadi admin aktif.", "ADMIN_EXISTS");
    if (u.status === "disabled") {
      await tx.update(users).set({ status: "invited", passwordHash: null, totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, u.id));
      await dropAccess(tx, u.id);
    }
    return { id: u.id, resend: u.status === "invited" };
  });
  const token = await issueToken(deps.db, "admin_invite", id, deps.now());
  if (!resend) await recordAudit(deps.db, { actorId: actor.userId, action: "admin.invited", entityType: "user", entityId: id });
  try { // F11.4: gagal masuk antrean tidak membatalkan undangan
    await enqueueEmail(deps.queue, deps.crypto, "admin_invite", email, { link: `${deps.config.appUrl}/admin/undangan?token=${token}` });
  } catch (err) {
    deps.logger.error({ template: "admin_invite", errorName: (err as Error).name }, "email gagal masuk antrean");
  }
  if (!resend) await notifyAdmins(deps, "admin_added", { changedBy: await nameOf(deps, actor.userId), changedAt: formatWIB(deps.now()), target: email, link: `${deps.config.appUrl}/admin/admin` });
  return { id, status: "invited" as const };
}

// F15.5, F15.6. Semua baris admin aktif dikunci lalu dihitung ulang: dua admin yang saling menonaktifkan bersamaan tidak bisa menyisakan nol.
export async function disableAdmin(deps: Deps, actor: SessionUser, id: string) {
  const target = await deps.db.transaction(async (tx) => {
    const [t] = UUID.test(id) ? await tx.select().from(users).where(eq(users.id, id)) : [];
    if (!t || t.role !== "admin") throw adminNotFound();
    const active = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"))).orderBy(asc(users.id)).for("update");
    const [now] = await tx.select({ status: users.status }).from(users).where(eq(users.id, id));
    if (now.status === "disabled") throw new HttpError(409, "Admin ini sudah tidak aktif.", "ADMIN_NOT_ACTIVE");
    if (now.status === "active" && active.length <= 1) throw new HttpError(409, "Admin terakhir tidak bisa dinonaktifkan.", "LAST_ADMIN");
    await tx.update(users).set({ status: "disabled" }).where(eq(users.id, id));
    await dropAccess(tx, id); // sesi mati seketika; resolveSession juga menolak yang tidak aktif
    await recordAudit(tx as unknown as Db, { actorId: actor.userId, action: "admin.disabled", entityType: "user", entityId: id });
    return t;
  });
  await notifyAdmins(deps, "admin_disabled", {
    changedBy: await nameOf(deps, actor.userId), changedAt: formatWIB(deps.now()),
    target: target.nameEnc ? deps.crypto.decrypt(target.nameEnc) : deps.crypto.decrypt(target.emailEnc), link: `${deps.config.appUrl}/admin/admin`,
  });
  return { status: "disabled" as const };
}

// Pembeli dicari dengan email persis (tidak ada daftar semua pembeli); pembukaan ini dicatat (N28)
export async function lookupBuyer(deps: Deps, actor: SessionUser, input: unknown) {
  const { email } = emailSchema.parse(input);
  const [u] = await deps.db.select().from(users).where(and(eq(users.emailIndex, deps.crypto.blindIndex(email)), eq(users.role, "buyer")));
  if (!u) throw userNotFound();
  await recordAudit(deps.db, { actorId: actor.userId, action: "user.viewed", entityType: "user", entityId: u.id });
  return { id: u.id, name: u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : null, status: u.status, totpEnabled: u.totpEnabled };
}

// Pembeli yang kehilangan HP. Sesinya dicabut dan ia diberi tahu; TOTP admin tidak bisa dimatikan (wajib, F15.2).
export async function disableBuyerTotp(deps: Deps, actor: SessionUser, id: string) {
  await deps.db.transaction(async (tx) => {
    const [u] = UUID.test(id) ? await tx.select().from(users).where(and(eq(users.id, id), eq(users.role, "buyer"))).for("update") : [];
    if (!u) throw new HttpError(404, "Akun pembeli tidak ditemukan.", "USER_NOT_FOUND");
    if (!u.totpEnabled) throw new HttpError(409, "Verifikasi dua langkah pembeli ini belum aktif.", "TOTP_NOT_ENABLED");
    await tx.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await recordAudit(tx as unknown as Db, { actorId: actor.userId, action: "user.totp_disabled", entityType: "user", entityId: id });
  });
  await emailBuyer(deps, id, "totp_reset_by_admin", {});
  return { totpEnabled: false as const };
}
