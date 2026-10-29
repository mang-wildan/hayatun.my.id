import { and, eq, isNull, lte, notInArray } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import type { Db } from "../../db/client.js";
import { paymentProofs } from "../../db/schema.js";
import { recordAudit } from "../audit/index.js";

const RETENTION_MS = 365 * 24 * 3600_000; // F12.3, N29
const BATCH = 100;

// File bukti transfer dihapus 1 tahun setelah diunggah; barisnya tetap sebagai catatan. Menghapus file dulu lalu menandai:
// bila penandaan gagal, putaran berikutnya mengulang (hapus file aman diulang). SKIP LOCKED: penyapu bersamaan membagi pekerjaan.
export async function deleteExpiredProofs(deps: Pick<AppDeps, "db" | "storage" | "logger" | "now">): Promise<number> {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const failed: string[] = []; // satu bukti yang gagal tidak menghentikan yang lain, dan tidak dicoba lagi di putaran ini
  let deleted = 0;
  for (;;) {
    const batch = await deps.db.transaction(async (tx) => {
      const due = await tx.select().from(paymentProofs)
        .where(and(isNull(paymentProofs.fileDeletedAt), lte(paymentProofs.uploadedAt, cutoff), failed.length ? notInArray(paymentProofs.id, failed) : undefined))
        .limit(BATCH).for("update", { skipLocked: true });
      for (const p of due) {
        try {
          await deps.storage.remove(p.storageKey);
          await tx.update(paymentProofs).set({ fileDeletedAt: now }).where(eq(paymentProofs.id, p.id));
          await recordAudit(tx as unknown as Db, { actorId: null, action: "payment_proof.deleted", entityType: "order", entityId: p.orderId, details: { proofId: p.id } });
          deleted++;
        } catch (err) {
          failed.push(p.id);
          deps.logger.error({ proofId: p.id, errorName: (err as Error).name }, "bukti bayar gagal dihapus");
        }
      }
      return due.length;
    });
    if (batch === 0) return deleted;
  }
}
