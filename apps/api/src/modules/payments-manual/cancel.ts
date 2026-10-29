import { and, eq, gt } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { orders } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import type { SessionUser } from "../auth/sessions.js";
import { releaseHold } from "../orders/hold.js";
import { transition } from "../orders/state-machine.js";
import { expired, findOwnOrder } from "./upload.js";

type Deps = Pick<AppDeps, "db" | "now">;
const notAllowed = () => new HttpError(409, "Pesanan ini sudah tidak bisa dibatalkan.", "CANCEL_NOT_ALLOWED");

// F4.6: selama Menunggu Pembayaran dan belum lewat batas; stok langsung dilepas di transaksi yang sama
export async function cancelByBuyer(deps: Deps, viewer: SessionUser, orderId: string) {
  const o = await findOwnOrder(deps, viewer, orderId);
  const now = deps.now();
  if (o.status === "KEDALUWARSA" || (o.status === "MENUNGGU_PEMBAYARAN" && now >= o.expiresAt)) throw expired();
  if (o.status !== "MENUNGGU_PEMBAYARAN") throw notAllowed();
  const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "CANCELLED_BY_BUYER" });
  return deps.db.transaction(async (tx) => {
    // syarat diulang di UPDATE: kalah cepat dari penyapu, unggah bukti, atau klik ganda → tidak ada pelepasan stok kedua
    const [done] = await tx.update(orders).set({ status: next.status, updatedAt: now })
      .where(and(eq(orders.id, o.id), eq(orders.status, "MENUNGGU_PEMBAYARAN"), gt(orders.expiresAt, now))).returning({ id: orders.id });
    if (!done) throw notAllowed();
    await releaseHold(tx, o.id);
    return { status: next.status };
  });
}
