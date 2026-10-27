import { LOW_STOCK_THRESHOLD } from "@hayatun/shared";
import { and, eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { products } from "../../db/schema.js";
import { notifyAdmins } from "../notifications/admins.js";
import { licenseCounts, stockOf } from "./stock.js";

export { LOW_STOCK_THRESHOLD };

// F9.5: admin dikabari sekali setiap stok tersedia turun ke ambang atau di bawahnya; penanda diatur ulang saat stok pulih di atas ambang.
// Dipanggil setelah stok berkurang (ubah stok, dan pemesanan di T28) atau pulih (kode lisensi ditambah).
export async function checkLowStock(deps: Pick<AppDeps, "db" | "queue" | "crypto" | "config">, productId: string): Promise<void> {
  const [p] = await deps.db.select().from(products).where(eq(products.id, productId));
  if (!p) return;
  const available = stockOf(p, await licenseCounts(deps.db, p.id)).available;
  if (available === null) return;

  if (available > LOW_STOCK_THRESHOLD) {
    if (p.lowStockNotified) await deps.db.update(products).set({ lowStockNotified: false }).where(eq(products.id, p.id));
    return;
  }
  // penanda dipasang secara atomik: dari beberapa pemanggil bersamaan hanya satu yang mengirim
  const [claimed] = await deps.db
    .update(products)
    .set({ lowStockNotified: true })
    .where(and(eq(products.id, p.id), eq(products.lowStockNotified, false)))
    .returning({ id: products.id });
  if (claimed) await notifyAdmins(deps, "low_stock", { productName: p.name, available, link: `${deps.config.appUrl}/admin/produk/${p.id}` });
}
