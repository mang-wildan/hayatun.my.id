import { formatWIB } from "@hayatun/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import { orderItems, orders, paymentProofs, products, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { assignLicenses, licensesOf } from "../fulfillment-digital/licenses.js";
import { notifyAdmins } from "../notifications/admins.js";
import { recordAudit } from "../audit/index.js";
import { readBankAccount } from "../settings/index.js";
import type { SessionUser } from "../auth/sessions.js";
import { emailBuyer } from "../notifications/buyer.js";
import { transition } from "../orders/state-machine.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "storage" | "queue" | "config" | "logger" | "now">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSION_MS = 24 * 3600_000; // F5.5
const rejectSchema = z.object({
  reason: z.string({ error: "Alasan penolakan wajib diisi." }).trim().min(1, "Alasan penolakan wajib diisi.").max(500, "Alasan maksimal 500 karakter."),
});

const orderNotFound = () => new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");
const proofNotFound = () => new HttpError(404, "Bukti bayar tidak ditemukan.", "PROOF_NOT_FOUND");
const processed = () => new HttpError(409, "Pesanan ini sudah diproses admin lain.", "ALREADY_PROCESSED");

// F5.1: yang paling lama menunggu dulu. Hanya data yang perlu untuk memutuskan (barang tanpa harga, rekening tujuan), tanpa alamat atau kontak pembeli.
export async function verificationQueue(deps: Deps) {
  const rows = await deps.db
    .select({ orderId: orders.id, invoiceNumber: orders.invoiceNumber, total: orders.total, nameEnc: users.nameEnc, uploadedAt: paymentProofs.uploadedAt, mime: paymentProofs.mime })
    .from(orders)
    .innerJoin(paymentProofs, and(eq(paymentProofs.orderId, orders.id), eq(paymentProofs.status, "pending")))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.status, "MENUNGGU_VERIFIKASI"))
    .orderBy(asc(paymentProofs.uploadedAt));
  const lines = rows.length ? await deps.db.select({ orderId: orderItems.orderId, name: orderItems.nameSnapshot, qty: orderItems.qty }).from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.orderId))).orderBy(asc(orderItems.id)) : [];
  return {
    items: rows.map(({ nameEnc, ...r }) => ({ ...r, buyerName: nameEnc ? deps.crypto.decrypt(nameEnc) : null, items: lines.filter((l) => l.orderId === r.orderId).map(({ name, qty }) => ({ name, qty })) })),
    bankAccount: await readBankAccount(deps),
  };
}

// N28: pembukaan bukti dicatat SEBELUM file dikirim, jadi tidak ada pembukaan yang lolos dari log
export async function openProof(deps: Deps, admin: SessionUser, orderId: string, res: Response) {
  const [p] = UUID.test(orderId) ? await deps.db.select().from(paymentProofs).where(eq(paymentProofs.orderId, orderId)).orderBy(desc(paymentProofs.uploadedAt)).limit(1) : [];
  if (!p) throw proofNotFound();
  await recordAudit(deps.db, { actorId: admin.userId, action: "payment_proof.viewed", entityType: "order", entityId: orderId });
  const file = deps.crypto.decryptBuffer(await deps.storage.read(p.storageKey));
  res.setHeader("Content-Type", p.mime);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file);
}

// Kunci baris pesanan, lalu hanya yang masih Menunggu Verifikasi boleh lanjut: admin kedua menunggu di sini lalu mendapat 409 (F5.6)
async function lockForReview(tx: Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0], orderId: string) {
  const [o] = UUID.test(orderId) ? await tx.select().from(orders).where(eq(orders.id, orderId)).for("update") : [];
  if (!o) throw orderNotFound();
  if (o.status !== "MENUNGGU_VERIFIKASI") throw processed();
  return o;
}

// F5.2. Token unduh dikerjakan T40.
export async function acceptPayment(deps: Deps, admin: SessionUser, orderId: string) {
  const now = deps.now();
  const { o, short } = await deps.db.transaction(async (tx) => {
    const o = await lockForReview(tx, orderId);
    const short = await assignLicenses(tx, o.id, now); // F7.1, F7.7: kurang kode tidak menggagalkan Lunas
    const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "PAYMENT_ACCEPTED", licensePending: short.length > 0 });
    await tx.update(orders).set({ status: next.status, digitalStatus: next.digital, physicalStatus: next.physical, verifiedBy: admin.userId, paidAt: now, updatedAt: now }).where(eq(orders.id, o.id));
    await tx.update(paymentProofs).set({ status: "accepted", reviewedBy: admin.userId, reviewedAt: now }).where(and(eq(paymentProofs.orderId, o.id), eq(paymentProofs.status, "pending")));

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    for (const i of items.filter((x) => x.productType === "physical")) {
      // dari ditahan menjadi terjual
      await tx.update(products).set({ stockQty: sql`${products.stockQty} - ${i.qty}`, stockReserved: sql`${products.stockReserved} - ${i.qty}`, stockSold: sql`${products.stockSold} + ${i.qty}` }).where(eq(products.id, i.productId));
    }
    await recordAudit(tx as unknown as Deps["db"], { actorId: admin.userId, action: "payment.accepted", entityType: "order", entityId: o.id });
    return { o, short };
  });
  const licenses = await licensesOf(deps, o.id);
  await emailBuyer(deps, o.userId, "payment_accepted", { invoiceNumber: o.invoiceNumber, link: `${deps.config.appUrl}/pesanan/${o.id}`, ...(licenses.length && { licenses }) });
  for (const s of short) await notifyAdmins(deps, "license_pending", { invoiceNumber: o.invoiceNumber, productName: s.name, missing: s.missing, link: `${deps.config.appUrl}/admin/produk/${s.productId}` });
  return { status: "LUNAS" as const };
}

// F5.3, F5.5, F5.7
export async function rejectPayment(deps: Deps, admin: SessionUser, orderId: string, input: unknown) {
  const { reason } = rejectSchema.parse(input); // sebelum apa pun disimpan
  const now = deps.now();
  const { o, expiresAt } = await deps.db.transaction(async (tx) => {
    const o = await lockForReview(tx, orderId);
    const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "PROOF_REJECTED" });
    // batas sudah lewat karena verifikasi lambat: pembeli diberi 24 jam sejak penolakan; pengingat 3 jam diatur ulang
    const expiresAt = now >= o.expiresAt ? new Date(now.getTime() + EXTENSION_MS) : o.expiresAt;
    await tx.update(orders).set({ status: next.status, expiresAt, reminderSentAt: null, updatedAt: now }).where(eq(orders.id, o.id));
    await tx.update(paymentProofs).set({ status: "rejected", rejectReason: reason, reviewedBy: admin.userId, reviewedAt: now }).where(and(eq(paymentProofs.orderId, o.id), eq(paymentProofs.status, "pending")));
    await recordAudit(tx as unknown as Deps["db"], { actorId: admin.userId, action: "payment.rejected", entityType: "order", entityId: o.id }); // alasan tidak ikut dicatat
    return { o, expiresAt };
  });
  await emailBuyer(deps, o.userId, "payment_rejected", { invoiceNumber: o.invoiceNumber, reason, deadline: formatWIB(expiresAt), link: `${deps.config.appUrl}/pesanan/${o.id}` });
  return { status: "MENUNGGU_PEMBAYARAN" as const, expiresAt };
}
