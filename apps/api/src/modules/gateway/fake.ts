import type { GatewayPayment, GatewayProvider, GatewayRequest } from "./index.js";

const MIN_AMOUNT = 1000; // seperti batas minimum gateway sungguhan; juga cara e2e memicu penolakan

// Tiruan untuk tes dan pengembangan. Bidang publiknya bisa diubah per tes: lambat, error, tautan aneh. Merekam permintaan untuk memeriksa N31.
export function createFakeGateway() {
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
  } satisfies GatewayProvider & Record<string, unknown>;
  return fake;
}
