import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";
import { invalidEvent, invalidSignature, type GatewayEvent, type GatewayPayment, type GatewayProvider, type GatewayRequest } from "./index.js";

const MIN_AMOUNT = 1000; // seperti batas minimum gateway sungguhan; juga cara e2e memicu penolakan

// Tiruan untuk tes dan pengembangan. Bidang publiknya bisa diubah per tes: lambat, error, tautan aneh. Merekam permintaan untuk memeriksa N31.
const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(["payment.succeeded", "payment.failed", "payment.expired", "payment.pending"]),
  reference: z.string().min(1).max(200),
  amount: z.number().int().positive(),
});

// Skema tiruan: HMAC-SHA256 (hex) atas badan mentah di header x-signature. Penyedia sungguhan punya skemanya sendiri.
export function createFakeGateway(webhookSecret = "") {
  const fake = {
    requests: [] as GatewayRequest[],
    lastSignal: undefined as AbortSignal | undefined,
    delayMs: undefined as number | undefined,
    error: undefined as Error | undefined,
    ignoreAbort: false,
    paymentUrl: undefined as string | undefined,
    reference: undefined as string | undefined,
    async createTransaction(req: GatewayRequest, signal: AbortSignal): Promise<GatewayPayment> {
      fake.requests.push(req);
      fake.lastSignal = signal;
      if (fake.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, fake.delayMs);
          if (!fake.ignoreAbort) signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
        });
      }
      if (fake.error) throw fake.error;
      if (req.amount < MIN_AMOUNT) throw new Error("nominal di bawah minimum gateway");
      const reference = fake.reference ?? `FAKE-${req.invoiceNumber.replace(/\W+/g, "")}`;
      return { reference, paymentUrl: fake.paymentUrl ?? `https://gateway.fake.test/pay/${reference}` };
    },
    verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): GatewayEvent {
      const given = headers["x-signature"];
      const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
      const got = typeof given === "string" && /^[0-9a-f]{64}$/i.test(given) ? Buffer.from(given, "hex") : null;
      if (!webhookSecret || !got || !timingSafeEqual(got, expected)) throw invalidSignature();
      let json: unknown;
      try { json = JSON.parse(rawBody.toString("utf8")); } catch { throw invalidEvent(); }
      const parsed = eventSchema.safeParse(json);
      if (!parsed.success) throw invalidEvent();
      const { eventId, type, reference, amount } = parsed.data; // bidang lain dari gateway dibuang
      return { eventId, type, reference, amount };
    },
  } satisfies GatewayProvider & Record<string, unknown>;
  return fake;
}
