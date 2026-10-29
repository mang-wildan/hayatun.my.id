import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import { orderItems, orders, products } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";
import type { SessionUser } from "../auth/sessions.js";
import { emailBuyer } from "../notifications/buyer.js";
import { transition } from "../orders/state-machine.js";
import { checkLowStock } from "../products/low-stock.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const schema = z.object({
  status: z.enum(["DIBATALKAN", "DIKEMBALIKAN"], { error: "Pilih Dibatalkan atau Dikembalikan." }),
  note: z.string({ error: "Catatan wajib diisi." }).trim().min(1, "Catatan wajib diisi.").max(500, "Catatan maksimal 500 karakter."), // F10.4
});

// F10.1-F10.3, F7.8. Catatan hanya masuk log aktivitas (internal), tidak ke email pembeli.
export async function cancelOrder(deps: Deps, admin: SessionUser, orderId: string, input: unknown) {
  const { status, note } = schema.parse(input);
  const now = deps.now();
  const { o, restored } = await deps.db.transaction(async (tx) => {
    const [o] = UUID.test(orderId) ? await tx.select().from(orders).where(eq(orders.id, orderId)).for("update") : [];
    if (!o) throw new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");
    const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "CANCELLED_BY_ADMIN", refunded: status === "DIKEMBALIKAN" });
    await tx.update(orders).set({ status: next.status, digitalStatus: next.digital, updatedAt: now }).where(eq(orders.id, o.id));
    // fisik belum dikirim: stok kembali (kebalikan dari saat pembayaran diterima); sudah dikirim: admin menambahkannya manual (F10.3). Kode lisensi tidak kembali (F7.8).
    const restored: string[] = [];
    if (o.physicalStatus === "DIPROSES") {
      for (const i of await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id))) {
        if (i.productType !== "physical") continue;
        await tx.update(products).set({ stockQty: sql`${products.stockQty} + ${i.qty}`, stockSold: sql`${products.stockSold} - ${i.qty}` }).where(eq(products.id, i.productId));
        restored.push(i.productId);
      }
    }
    await recordAudit(tx as unknown as Deps["db"], { actorId: admin.userId, action: status === "DIKEMBALIKAN" ? "order.refunded" : "order.cancelled", entityType: "order", entityId: o.id, details: { note } });
    return { o, restored };
  });
  for (const id of restored) await checkLowStock(deps, id); // stok pulih: atur ulang penanda
  await emailBuyer(deps, o.userId, status === "DIKEMBALIKAN" ? "order_refunded" : "order_cancelled", { invoiceNumber: o.invoiceNumber, link: `${deps.config.appUrl}/pesanan/${o.id}` });
  return { status };
}
