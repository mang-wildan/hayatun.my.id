import { and, eq, gt } from "drizzle-orm";
import type { Request } from "express";
import type { AppDeps } from "../../app.js";
import { orders, paymentProofs } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import type { SessionUser } from "../auth/sessions.js";
import { transition } from "../orders/state-machine.js";
import { readUpload } from "../storage/index.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "storage" | "now">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROOF = { allowed: ["jpg", "png", "pdf"], maxBytes: 5 * 1024 * 1024 } as const; // F4.3
const MIME = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" } as const;

export const notFound = () => new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");
export const expired = () => new HttpError(409, "Batas waktu pembayaran pesanan ini sudah lewat. Silakan checkout ulang ya.", "ORDER_EXPIRED"); // F4.8
const notAllowed = () => new HttpError(409, "Pesanan ini tidak sedang menunggu bukti bayar.", "PROOF_NOT_ALLOWED");

// ARCHITECTURE §5.2: periksa status dulu, lalu ukuran dan jenis dari isi, enkripsi, simpan, dan ubah status dalam satu transaksi
// pesanan milik pembeli itu sendiri; admin pun tidak bertindak atas nama pembeli
export async function findOwnOrder(deps: Pick<AppDeps, "db">, viewer: SessionUser, orderId: string) {
  const [o] = UUID.test(orderId) ? await deps.db.select().from(orders).where(eq(orders.id, orderId)) : [];
  if (!o || o.userId !== viewer.userId) throw notFound();
  return o;
}

export async function uploadProof(deps: Deps, viewer: SessionUser, orderId: string, req: Request) {
  const o = await findOwnOrder(deps, viewer, orderId);
  const isExpired = () => o.status === "KEDALUWARSA" || (o.status === "MENUNGGU_PEMBAYARAN" && deps.now() >= o.expiresAt);
  if (isExpired()) throw expired();
  if (o.status !== "MENUNGGU_PEMBAYARAN") throw notAllowed();

  const { buffer, type } = await readUpload(req, PROOF); // F4.7: status tidak berubah bila ditolak
  const key = await deps.storage.save("proofs", deps.crypto.encryptBuffer(buffer), { allowed: "any", maxBytes: PROOF.maxBytes + 1024 });
  try {
    return await deps.db.transaction(async (tx) => {
      const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "PROOF_UPLOADED" });
      const now = deps.now();
      // syarat diulang di UPDATE: unggahan bersamaan atau batas yang lewat di tengah unggahan hanya meloloskan satu
      const [updated] = await tx.update(orders).set({ status: next.status, updatedAt: now })
        .where(and(eq(orders.id, o.id), eq(orders.status, "MENUNGGU_PEMBAYARAN"), gt(orders.expiresAt, now))).returning({ id: orders.id });
      if (!updated) throw now >= o.expiresAt ? expired() : notAllowed();
      const [proof] = await tx.insert(paymentProofs).values({ orderId: o.id, storageKey: key, mime: MIME[type], sizeBytes: buffer.length, uploadedAt: now }).returning({ id: paymentProofs.id });
      return { proofId: proof.id, status: next.status };
    });
  } catch (err) {
    await deps.storage.remove(key); // tidak ada file tanpa catatan
    throw err;
  }
}
