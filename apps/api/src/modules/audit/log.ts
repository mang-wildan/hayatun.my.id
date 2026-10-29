import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import { auditLogs, orders, products, users } from "../../db/schema.js";

const PAGE_SIZE = 50;
const querySchema = z.object({
  action: z.string({ error: "Jenis aksi tidak valid." }).trim().max(60, "Jenis aksi tidak valid.").optional(),
  page: z.string({ error: "Halaman tidak valid." }).regex(/^[1-9]\d{0,5}$/, "Halaman tidak valid.").transform(Number).optional(),
});

// F15.3: siapa, apa, kapan, dan pesanan atau produk terkait. Hanya dibaca; tidak ada rute untuk mengubahnya (F15.4).
export async function listAuditLogs(deps: Pick<AppDeps, "db" | "crypto">, query: unknown) {
  const f = querySchema.parse(query);
  const where = f.action ? eq(auditLogs.action, f.action) : undefined;
  const page = f.page ?? 1;
  const [{ total }] = await deps.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const rows = await deps.db
    .select({
      id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, details: auditLogs.details, createdAt: auditLogs.createdAt, nameEnc: users.nameEnc,
      entityLabel: sql<string | null>`case ${auditLogs.entityType}
        when 'order' then (select ${orders.invoiceNumber} from ${orders} where ${orders.id}::text = ${auditLogs.entityId})
        when 'product' then (select ${products.name} from ${products} where ${products.id}::text = ${auditLogs.entityId}) end`,
    })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(and(where))
    .orderBy(desc(auditLogs.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  const actions = (await deps.db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action)).map((a) => a.action);
  return {
    logs: rows.map(({ nameEnc, ...l }) => ({ ...l, actorName: nameEnc ? deps.crypto.decrypt(nameEnc) : null })),
    actions, total, page, pageSize: PAGE_SIZE,
  };
}
