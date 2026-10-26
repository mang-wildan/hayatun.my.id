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

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({ ...entry, details: entry.details ?? {} });
}
