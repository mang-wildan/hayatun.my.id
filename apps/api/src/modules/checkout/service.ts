import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { addresses, cartItems, licenseCodes, orderItems, orders, products, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { getCart } from "../cart/service.js";
import { nextInvoiceNumber } from "../invoices/numbering.js";
import { initialState } from "../orders/state-machine.js";
import { checkLowStock } from "../products/low-stock.js";
import { getRates } from "../shipping/index.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "now" | "config" | "logger" | "shipping" | "queue">;

const PAY_WINDOW_MS = 24 * 3600_000; // F4.2

const quoteSchema = z.object({
  addressId: z.guid().optional(),
  courier: z.string().trim().max(100).optional(),
  service: z.string().trim().max(100).optional(),
});
const checkoutSchema = quoteSchema.extend({
  expectedTotal: z.number({ error: "Total yang kamu lihat wajib dikirim." }).int().min(0),
});

const fieldError = (field: string, message: string) => new HttpError(422, message, "VALIDATION", { [field]: message });
const cartEmpty = () => new HttpError(409, "Keranjangmu masih kosong.", "CART_EMPTY");
const notReady = (items: { productId: string; name: string; status: string }[]) =>
  new HttpError(409, "Ada item yang tidak bisa dibeli. Cek keranjangmu dulu ya.", "CART_NOT_READY", undefined, { items });

// Pemeriksaan bersama rincian dan checkout: email terverifikasi, keranjang siap, alamat, dan ongkir (di luar transaksi; bisa makan 5 detik)
async function prepare(deps: Deps, userId: string, body: z.infer<typeof quoteSchema>, needService: boolean) {
  const [u] = await deps.db.select({ verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!u?.verified) throw new HttpError(403, "Verifikasi emailmu dulu ya sebelum checkout. Cek kotak masuk atau minta tautan baru.", "EMAIL_NOT_VERIFIED");

  const cart = await getCart(deps, userId);
  if (!cart.items.length) throw cartEmpty();
  const problems = cart.items.filter((i) => i.status !== "ok");
  if (problems.length) throw notReady(problems.map(({ productId, name, status }) => ({ productId, name, status })));

  const items = cart.items.map(({ productId, name, type, price, qty, lineTotal }) => ({ productId, name, type, price, qty, lineTotal }));
  if (!cart.requiresAddress) return { items, subtotal: cart.subtotal, requiresAddress: false, address: null, options: [], shipping: null };

  // F3.3: alamat dan ongkir hanya untuk keranjang yang berisi produk fisik
  if (!body.addressId) throw fieldError("addressId", "Pilih alamat pengiriman dulu ya.");
  const [address] = await deps.db.select().from(addresses).where(and(eq(addresses.id, body.addressId), eq(addresses.userId, userId)));
  if (!address) throw new HttpError(404, "Alamat tidak ditemukan.", "ADDRESS_NOT_FOUND");
  if (needService && !body.service) throw fieldError("service", "Pilih layanan pengiriman dulu ya.");

  const physicalIds = items.filter((i) => i.type === "physical").map((i) => i.productId);
  const weights = await deps.db.select({ id: products.id, weightG: products.weightG }).from(products).where(inArray(products.id, physicalIds));
  const weightG = items.reduce((sum, i) => sum + (weights.find((w) => w.id === i.productId)?.weightG ?? 0) * i.qty, 0);
  const options = await getRates(deps, { areaId: address.areaId, postalCode: address.postalCode, weightG });

  let shipping = null;
  if (body.service) {
    // harga ongkir selalu dari penyedia, tidak pernah dari browser
    shipping = options.find((o) => o.courier === body.courier && o.service === body.service) ?? null;
    if (!shipping) throw new HttpError(409, "Layanan pengiriman yang dipilih sudah tidak tersedia. Pilih lagi ya.", "SHIPPING_CHANGED");
  }
  return { items, subtotal: cart.subtotal, requiresAddress: true, address, options, shipping };
}

export async function quote(deps: Deps, userId: string, input: unknown) {
  const p = await prepare(deps, userId, quoteSchema.parse(input), false);
  const shippingCost = p.requiresAddress ? (p.shipping?.price ?? null) : 0;
  return {
    items: p.items,
    subtotal: p.subtotal,
    requiresAddress: p.requiresAddress,
    shippingOptions: p.options,
    shippingCost,
    total: shippingCost === null ? null : p.subtotal + shippingCost,
  };
}

export async function checkout(deps: Deps, userId: string, input: unknown) {
  const body = checkoutSchema.parse(input);
  const p = await prepare(deps, userId, body, true);
  const shippingCost = p.shipping?.price ?? 0;
  const now = deps.now();

  const result = await deps.db.transaction(async (tx) => {
    // satu checkout per pembeli pada satu waktu: klik ganda menunggu di sini lalu menemukan keranjang kosong
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const cart = await tx.select({ productId: cartItems.productId, qty: cartItems.qty }).from(cartItems).where(eq(cartItems.userId, userId));
    if (!cart.length) throw cartEmpty();

    // ARCHITECTURE §5.1: kunci produk diurutkan berdasarkan ID supaya dua checkout tidak saling mengunci
    const locked = await tx.select().from(products).where(inArray(products.id, cart.map((c) => c.productId))).orderBy(asc(products.id)).for("update");
    const byId = new Map(locked.map((pr) => [pr.id, pr]));
    const problems: { productId: string; name: string; status: string }[] = [];
    const codesFor = new Map<string, string[]>();
    for (const c of cart) {
      const pr = byId.get(c.productId)!;
      let status = !pr.active ? "inactive" : null;
      if (!status && pr.type === "physical") {
        const available = pr.stockQty - pr.stockReserved;
        status = available <= 0 ? "out_of_stock" : c.qty > available ? "exceeds_stock" : null;
      }
      if (!status && pr.isLicensed) {
        const codes = await tx.select({ id: licenseCodes.id }).from(licenseCodes)
          .where(and(eq(licenseCodes.productId, pr.id), eq(licenseCodes.status, "available"))).limit(c.qty).for("update", { skipLocked: true });
        if (codes.length < c.qty) status = "out_of_stock";
        else codesFor.set(pr.id, codes.map((x) => x.id));
      }
      if (status) problems.push({ productId: pr.id, name: pr.name, status });
    }
    if (problems.length) throw notReady(problems); // F3.8: tidak ada pesanan sebagian

    const subtotal = cart.reduce((sum, c) => sum + byId.get(c.productId)!.price * c.qty, 0);
    const total = subtotal + shippingCost;
    if (total !== body.expectedTotal) throw new HttpError(409, "Totalnya berubah sejak kamu lihat. Cek lagi rinciannya ya.", "TOTAL_CHANGED", undefined, { total });

    const state = initialState({ hasDigital: locked.some((pr) => pr.type === "digital"), hasPhysical: p.requiresAddress });
    const ship = p.address && p.shipping;
    const [order] = await tx.insert(orders).values({
      invoiceNumber: await nextInvoiceNumber(tx, now),
      userId,
      status: state.status,
      digitalStatus: state.digital,
      physicalStatus: state.physical,
      subtotal,
      shippingCost,
      total,
      expiresAt: new Date(now.getTime() + PAY_WINDOW_MS),
      ...(ship && {
        shipRecipientEnc: deps.crypto.encrypt(deps.crypto.decrypt(p.address!.recipientEnc)), // enkripsi ulang: salinan berdiri sendiri
        shipPhoneEnc: deps.crypto.encrypt(deps.crypto.decrypt(p.address!.phoneEnc)),
        shipAddressEnc: deps.crypto.encrypt(deps.crypto.decrypt(p.address!.addressEnc)),
        shipAreaId: p.address!.areaId,
        shipPostalCode: p.address!.postalCode,
        courier: p.shipping!.courier,
        courierService: p.shipping!.service,
      }),
      createdAt: now,
      updatedAt: now,
    }).returning({ id: orders.id, invoiceNumber: orders.invoiceNumber, expiresAt: orders.expiresAt });

    const inserted = await tx.insert(orderItems).values(cart.map((c) => {
      const pr = byId.get(c.productId)!;
      return { orderId: order.id, productId: pr.id, productType: pr.type, nameSnapshot: pr.name, unitPrice: pr.price, qty: c.qty };
    })).returning({ id: orderItems.id, productId: orderItems.productId });

    for (const it of inserted) {
      const codes = codesFor.get(it.productId);
      if (codes) await tx.update(licenseCodes).set({ status: "reserved", orderItemId: it.id }).where(inArray(licenseCodes.id, codes));
      const c = cart.find((x) => x.productId === it.productId)!;
      if (byId.get(it.productId)!.type === "physical") {
        await tx.update(products).set({ stockReserved: sql`${products.stockReserved} + ${c.qty}` }).where(eq(products.id, it.productId));
      }
    }
    await tx.delete(cartItems).where(eq(cartItems.userId, userId));
    return { order, total, productIds: locked.filter((pr) => pr.type === "physical" || pr.isLicensed).map((pr) => pr.id) };
  });

  for (const id of result.productIds) await checkLowStock(deps, id); // F9.5
  return { orderId: result.order.id, invoiceNumber: result.order.invoiceNumber, total: result.total, expiresAt: result.order.expiresAt };
}
