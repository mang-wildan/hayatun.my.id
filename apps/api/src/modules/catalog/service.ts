import { and, desc, eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { products } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { coverFile } from "../products/service.js";
import { licenseCounts, stockOf } from "../products/stock.js";

type Deps = Pick<AppDeps, "db">;
type Product = typeof products.$inferSelect;

const SLUG = /^[a-z0-9-]{1,120}$/;
const notFound = () => new HttpError(404, "Produk tidak ditemukan.", "PRODUCT_NOT_FOUND");

const coverUrl = (p: Product) => (p.coverKey ? `/api/catalog/${p.slug}/cover?v=${p.coverUpdatedAt?.getTime() ?? 0}` : null);

// Publik hanya boleh tahu tersedia atau Habis, bukan jumlah stok (F2.3)
const isAvailable = (available: number | null) => available === null || available > 0;

const card = (p: Product, available: boolean) => ({ id: p.id, slug: p.slug, name: p.name, type: p.type, price: p.price, available, coverUrl: coverUrl(p) });

export async function listCatalog(deps: Deps) {
  const rows = await deps.db.select().from(products).where(eq(products.active, true)).orderBy(desc(products.createdAt));
  const licenses = await licenseCounts(deps.db);
  return { products: rows.map((p) => card(p, isAvailable(stockOf(p, licenses).available))) };
}

async function activeBySlug(deps: Deps, slug: string): Promise<Product> {
  if (!SLUG.test(slug)) throw notFound();
  const [p] = await deps.db.select().from(products).where(and(eq(products.slug, slug), eq(products.active, true)));
  if (!p) throw notFound();
  return p;
}

export async function getCatalogProduct(deps: Deps, slug: string) {
  const p = await activeBySlug(deps, slug);
  const available = isAvailable(stockOf(p, await licenseCounts(deps.db, p.id)).available);
  return { ...card(p, available), description: p.description, weightG: p.type === "physical" ? p.weightG : null };
}

export async function getCatalogCover(deps: Deps, slug: string) {
  const p = await activeBySlug(deps, slug);
  if (!p.coverKey) throw new HttpError(404, "Sampul tidak ditemukan.", "COVER_NOT_FOUND");
  // sampul ikut tampil di halaman publik, jadi boleh di-cache; alamat ?v= berubah saat sampul diganti
  return { key: p.coverKey, ...coverFile(p.coverKey), cacheControl: "public, max-age=3600" };
}
