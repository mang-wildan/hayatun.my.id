import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { licenseCodes, orderItems, products } from "../../db/schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Melepas stok fisik dan kode lisensi yang ditahan pesanan (F4.4, F4.6).
// Panggil hanya di transaksi yang sama dengan perubahan status yang berhasil, supaya tidak pernah dilepas dua kali.
export async function releaseHold(tx: Tx, orderId: string): Promise<void> {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const i of items.filter((x) => x.productType === "physical")) {
    await tx.update(products).set({ stockReserved: sql`${products.stockReserved} - ${i.qty}` }).where(eq(products.id, i.productId));
  }
  if (items.length) {
    await tx.update(licenseCodes).set({ status: "available", orderItemId: null })
      .where(and(eq(licenseCodes.status, "reserved"), inArray(licenseCodes.orderItemId, items.map((i) => i.id))));
  }
}
