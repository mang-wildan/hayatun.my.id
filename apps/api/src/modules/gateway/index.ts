import { eq, sql } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import type { IncomingHttpHeaders } from "node:http";
import type { Config } from "../../config.js";
import { orders } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { createFakeGateway } from "./fake.js";

// N31: gateway hanya menerima ini, tidak pernah nama, nomor HP, alamat, atau email pembeli
export interface GatewayRequest { orderId: string; invoiceNumber: string; amount: number; expiresAt: Date; returnUrl: string }
export interface GatewayPayment { reference: string; paymentUrl: string }
// Kejadian webhook yang sudah diperiksa keasliannya dan dinormalisasi; hanya bidang ini yang disimpan (tanpa data pembeli dari gateway)
export interface GatewayEvent { eventId: string; type: "payment.succeeded" | "payment.failed" | "payment.expired" | "payment.pending"; reference: string; amount: number }
export interface GatewayProvider {
  createTransaction(req: GatewayRequest, signal: AbortSignal): Promise<GatewayPayment>;
  /** Memeriksa tanda tangan SEBELUM membaca isi, lalu menormalisasi. Melempar invalidSignature() atau invalidEvent(). Tiap penyedia punya skema sendiri. */
  verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): GatewayEvent;
}
export const invalidSignature = () => new HttpError(401, "Tanda tangan tidak sah.", "INVALID_SIGNATURE");
export const invalidEvent = () => new HttpError(400, "Isi kejadian tidak sah.", "INVALID_EVENT");

const none: GatewayProvider = {
  createTransaction: async () => { throw new Error("Penyedia gateway belum dipilih"); },
  verifyWebhook: () => { throw new Error("Penyedia gateway belum dipilih"); },
};
export const createGatewayProvider = (config: Config): GatewayProvider => (config.gateway.provider === "fake" ? createFakeGateway(config.gateway.webhookSecret) : none);

type Deps = Pick<AppDeps, "db" | "gateway" | "config" | "logger" | "now">;
const unavailable = () => new HttpError(503, "Pembayaran online belum bisa dibuka. Coba lagi sebentar lagi ya.", "GATEWAY_UNAVAILABLE");
const httpsUrl = (u: unknown) => { try { return typeof u === "string" && new URL(u).protocol === "https:"; } catch { return false; } };

// Tautan bayar untuk pesanan gateway: dibuat sekali, sesudahnya dikembalikan apa adanya. Kunci per pesanan membuat dua permintaan
// bersamaan memanggil gateway sekali. Gagal apa pun (error, lambat, tautan tidak https) = 503; pesanan tidak diubah.
export async function gatewayLink(deps: Deps, orderId: string): Promise<string> {
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orderId}))`);
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!o) throw new HttpError(404, "Pesanan tidak ditemukan.", "ORDER_NOT_FOUND");
    if (o.paymentMethod !== "gateway") throw new HttpError(409, "Pesanan ini dibayar lewat transfer bank.", "NOT_GATEWAY_ORDER");
    if (o.status !== "MENUNGGU_PEMBAYARAN" || deps.now() >= o.expiresAt) throw new HttpError(409, "Pesanan ini sudah tidak bisa dibayar.", "ORDER_NOT_PAYABLE");
    if (o.gatewayUrl) return o.gatewayUrl;

    const signal = AbortSignal.timeout(deps.config.gateway.timeoutMs);
    const req: GatewayRequest = { orderId: o.id, invoiceNumber: o.invoiceNumber, amount: o.total, expiresAt: o.expiresAt, returnUrl: `${deps.config.appUrl}/pesanan/${o.id}` };
    let payment: GatewayPayment;
    try {
      // balapan dengan sinyal: penyedia yang mengabaikan sinyal batal tetap dihentikan tepat waktu
      payment = await Promise.race([
        deps.gateway.createTransaction(req, signal),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
    } catch (err) {
      deps.logger.warn({ err, provider: deps.config.gateway.provider, orderId: o.id }, "tautan bayar gateway gagal dibuat");
      throw unavailable();
    }
    if (!payment?.reference || !httpsUrl(payment.paymentUrl)) {
      deps.logger.warn({ provider: deps.config.gateway.provider, orderId: o.id }, "gateway memberi tautan bayar tidak sah");
      throw unavailable();
    }
    await tx.update(orders).set({ gatewayReference: payment.reference, gatewayUrl: payment.paymentUrl, updatedAt: deps.now() }).where(eq(orders.id, o.id));
    return payment.paymentUrl;
  });
}
