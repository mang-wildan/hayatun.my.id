import { eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { storeSettings } from "../../db/schema.js";

type Deps = Pick<AppDeps, "db" | "config">;
export interface BankAccount { bank: string; number: string; holder: string }

const read = async (deps: Deps, key: string) => (await deps.db.select({ value: storeSettings.value }).from(storeSettings).where(eq(storeSettings.key, key)))[0]?.value;

// Nama dan kontak toko; sampai pengaturan toko dibuat (T48) memakai "Hayatun" dan EMAIL_FROM
export async function readStore(deps: Deps): Promise<{ name: string; email?: string; phone?: string }> {
  return ((await read(deps, "store")) as { name: string; email?: string; phone?: string } | undefined) ?? { name: "Hayatun", email: deps.config.emailFrom };
}

// Rekening tujuan transfer. Tidak ada nilai bawaan: isian kosong atau setengah jadi dianggap belum diatur (jangan pernah mengarang rekening)
export async function readBankAccount(deps: Deps): Promise<BankAccount | null> {
  const v = (await read(deps, "bankAccount")) as Partial<Record<keyof BankAccount, unknown>> | null | undefined;
  const ok = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
  return v && typeof v === "object" && ok(v.bank) && ok(v.number) && ok(v.holder) ? { bank: v.bank, number: v.number, holder: v.holder } : null;
}
