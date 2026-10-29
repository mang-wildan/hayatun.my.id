import { formatWIB, phoneSchema } from "@hayatun/shared";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { storeSettings, users } from "../../db/schema.js";
import { recordAudit } from "../audit/index.js";
import type { SessionUser } from "../auth/sessions.js";
import { notifyAdmins } from "../notifications/admins.js";
import { bankFrom, readBankAccount, readStore, storeFrom, type BankAccount } from "./index.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "queue" | "config" | "logger" | "now">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// kolom kosong dari formulir berarti tidak diisi
const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const text = (what: string, min: number, max: number, short?: string) => {
  const required = `${what} diisi dulu ya.`;
  return z.string({ error: required }).trim().min(1, required).min(min, short ?? required).max(max, `${what} maksimal ${max} karakter.`);
};
const storeSchema = z.object({
  name: text("Nama toko", 1, 80),
  email: optional(z.string().trim().toLowerCase().max(120, "Email maksimal 120 karakter.").regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Format email belum benar.")),
  phone: optional(phoneSchema),
});
const bankSchema = z.object({
  bank: text("Nama bank", 2, 40, "Nama bank terlalu pendek."),
  number: z.string({ error: "Nomor rekening diisi dulu ya." }).trim().min(1, "Nomor rekening diisi dulu ya.").transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\d+$/.test(v), "Nomor rekening hanya boleh berisi angka.").refine((v) => v.length >= 6 && v.length <= 25, "Nomor rekening harus 6 sampai 25 angka."),
  holder: text("Atas nama", 2, 80, "Atas nama terlalu pendek."),
});

const view = (s: { name: string; email?: string; phone?: string }) => ({ name: s.name, email: s.email ?? null, phone: s.phone ?? null });

export async function readSettings(deps: Deps) {
  return { store: view(await readStore(deps)), bankAccount: await readBankAccount(deps) };
}

// Baris dipastikan ada lalu dikunci, supaya dua admin yang menyimpan bersamaan berurutan dan nilai "lama" di log selalu nyambung
async function lockedValue(tx: Tx, key: string) {
  await tx.insert(storeSettings).values({ key, value: sql`'null'::jsonb` }).onConflictDoNothing();
  const [row] = await tx.select({ value: storeSettings.value }).from(storeSettings).where(eq(storeSettings.key, key)).for("update");
  return row.value;
}
const save = (tx: Tx, key: string, value: object) => tx.update(storeSettings).set({ value }).where(eq(storeSettings.key, key));

export async function saveStore(deps: Deps, admin: SessionUser, input: unknown) {
  const next = storeSchema.parse(input);
  const value = { name: next.name, ...(next.email && { email: next.email }), ...(next.phone && { phone: next.phone }) };
  await deps.db.transaction(async (tx) => {
    const old = storeFrom(await lockedValue(tx, "store"), deps);
    if (old.name === value.name && (old.email ?? "") === (value.email ?? "") && (old.phone ?? "") === (value.phone ?? "")) return;
    await save(tx, "store", value);
    await recordAudit(tx as unknown as Db, { actorId: admin.userId, action: "settings.store_changed", entityType: "settings", entityId: "store", details: {
      oldName: old.name, newName: value.name, oldEmail: old.email ?? "", newEmail: value.email ?? "", oldPhone: old.phone ?? "", newPhone: value.phone ?? "",
    } });
  });
  return view(value);
}

// F15.7: perubahan rekening adalah sasaran penipuan, jadi semua admin diberi tahu lewat email (best-effort, F11.4)
export async function saveBankAccount(deps: Deps, admin: SessionUser, input: unknown) {
  const next: BankAccount = bankSchema.parse(input);
  const old = await deps.db.transaction(async (tx) => {
    const old = bankFrom(await lockedValue(tx, "bankAccount"));
    if (old && old.bank === next.bank && old.number === next.number && old.holder === next.holder) return "same" as const;
    await save(tx, "bankAccount", next);
    await recordAudit(tx as unknown as Db, { actorId: admin.userId, action: "settings.bank_account_changed", entityType: "settings", entityId: "bankAccount", details: {
      oldBank: old?.bank ?? "", oldNumber: old?.number ?? "", oldHolder: old?.holder ?? "", newBank: next.bank, newNumber: next.number, newHolder: next.holder,
    } });
    return old;
  });
  if (old !== "same") {
    const [u] = await deps.db.select({ nameEnc: users.nameEnc }).from(users).where(eq(users.id, admin.userId));
    await notifyAdmins(deps, "bank_account_changed", {
      changedBy: u?.nameEnc ? deps.crypto.decrypt(u.nameEnc) : "seorang admin", changedAt: formatWIB(deps.now()), oldBank: old, bank: next, link: `${deps.config.appUrl}/admin/pengaturan`,
    });
  }
  return next;
}
