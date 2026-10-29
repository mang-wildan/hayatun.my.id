import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { licenseCodes, orderItems, orders, products } from "../../db/schema.js";
import { emailBuyer } from "../notifications/buyer.js";
import { transition } from "../orders/state-machine.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;
export interface Shortage { productId: string; name: string; missing: number }

const licensedItems = (q: Pick<Db, "select">, orderId: string) =>
  q.select({ id: orderItems.id, productId: orderItems.productId, name: orderItems.nameSnapshot, qty: orderItems.qty })
    .from(orderItems).innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), eq(products.isLicensed, true))).orderBy(asc(orderItems.id));

// Tepat satu kode per unit (F7.1): kode yang ditahan checkout dulu, kekurangannya dari stok tersedia. Mengembalikan yang masih kurang.
async function fill(tx: Tx, item: { id: string; productId: string; qty: number }, now: Date): Promise<number> {
  await tx.update(licenseCodes).set({ status: "assigned", assignedAt: now }).where(and(eq(licenseCodes.orderItemId, item.id), eq(licenseCodes.status, "reserved")));
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(licenseCodes).where(and(eq(licenseCodes.orderItemId, item.id), eq(licenseCodes.status, "assigned")));
  const need = item.qty - n;
  if (need <= 0) return 0;
  const spare = await tx.select({ id: licenseCodes.id }).from(licenseCodes)
    .where(and(eq(licenseCodes.productId, item.productId), eq(licenseCodes.status, "available"))).orderBy(asc(licenseCodes.id)).limit(need).for("update", { skipLocked: true });
  if (spare.length) await tx.update(licenseCodes).set({ status: "assigned", orderItemId: item.id, assignedAt: now }).where(inArray(licenseCodes.id, spare.map((s) => s.id)));
  return need - spare.length;
}

// Dipanggil di transaksi yang sama dengan perubahan status Lunas. Yang kurang ditetapkan sebagian dan dilaporkan (F7.7).
export async function assignLicenses(tx: Tx, orderId: string, now: Date): Promise<Shortage[]> {
  const short: Shortage[] = [];
  for (const item of await licensedItems(tx as unknown as Db, orderId)) {
    const missing = await fill(tx, item, now);
    if (missing > 0) short.push({ productId: item.productId, name: item.name, missing });
  }
  return short;
}

// Kode yang sudah ditetapkan dalam bentuk terbuka; hanya untuk pembeli pemilik pesanan dan emailnya
export async function licensesOf(deps: Pick<Deps, "db" | "crypto">, orderId: string) {
  const items = await licensedItems(deps.db, orderId);
  const codes = items.length
    ? await deps.db.select({ orderItemId: licenseCodes.orderItemId, codeEnc: licenseCodes.codeEnc }).from(licenseCodes)
      .where(and(inArray(licenseCodes.orderItemId, items.map((i) => i.id)), eq(licenseCodes.status, "assigned"))).orderBy(asc(licenseCodes.assignedAt), asc(licenseCodes.id))
    : [];
  return items.map((i) => {
    const mine = codes.filter((c) => c.orderItemId === i.id).map((c) => deps.crypto.decrypt(c.codeEnc));
    return { name: i.name, codes: mine, missing: Math.max(0, i.qty - mine.length) };
  });
}

// F7.7: setelah admin menambah kode, pesanan tertunda dilengkapi, yang paling lama dibayar dulu. Pesanan dikunci dan dicek ulang,
// jadi penambahan bersamaan tidak menetapkan atau mengirim email dua kali.
export async function deliverPendingLicenses(deps: Deps, productId: string): Promise<void> {
  const pending = await deps.db.selectDistinct({ id: orders.id, paidAt: orders.paidAt }).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.status, "LUNAS"), eq(orders.digitalStatus, "LISENSI_TERTUNDA"), eq(orderItems.productId, productId))).orderBy(asc(orders.paidAt), asc(orders.id));
  for (const { id } of pending) {
    const now = deps.now();
    const done = await deps.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (o.status !== "LUNAS" || o.digitalStatus !== "LISENSI_TERTUNDA") return null;
      if ((await assignLicenses(tx, o.id, now)).length) return null; // sebagian sudah ditetapkan; sisanya menunggu kode berikutnya
      const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "LICENSE_DELIVERED" });
      await tx.update(orders).set({ digitalStatus: next.digital, updatedAt: now }).where(eq(orders.id, o.id));
      return o;
    });
    if (done) await emailBuyer(deps, done.userId, "license_delivered", { invoiceNumber: done.invoiceNumber, licenses: await licensesOf(deps, done.id), link: `${deps.config.appUrl}/pesanan/${done.id}` });
  }
}
