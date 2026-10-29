import type { Db } from "../../db/client.js";
import { auditLogs } from "../../db/schema.js";

export interface AuditEntry {
  actorId: string | null; // null untuk aksi sistem, misalnya tugas terjadwal
  action: string;
  entityType: string;
  entityId: string;
  // hanya nilai sederhana, supaya data pribadi berbentuk objek tidak ikut tersimpan
  details?: Record<string, string | number | boolean>;
}

// Nama pembeli yang tampil di antrean atau daftar pesanan admin: satu catatan per pesanan (F15.3, N28)
export async function recordBuyerViews(db: Db, actorId: string, orderIds: string[]): Promise<void> {
  if (orderIds.length) await db.insert(auditLogs).values(orderIds.map((entityId) => ({ actorId, action: "order.buyer_viewed", entityType: "order", entityId, details: {} })));
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({ ...entry, details: entry.details ?? {} });
}
