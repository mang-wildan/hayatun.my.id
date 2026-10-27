import type { OrderStatus } from "@hayatun/shared";
import { asc, eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { orderItems, orders, storeSettings, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";
import type { SessionUser } from "../auth/sessions.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "config">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// F6.6: bukan pemilik, tidak ada, atau id ngawur dijawab sama persis
const notFound = () => new HttpError(404, "Invoice tidak ditemukan.", "INVOICE_NOT_FOUND");

// F6.2 hanya mengenal tiga status invoice
const INVOICE_STATUS: Record<OrderStatus, string> = {
  MENUNGGU_PEMBAYARAN: "Belum Lunas", MENUNGGU_VERIFIKASI: "Belum Lunas", LUNAS: "Lunas",
  KEDALUWARSA: "Dibatalkan", DIBATALKAN: "Dibatalkan", DIKEMBALIKAN: "Dibatalkan",
};

// Isi invoice dibaca dari salinan di pesanan, bukan dari produk atau alamat saat ini (F6.5). Tanpa PPN (F6.3).
export async function getInvoice(deps: Deps, viewer: SessionUser, orderId: string) {
  const [o] = UUID.test(orderId) ? await deps.db.select().from(orders).where(eq(orders.id, orderId)) : [];
  if (!o || (o.userId !== viewer.userId && viewer.role !== "admin")) throw notFound();
  // invoice memuat data pribadi pembeli, jadi pembukaan oleh admin dicatat (F15.3)
  if (viewer.role === "admin" && o.userId !== viewer.userId) await recordAudit(deps.db, { actorId: viewer.userId, action: "invoice.viewed", entityType: "order", entityId: o.id });

  const [buyer] = await deps.db.select({ nameEnc: users.nameEnc, emailEnc: users.emailEnc }).from(users).where(eq(users.id, o.userId));
  const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.nameSnapshot));
  const [store] = await deps.db.select({ value: storeSettings.value }).from(storeSettings).where(eq(storeSettings.key, "store"));
  const open = (v: string | null) => (v ? deps.crypto.decrypt(v) : null);

  return {
    number: o.invoiceNumber,
    issuedAt: o.createdAt,
    store: store?.value ?? { name: "Hayatun", email: deps.config.emailFrom }, // sampai pengaturan toko dibuat (T48)
    buyer: { name: open(buyer.nameEnc), email: deps.crypto.decrypt(buyer.emailEnc) },
    shippingAddress: o.shipAddressEnc
      ? { recipient: open(o.shipRecipientEnc), phone: open(o.shipPhoneEnc), address: open(o.shipAddressEnc), postalCode: o.shipPostalCode, courier: o.courier, service: o.courierService }
      : null,
    items: items.map((i) => ({ name: i.nameSnapshot, qty: i.qty, unitPrice: i.unitPrice, subtotal: i.unitPrice * i.qty })),
    subtotal: o.subtotal,
    shippingCost: o.shippingCost,
    total: o.total,
    paymentMethod: o.paymentMethod === "manual" ? "Transfer bank" : "Payment gateway",
    status: INVOICE_STATUS[o.status],
    paidAt: null, // kolom tanggal lunas ditambah bersama verifikasi pembayaran (T35)
  };
}
