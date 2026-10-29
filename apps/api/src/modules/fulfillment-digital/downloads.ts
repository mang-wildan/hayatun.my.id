import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Response } from "express";
import type { AppDeps } from "../../app.js";
import { orderItems, orders, productFiles } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import type { SessionUser } from "../auth/sessions.js";
import { findOwnOrder, notFound } from "../payments-manual/upload.js";

type Deps = Pick<AppDeps, "db" | "config" | "storage" | "now">;

const TTL_MS = 15 * 60_000; // F7.3
const invalid = () => new HttpError(403, "Tautan unduhan sudah tidak berlaku. Buat tautan baru dari akunmu ya.", "DOWNLOAD_LINK_INVALID"); // satu pesan untuk semua penyebab (F7.6)
const notAllowed = () => new HttpError(409, "Unduhan untuk pesanan ini tidak tersedia.", "DOWNLOAD_NOT_ALLOWED");

// Token = HMAC atas (akun, file, kedaluwarsa); awalan "download:" memisahkannya dari pemakaian kunci yang sama di tempat lain
const mac = (secret: Buffer, payload: string) => createHmac("sha256", secret).update(`download:${payload}`).digest("base64url");
const sign = (secret: Buffer, userId: string, fileId: string, exp: number) => {
  const payload = Buffer.from(JSON.stringify([userId, fileId, exp])).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
};
function verify(secret: Buffer, token: string): [string, string, number] | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const [u, f, e] = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof u === "string" && typeof f === "string" && typeof e === "number" ? [u, f, e] : null;
  } catch { return null; }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const ACCESS = [eq(orders.status, "LUNAS"), ne(orders.digitalStatus, "DICABUT")] as const; // F7.2, F7.8

async function ownOrderWithAccess(deps: Deps, viewer: SessionUser, orderId: string) {
  const o = await findOwnOrder(deps, viewer, orderId);
  if (o.status !== "LUNAS" || o.digitalStatus === "DICABUT") throw notAllowed();
  return o;
}

// F7.2: file dan tautan tiap produk digital di pesanan; lokasi simpan dan alamat tautan tidak ikut
export async function listFiles(deps: Deps, viewer: SessionUser, orderId: string) {
  const o = await ownOrderWithAccess(deps, viewer, orderId);
  const rows = await deps.db.select({ product: orderItems.nameSnapshot, itemId: orderItems.id, id: productFiles.id, kind: productFiles.kind, filename: productFiles.filename, sizeBytes: productFiles.sizeBytes })
    .from(orderItems).innerJoin(productFiles, eq(productFiles.productId, orderItems.productId)).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.id), asc(productFiles.createdAt), asc(productFiles.id));
  const items = new Map<string, { name: string; files: { id: string; kind: string; filename: string; sizeBytes: number | null }[] }>();
  for (const { product, itemId, ...f } of rows) (items.get(itemId) ?? items.set(itemId, { name: product, files: [] }).get(itemId)!).files.push(f);
  return { items: [...items.values()] };
}

// F7.3: tombol Unduh. Tautan eksternal (F7.4) diberikan langsung: alamatnya sama untuk semua pembeli, jadi token tidak melindungi apa pun.
export async function createDownload(deps: Deps, viewer: SessionUser, orderId: string, fileId: string) {
  const o = await ownOrderWithAccess(deps, viewer, orderId);
  const [f] = isUuid(fileId)
    ? await deps.db.select({ id: productFiles.id, kind: productFiles.kind, url: productFiles.url }).from(productFiles)
      .innerJoin(orderItems, and(eq(orderItems.productId, productFiles.productId), eq(orderItems.orderId, o.id))).where(eq(productFiles.id, fileId))
    : [];
  if (!f) throw notFound();
  if (f.kind === "link") return { url: f.url!, external: true as const };
  const exp = deps.now().getTime() + TTL_MS;
  return { url: `/api/downloads/${sign(deps.config.sessionSecret, viewer.userId, f.id, exp)}`, expiresAt: new Date(exp).toISOString() };
}

// ARCHITECTURE §5.5: token sah, milik sesi ini, belum lewat 15 menit, dan hak akses pesanan dicek ulang (pencabutan langsung berlaku)
export async function openDownload(deps: Deps, viewer: SessionUser, token: string, res: Response) {
  const t = verify(deps.config.sessionSecret, token);
  if (!t || t[0] !== viewer.userId || deps.now().getTime() >= t[2] || !isUuid(t[1])) throw invalid();
  const [f] = await deps.db.select({ storageKey: productFiles.storageKey, filename: productFiles.filename, contentType: productFiles.contentType }).from(productFiles)
    .innerJoin(orderItems, eq(orderItems.productId, productFiles.productId)).innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(productFiles.id, t[1]), eq(productFiles.kind, "file"), eq(orders.userId, viewer.userId), ...ACCESS)).limit(1);
  if (!f?.storageKey) throw invalid();
  await deps.storage.send(res, f.storageKey, { filename: f.filename, contentType: f.contentType ?? "application/octet-stream" });
}
