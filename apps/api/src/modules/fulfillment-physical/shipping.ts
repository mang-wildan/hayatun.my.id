import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import { orderItems, orders } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";
import type { SessionUser } from "../auth/sessions.js";
import { emailBuyer } from "../notifications/buyer.js";
import { transition } from "../orders/state-machine.js";
import { findOwnOrder } from "../payments-manual/upload.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;
type Tx = Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const state = (o: { status: "LUNAS" | string; digitalStatus: string; physicalStatus: string }) => ({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }) as Parameters<typeof transition>[0];
// F8.4. Kolom kosong dibaca dulu (min(1)) supaya pesannya "wajib diisi", bukan "minimal 8"
const trackingSchema = z.object({
  trackingNumber: z.string({ error: "Nomor resi wajib diisi." }).trim().min(1, "Nomor resi wajib diisi.").min(8, "Nomor resi minimal 8 karakter.").max(40, "Nomor resi maksimal 40 karakter."),
});

// F8.1. Alamat dan telepon pembeli dibuka di sini, jadi tiap pesanan yang ditampilkan dicatat di log (N28, F15.3).
export async function listShipments(deps: Deps, admin: SessionUser) {
  const rows = await deps.db.select().from(orders).where(and(eq(orders.status, "LUNAS"), inArray(orders.physicalStatus, ["DIPROSES", "DIKIRIM"]))).orderBy(asc(orders.paidAt), asc(orders.id));
  const lines = rows.length ? await deps.db.select().from(orderItems).where(and(inArray(orderItems.orderId, rows.map((o) => o.id)), eq(orderItems.productType, "physical"))).orderBy(asc(orderItems.id)) : [];
  const shipped = rows.filter((o) => o.physicalStatus === "DIKIRIM").sort((a, b) => b.shippedAt!.getTime() - a.shippedAt!.getTime());
  const items = [...rows.filter((o) => o.physicalStatus === "DIPROSES"), ...shipped].map((o) => ({
    orderId: o.id, invoiceNumber: o.invoiceNumber, paidAt: o.paidAt, physicalStatus: o.physicalStatus, courier: o.courier, service: o.courierService,
    recipient: deps.crypto.decrypt(o.shipRecipientEnc!), phone: deps.crypto.decrypt(o.shipPhoneEnc!), address: deps.crypto.decrypt(o.shipAddressEnc!),
    areaId: o.shipAreaId, postalCode: o.shipPostalCode, trackingNumber: o.trackingNumber, shippedAt: o.shippedAt,
    items: lines.filter((l) => l.orderId === o.id).map((l) => ({ name: l.nameSnapshot, qty: l.qty })),
  }));
  for (const i of items) await recordAudit(deps.db, { actorId: admin.userId, action: "order.address_viewed", entityType: "order", entityId: i.orderId });
  return { items };
}

// F8.2 (Diproses menjadi Dikirim) dan F8.5 (resi diperbaiki selama Dikirim). Baris pesanan dikunci supaya dua admin tidak mengirim dua kali.
export async function setTracking(deps: Deps, admin: SessionUser, orderId: string, input: unknown) {
  const { trackingNumber } = trackingSchema.parse(input);
  const now = deps.now();
  const result = await deps.db.transaction(async (tx: Tx) => {
    const [o] = UUID.test(orderId) ? await tx.select().from(orders).where(eq(orders.id, orderId)).for("update") : [];
    if (!o) throw new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");
    const entry = { actorId: admin.userId, entityType: "order", entityId: o.id };
    if (o.status === "LUNAS" && o.physicalStatus === "DIKIRIM") {
      if (o.trackingNumber === trackingNumber) return { o, kind: null };
      await tx.update(orders).set({ trackingNumber, updatedAt: now }).where(eq(orders.id, o.id));
      await recordAudit(tx as unknown as Deps["db"], { ...entry, action: "order.tracking_changed", details: { old: o.trackingNumber ?? "", new: trackingNumber } });
      return { o, kind: "tracking_updated" as const };
    }
    const next = transition(state(o), { type: "SHIPPED" });
    await tx.update(orders).set({ physicalStatus: next.physical, trackingNumber, shippedAt: now, updatedAt: now }).where(eq(orders.id, o.id));
    await recordAudit(tx as unknown as Deps["db"], { ...entry, action: "order.shipped", details: { trackingNumber } });
    return { o, kind: "order_shipped" as const };
  });
  if (result.kind) await emailBuyer(deps, result.o.userId, result.kind, { invoiceNumber: result.o.invoiceNumber, courier: [result.o.courier, result.o.courierService].filter(Boolean).join(" "), trackingNumber, link: `${deps.config.appUrl}/pesanan/${result.o.id}` });
  return { physicalStatus: "DIKIRIM" as const, trackingNumber };
}

// F8.3: pembeli menekan "Pesanan diterima"
export async function markReceived(deps: Deps, viewer: SessionUser, orderId: string) {
  await findOwnOrder(deps, viewer, orderId);
  await deps.db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    const next = transition(state(o), { type: "RECEIVED" });
    await tx.update(orders).set({ physicalStatus: next.physical, updatedAt: deps.now() }).where(eq(orders.id, o.id));
  });
  return { physicalStatus: "DITERIMA" as const };
}

