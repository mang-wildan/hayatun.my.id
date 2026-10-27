import { count, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { licenseCodes, type products } from "../../db/schema.js";

type Product = typeof products.$inferSelect;

export interface Stock { available: number | null; reserved: number; sold: number }

type LicenseCounts = Map<string, { available: number; reserved: number; assigned: number }>;

// Jumlah kode per status untuk satu produk, atau semua produk bila `productId` kosong
export async function licenseCounts(db: Db, productId?: string): Promise<LicenseCounts> {
  const rows = await db
    .select({ id: licenseCodes.productId, status: licenseCodes.status, n: count() })
    .from(licenseCodes)
    .where(productId ? eq(licenseCodes.productId, productId) : undefined)
    .groupBy(licenseCodes.productId, licenseCodes.status);
  const out: LicenseCounts = new Map();
  for (const r of rows) out.set(r.id, { ...(out.get(r.id) ?? { available: 0, reserved: 0, assigned: 0 }), [r.status]: r.n });
  return out;
}

// Tersedia, ditahan, terjual (F9.4). Fisik dari kolom stok; berlisensi dari status kode; digital biasa tanpa batas.
export function stockOf(p: Product, licenses: LicenseCounts): Stock {
  if (p.type === "physical") return { available: p.stockQty - p.stockReserved, reserved: p.stockReserved, sold: p.stockSold };
  if (!p.isLicensed) return { available: null, reserved: 0, sold: p.stockSold };
  const c = licenses.get(p.id) ?? { available: 0, reserved: 0, assigned: 0 };
  return { available: c.available, reserved: c.reserved, sold: c.assigned };
}

