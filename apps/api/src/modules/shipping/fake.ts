import type { Rate, RateRequest, ShippingProvider } from "./index.js";

const DEFAULT_RATES: Rate[] = [
  { courier: "JNE", service: "REG", price: 18000, etdDays: "2-3" },
  { courier: "SiCepat", service: "REG", price: 15000, etdDays: "1-2" },
];

// Tiruan untuk tes dan pengembangan: bisa lambat, error, atau tanpa layanan; merekam permintaan untuk memeriksa N27
export function createFakeShipping(opts: { rates?: Rate[]; delayMs?: number; error?: Error; ignoreAbort?: boolean } = {}) {
  const fake = {
    requests: [] as RateRequest[],
    lastSignal: undefined as AbortSignal | undefined,
    async rates(req: RateRequest, signal: AbortSignal) {
      fake.requests.push(req);
      fake.lastSignal = signal;
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          if (!opts.ignoreAbort) signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
        });
      }
      if (opts.error) throw opts.error;
      return opts.rates ?? DEFAULT_RATES;
    },
  } satisfies ShippingProvider & Record<string, unknown>;
  return fake;
}
