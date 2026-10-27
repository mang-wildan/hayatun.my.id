import { addToCartSchema, MAX_CART_QTY, setCartQtySchema } from "@hayatun/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { cartItems, products } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { coverUrl } from "../catalog/service.js";
import { licenseCounts, stockOf } from "../products/stock.js";

type Deps = Pick<AppDeps, "db" | "now">;
type Product = typeof products.$inferSelect;
type Status = "ok" | "inactive" | "out_of_stock" | "exceeds_stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new HttpError(404, "Produk tidak ditemukan.", "PRODUCT_NOT_FOUND");
const notInCart = () => new HttpError(404, "Produk ini tidak ada di keranjangmu.", "ITEM_NOT_IN_CART");
const outOfStock = () => new HttpError(422, "Maaf, produk ini sedang habis.", "OUT_OF_STOCK");
const stockLimit = (n: number) => new HttpError(422, `Stok tersisa ${n}, jadi jumlahnya tidak bisa lebih dari itu.`, "STOCK_LIMIT");
const digitalQty = () => new HttpError(422, "Produk digital cukup dibeli satu kali.", "DIGITAL_QTY");

// Jumlah maksimal yang bisa dibeli sekarang: digital 1 (bila ada), fisik sebesar stok tersedia
async function limitOf(deps: Deps, p: Product): Promise<number> {
  const available = stockOf(p, await licenseCounts(deps.db, p.id)).available;
  if (p.type === "digital") return available === null || available > 0 ? 1 : 0;
  return Math.max(0, Math.min(MAX_CART_QTY, available ?? 0));
}

export async function getCart(deps: Deps, userId: string) {
  const rows = await deps.db
    .select({ qty: cartItems.qty, p: products })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.createdAt), asc(products.name));
  const licenses = await licenseCounts(deps.db);

  const items = rows.map(({ qty, p }) => {
    const available = stockOf(p, licenses).available;
    const maxQty = !p.active ? 0 : p.type === "digital" ? (available === 0 ? 0 : 1) : Math.min(MAX_CART_QTY, available ?? 0);
    const status: Status = !p.active ? "inactive" : maxQty === 0 ? "out_of_stock" : qty > maxQty ? "exceeds_stock" : "ok";
    return { productId: p.id, slug: p.slug, name: p.name, type: p.type, price: p.price, qty, maxQty, lineTotal: p.price * qty, coverUrl: coverUrl(p), status };
  });
  // yang tidak bisa dibeli tidak ikut dihitung dan mencegah checkout (F2.4)
  const subtotal = items.filter((i) => i.status === "ok").reduce((sum, i) => sum + i.lineTotal, 0);
  // F3.3: alamat dan nomor HP hanya diminta bila ada produk fisik
  const requiresAddress = items.some((i) => i.type === "physical");
  return { items, subtotal, canCheckout: items.length > 0 && items.every((i) => i.status === "ok"), requiresAddress };
}

async function activeProduct(deps: Deps, id: string): Promise<Product> {
  const [p] = await deps.db.select().from(products).where(and(eq(products.id, id), eq(products.active, true)));
  if (!p) throw notFound();
  return p;
}

export async function addItem(deps: Deps, userId: string, input: unknown) {
  const { productId, qty } = addToCartSchema.parse(input);
  const p = await activeProduct(deps, productId);
  if (p.type === "digital" && qty !== 1) throw digitalQty();
  const limit = await limitOf(deps, p);
  if (limit === 0) throw outOfStock();
  if (qty > limit) throw stockLimit(limit);

  if (p.type === "digital") {
    await deps.db.insert(cartItems).values({ userId, productId, qty: 1 }).onConflictDoNothing();
  } else {
    // batas diperiksa di dalam upsert, jadi dua penambahan bersamaan tidak bisa melewati stok (N24)
    const [row] = await deps.db
      .insert(cartItems)
      .values({ userId, productId, qty })
      .onConflictDoUpdate({
        target: [cartItems.userId, cartItems.productId],
        set: { qty: sql`${cartItems.qty} + excluded.qty`, updatedAt: deps.now() },
        setWhere: sql`${cartItems.qty} + excluded.qty <= ${limit}`,
      })
      .returning({ qty: cartItems.qty });
    if (!row) throw stockLimit(limit);
  }
  return getCart(deps, userId);
}

export async function setQty(deps: Deps, userId: string, productId: string, input: unknown) {
  const { qty } = setCartQtySchema.parse(input);
  const [row] = UUID.test(productId)
    ? await deps.db.select({ p: products, qty: cartItems.qty }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)))
    : [];
  if (!row) throw notInCart();
  if (!row.p.active) throw notFound();
  if (row.p.type === "digital" && qty !== 1) throw digitalQty();
  if (qty > row.qty) { // mengurangi selalu boleh, termasuk saat stok sudah di bawah jumlah keranjang
    const limit = await limitOf(deps, row.p);
    if (limit === 0) throw outOfStock();
    if (qty > limit) throw stockLimit(limit);
  }
  await deps.db.update(cartItems).set({ qty, updatedAt: deps.now() }).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
  return getCart(deps, userId);
}

export async function removeItem(deps: Deps, userId: string, productId: string) {
  if (UUID.test(productId)) await deps.db.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
}
