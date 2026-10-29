import { asc, desc, eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { orderItems, orders } from "../../db/schema.js";
import type { SessionUser } from "../auth/sessions.js";
import { findOwnOrder } from "../payments-manual/upload.js";

type Deps = Pick<AppDeps, "db" | "now">;
const LIMIT = 50;

// batas bayar sudah lewat tapi tugas kedaluwarsa belum jalan: tampil sebagai kedaluwarsa (F4.8)
const effective = (deps: Deps, o: { status: string; expiresAt: Date }) => (o.status === "MENUNGGU_PEMBAYARAN" && deps.now() >= o.expiresAt ? "KEDALUWARSA" : o.status);

// F6: pesanan milik pembeli sendiri, terbaru dulu; admin pun hanya melihat pesanannya sendiri
export async function listMyOrders(deps: Deps, viewer: SessionUser) {
  const rows = await deps.db.select().from(orders).where(eq(orders.userId, viewer.userId)).orderBy(desc(orders.createdAt), desc(orders.id)).limit(LIMIT);
  return { orders: rows.map((o) => ({ orderId: o.id, invoiceNumber: o.invoiceNumber, createdAt: o.createdAt, total: o.total, status: effective(deps, o), digitalStatus: o.digitalStatus, physicalStatus: o.physicalStatus })) };
}

// Alamat dan kontak sengaja tidak ikut; pembeli melihatnya di invoice
export async function getMyOrder(deps: Deps, viewer: SessionUser, orderId: string) {
  const o = await findOwnOrder(deps, viewer, orderId);
  const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.id));
  return {
    orderId: o.id, invoiceNumber: o.invoiceNumber, status: effective(deps, o), digitalStatus: o.digitalStatus, physicalStatus: o.physicalStatus,
    subtotal: o.subtotal, shippingCost: o.shippingCost, total: o.total, createdAt: o.createdAt, paidAt: o.paidAt,
    items: items.map((i) => ({ name: i.nameSnapshot, type: i.productType, qty: i.qty, unitPrice: i.unitPrice })),
    shipping: o.courier ? { courier: o.courier, service: o.courierService, trackingNumber: o.trackingNumber } : null,
  };
}
