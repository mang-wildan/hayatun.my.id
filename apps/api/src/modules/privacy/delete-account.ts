import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { addresses, authTokens, cartItems, loginAttempts, orders, sessions, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";
import { verifyPassword } from "../auth/password.js";
import type { SessionUser } from "../auth/sessions.js";
import { enqueueEmail } from "../notifications/worker.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const BATCH = 50;
const passwordSchema = z.object({ password: z.string({ error: "Password wajib diisi." }).min(1, "Password wajib diisi.") });

// F12.5: pesanan yang masih berjalan menunda penghapusan. Menunggu Pembayaran ikut menunda: kedaluwarsa dalam 24 jam atau bisa dibatalkan pembeli.
async function blockersOf(db: Pick<Db, "select">, userId: string) {
  const rows = await db.select({ orderId: orders.id, invoiceNumber: orders.invoiceNumber, status: orders.status }).from(orders)
    .where(and(eq(orders.userId, userId), or(
      inArray(orders.status, ["MENUNGGU_PEMBAYARAN", "MENUNGGU_VERIFIKASI"]),
      and(eq(orders.status, "LUNAS"), inArray(orders.physicalStatus, ["DIPROSES", "DIKIRIM"])),
    ))).orderBy(orders.createdAt);
  return rows.map((o) => ({ orderId: o.orderId, invoiceNumber: o.invoiceNumber, reason: o.status === "MENUNGGU_PEMBAYARAN" ? "Menunggu pembayaran" : o.status === "MENUNGGU_VERIFIKASI" ? "Menunggu verifikasi" : "Pesanan fisik belum diterima" }));
}

export async function getDeletion(deps: Deps, viewer: SessionUser) {
  const [u] = await deps.db.select({ requestedAt: users.deletionRequestedAt }).from(users).where(eq(users.id, viewer.userId));
  return { requestedAt: u?.requestedAt ?? null, blockers: u?.requestedAt ? await blockersOf(deps.db, viewer.userId) : [] };
}

// F1.5. Password diminta lagi supaya sesi yang tercuri tidak bisa menghapus akun.
export async function requestDeletion(deps: Deps, viewer: SessionUser, input: unknown) {
  const { password } = passwordSchema.parse(input);
  const [u] = await deps.db.select().from(users).where(eq(users.id, viewer.userId));
  if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw new HttpError(403, "Password salah.", "BAD_PASSWORD", { password: "Password salah." });
  if (!u.deletionRequestedAt) {
    await deps.db.update(users).set({ deletionRequestedAt: deps.now() }).where(eq(users.id, u.id));
    await recordAudit(deps.db, { actorId: u.id, action: "account.deletion_requested", entityType: "user", entityId: u.id });
  }
  return getDeletion(deps, viewer);
}

export async function cancelDeletion(deps: Deps, viewer: SessionUser) {
  await deps.db.update(users).set({ deletionRequestedAt: null }).where(and(eq(users.id, viewer.userId), eq(users.status, "active")));
  return getDeletion(deps, viewer);
}

// F12.2: profil, alamat, nomor HP, dan sesi dihapus atau dianonimkan; invoice dan transaksi tetap (10 tahun). Bukti bayar menunggu T46.
async function deleteOne(deps: Deps, id: string) {
  const now = deps.now();
  const done = await deps.db.transaction(async (tx: Tx) => {
    // SKIP LOCKED: penyapu bersamaan membagi pekerjaan, tiap akun diproses sekali
    const [u] = await tx.select().from(users).where(eq(users.id, id)).for("update", { skipLocked: true });
    if (!u || u.status !== "active" || !u.deletionRequestedAt || (await blockersOf(tx, id)).length) return null;
    const email = deps.crypto.decrypt(u.emailEnc);
    const name = u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined;
    await tx.update(users).set({
      status: "deleted", deletedAt: now, deletionRequestedAt: null, nameEnc: null, phoneEnc: null, passwordHash: null, totpSecretEnc: null, totpEnabled: false,
      emailEnc: deps.crypto.encrypt(`dihapus-${id}@hayatun.invalid`), emailIndex: `deleted:${id}`, // email lama bebas dipakai mendaftar lagi
    }).where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await tx.delete(authTokens).where(eq(authTokens.userId, id));
    await tx.delete(addresses).where(eq(addresses.userId, id));
    await tx.delete(cartItems).where(eq(cartItems.userId, id));
    await tx.delete(loginAttempts).where(eq(loginAttempts.emailIndex, u.emailIndex));
    await tx.update(orders).set({ shipRecipientEnc: null, shipPhoneEnc: null, shipAddressEnc: null }).where(and(eq(orders.userId, id), isNotNull(orders.shipRecipientEnc)));
    await recordAudit(tx as unknown as Db, { actorId: null, action: "account.deleted", entityType: "user", entityId: id });
    return { email, name };
  });
  if (!done) return false;
  try { // F11.4: gagal masuk antrean tidak membatalkan penghapusan
    await enqueueEmail(deps.queue, deps.crypto, "account_deleted", done.email, { name: done.name });
  } catch (err) {
    deps.logger.error({ template: "account_deleted", errorName: (err as Error).name }, "email gagal masuk antrean");
  }
  return true;
}

export async function processAccountDeletions(deps: Deps): Promise<number> {
  const due = await deps.db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), eq(users.role, "buyer"), isNotNull(users.deletionRequestedAt))).limit(BATCH);
  let n = 0;
  for (const { id } of due) if (await deleteOne(deps, id)) n++;
  return n;
}
