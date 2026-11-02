import { formatRupiah } from "@hayatun/shared";
import { eq } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";
import type { AppDeps } from "../../app.js";
import { orders, paymentEvents } from "../../db/schema.js";
import { recordAudit } from "../audit/index.js";
import { notifyAdmins } from "../notifications/admins.js";
import { announcePaid, settleOrder } from "../payments-manual/settle.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "gateway" | "config" | "logger" | "now">;
type Order = typeof orders.$inferSelect;

// Alasan pembayaran tidak bisa diselesaikan otomatis, atau null bila boleh Lunas (F14.2, F14.5, F14.6)
function reviewReason(o: Order, amount: number): string | null {
  if (o.paymentMethod !== "gateway") return "Pembayaran gateway masuk untuk pesanan yang dibayar lewat transfer bank (bukan pesanan gateway).";
  if (o.status === "LUNAS") return "Pembayaran gateway masuk lagi untuk pesanan yang sudah lunas (kemungkinan dibayar dua kali).";
  if (o.status === "KEDALUWARSA" || o.status === "DIBATALKAN" || o.status === "DIKEMBALIKAN") {
    const state = { KEDALUWARSA: "kedaluwarsa", DIBATALKAN: "dibatalkan", DIKEMBALIKAN: "dikembalikan" }[o.status];
    return `Pembayaran gateway masuk setelah pesanan ${state}. Stok dan kode lisensi tidak ditetapkan otomatis.`;
  }
  if (o.status !== "MENUNGGU_PEMBAYARAN") return `Pembayaran gateway masuk saat status pesanan ${o.status}, yang tidak menunggu pembayaran gateway.`;
  if (amount !== o.total) return `Nominal dari gateway (${formatRupiah(amount)}) berbeda dengan total pesanan (${formatRupiah(o.total)}).`;
  return null;
}

// ARCHITECTURE §5.7. Kejadian dan perubahan pesanan satu transaksi: gagal di tengah berarti tidak ada yang tersimpan dan kiriman ulang gateway
// diproses dari awal. Insert pertama pada ID unik membuat kejadian yang sama (juga yang bersamaan) diproses tepat sekali (F14.4).
export async function handleGatewayWebhook(deps: Deps, rawBody: Buffer, headers: IncomingHttpHeaders): Promise<void> {
  const event = deps.gateway.verifyWebhook(rawBody, headers); // 401/400 sebelum menyimpan apa pun
  const now = deps.now();
  let after: (() => Promise<void>) | undefined;

  await deps.db.transaction(async (tx) => {
    const [row] = await tx.insert(paymentEvents).values({ gatewayEventId: event.eventId, payload: event, outcome: "received" }).onConflictDoNothing().returning({ id: paymentEvents.id });
    if (!row) return; // sudah pernah diterima
    const finish = (outcome: string, orderId: string | null) => tx.update(paymentEvents).set({ outcome, orderId, processedAt: now }).where(eq(paymentEvents.id, row.id));

    const [o] = await tx.select().from(orders).where(eq(orders.gatewayReference, event.reference)).for("update");
    if (!o) { deps.logger.warn({ eventType: event.type }, "kejadian gateway untuk referensi yang tidak dikenal"); return void await finish("unknown_order", null); }
    if (event.type !== "payment.succeeded") return void await finish("ignored", o.id); // kedaluwarsa yang kita tentukan sendiri (F14.7)

    const reason = reviewReason(o, event.amount);
    if (reason) {
      await tx.update(orders).set({ reviewReason: o.reviewReason ? `${o.reviewReason} ${reason}` : reason, updatedAt: now }).where(eq(orders.id, o.id));
      await recordAudit(tx as unknown as Deps["db"], { actorId: null, action: "payment.gateway_review", entityType: "order", entityId: o.id, details: { reason } });
      await finish("review", o.id);
      after = () => notifyAdmins(deps, "payment_review", { invoiceNumber: o.invoiceNumber, reason, link: `${deps.config.appUrl}/admin/pesanan` });
      return;
    }

    const short = await settleOrder(tx, o, { event: "GATEWAY_PAID", verifiedBy: null, now });
    await recordAudit(tx as unknown as Deps["db"], { actorId: null, action: "payment.gateway_paid", entityType: "order", entityId: o.id, details: { note: "Lunas via gateway" } });
    await finish("paid", o.id);
    after = () => announcePaid(deps, o, short);
  });
  await after?.(); // email hanya sesudah commit
}
