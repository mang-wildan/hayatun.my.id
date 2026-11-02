import { eq, sql } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { orderItems, orders, products } from "../../db/schema.js";
import { assignLicenses, licensesOf } from "../fulfillment-digital/licenses.js";
import { emailBuyer } from "../notifications/buyer.js";
import { notifyAdmins } from "../notifications/admins.js";
import { transition } from "../orders/state-machine.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Order = typeof orders.$inferSelect;
type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger">;

// Langkah bersama semua jalur Menunggu → Lunas (F5.2, F14.2): kode lisensi, status, stok ditahan → terjual. Dipanggil di dalam transaksi
// yang sudah mengunci baris pesanan. Bukti bayar dan log aktivitas diurus pemanggilnya, karena berbeda antara transfer dan gateway.
export async function settleOrder(tx: Tx, o: Order, { event, verifiedBy, now }: { event: "PAYMENT_ACCEPTED" | "GATEWAY_PAID"; verifiedBy: string | null; now: Date }) {
  const short = await assignLicenses(tx, o.id, now); // F7.1, F7.7: kurang kode tidak menggagalkan Lunas
  const licensePending = short.length > 0;
  const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, event === "GATEWAY_PAID" ? { type: "GATEWAY_PAID", licensePending } : { type: "PAYMENT_ACCEPTED", licensePending });
  await tx.update(orders).set({ status: next.status, digitalStatus: next.digital, physicalStatus: next.physical, verifiedBy, paidAt: now, updatedAt: now }).where(eq(orders.id, o.id));
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  for (const i of items.filter((x) => x.productType === "physical")) {
    await tx.update(products).set({ stockQty: sql`${products.stockQty} - ${i.qty}`, stockReserved: sql`${products.stockReserved} - ${i.qty}`, stockSold: sql`${products.stockSold} + ${i.qty}` }).where(eq(products.id, i.productId));
  }
  return short;
}

// Setelah commit: email pembeli (dengan kode lisensi bila ada) dan kabar ke admin untuk kode yang kurang
export async function announcePaid(deps: Deps, o: Pick<Order, "id" | "userId" | "invoiceNumber">, short: Awaited<ReturnType<typeof assignLicenses>>) {
  const licenses = await licensesOf(deps, o.id);
  await emailBuyer(deps, o.userId, "payment_accepted", { invoiceNumber: o.invoiceNumber, link: `${deps.config.appUrl}/pesanan/${o.id}`, ...(licenses.length && { licenses }) });
  for (const s of short) await notifyAdmins(deps, "license_pending", { invoiceNumber: o.invoiceNumber, productName: s.name, missing: s.missing, link: `${deps.config.appUrl}/admin/produk/${s.productId}` });
}
