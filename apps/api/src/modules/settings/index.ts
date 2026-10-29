import { eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { storeSettings } from "../../db/schema.js";

type Deps = Pick<AppDeps, "db" | "config">;
export interface BankAccount { bank: string; number: string; holder: string }

const read = async (deps: Deps, key: string) => (await deps.db.select({ value: storeSettings.value }).from(storeSettings).where(eq(storeSettings.key, key)))[0]?.value;

export interface Store { name: string; email?: string; phone?: string }

// Nama dan kontak toko; sebelum diatur admin memakai "Hayatun" dan EMAIL_FROM
export const storeFrom = (raw: unknown, deps: Pick<AppDeps, "config">): Store => (raw as Store | null | undefined) ?? { name: "Hayatun", email: deps.config.emailFrom };
export const readStore = async (deps: Deps): Promise<Store> => storeFrom(await read(deps, "store"), deps);

// Rekening tujuan transfer. Tidak ada nilai bawaan: isian kosong atau setengah jadi dianggap belum diatur (jangan pernah mengarang rekening)
export function bankFrom(raw: unknown): BankAccount | null {
  const v = raw as Partial<Record<keyof BankAccount, unknown>> | null | undefined;
  const ok = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
  return v && typeof v === "object" && ok(v.bank) && ok(v.number) && ok(v.holder) ? { bank: v.bank, number: v.number, holder: v.holder } : null;
}
export const readBankAccount = async (deps: Deps): Promise<BankAccount | null> => bankFrom(await read(deps, "bankAccount"));
