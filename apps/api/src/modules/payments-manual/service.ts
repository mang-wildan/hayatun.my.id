import { eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { orders } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import type { SessionUser } from "../auth/sessions.js";
import { readBankAccount, readStore } from "../settings/index.js";

type Deps = Pick<AppDeps, "db" | "config" | "now">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// pemilik atau admin; selain itu, tidak ada, dan id ngawur dijawab sama
const notFound = () => new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");

// F4.1: rekening, total, dan batas waktu. Batas 24 jam hanya untuk unggah bukti, bukan untuk verifikasi admin (F4.2).
export async function getPaymentInstructions(deps: Deps, viewer: SessionUser, orderId: string) {
  const [o] = UUID.test(orderId) ? await deps.db.select().from(orders).where(eq(orders.id, orderId)) : [];
  if (!o || (o.userId !== viewer.userId && viewer.role !== "admin")) throw notFound();
  const expired = deps.now() >= o.expiresAt;
  return {
    orderId: o.id,
    invoiceNumber: o.invoiceNumber,
    status: o.status,
    total: o.total,
    expiresAt: o.expiresAt,
    expired,
    canUploadProof: o.status === "MENUNGGU_PEMBAYARAN" && !expired,
    bankAccount: await readBankAccount(deps),
    store: await readStore(deps),
  };
}
