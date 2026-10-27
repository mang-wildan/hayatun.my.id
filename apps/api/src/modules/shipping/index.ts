import type { AppDeps } from "../../app.js";
import type { Config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { createFakeShipping } from "./fake.js";

// N27: penyedia hanya menerima wilayah dan berat, tidak pernah nama, nomor HP, atau alamat lengkap
export interface RateRequest { originAreaId: string; destinationAreaId: string; postalCode: string; weightG: number }
export interface Rate { courier: string; service: string; price: number; etdDays: string | null }
export interface ShippingProvider { rates(req: RateRequest, signal: AbortSignal): Promise<Rate[]> }

const unavailable = () => new HttpError(503, "Ongkir belum bisa dihitung, coba lagi beberapa saat", "SHIPPING_UNAVAILABLE"); // F3.6
const notServed = () => new HttpError(422, "Alamat tujuan ini belum dilayani ekspedisi. Coba pakai alamat lain ya.", "AREA_NOT_SERVED"); // F3.7

const none: ShippingProvider = { rates: async () => { throw new Error("Penyedia ongkir belum dipilih"); } };

export const createShippingProvider = (config: Config): ShippingProvider => (config.shipping.provider === "fake" ? createFakeShipping() : none);

// Satu-satunya jalan mengambil tarif (checkout, alamat). Gagal apa pun = checkout ditahan, tidak pernah ongkir Rp0.
export async function getRates(deps: Pick<AppDeps, "shipping" | "config" | "logger">, dest: { areaId: string; postalCode: string; weightG: number }): Promise<Rate[]> {
  const req: RateRequest = { originAreaId: deps.config.shipping.originAreaId, destinationAreaId: dest.areaId, postalCode: dest.postalCode, weightG: dest.weightG };
  const signal = AbortSignal.timeout(deps.config.shipping.timeoutMs); // N19
  let rates: Rate[];
  try {
    // balapan dengan sinyal: penyedia yang mengabaikan sinyal batal tetap dihentikan tepat waktu
    rates = await Promise.race([
      deps.shipping.rates(req, signal),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
  } catch (err) {
    deps.logger.warn({ err, provider: deps.config.shipping.provider }, "tarif ongkir gagal diambil");
    throw unavailable();
  }
  if (rates.length === 0) throw notServed();
  const valid = rates.filter((r) => Number.isInteger(r.price) && r.price > 0);
  if (!valid.length) {
    deps.logger.warn({ provider: deps.config.shipping.provider }, "penyedia ongkir hanya memberi tarif tidak sah");
    throw unavailable();
  }
  return valid.map(({ courier, service, price, etdDays }) => ({ courier, service, price, etdDays })).sort((a, b) => a.price - b.price);
}
