import { and, eq, lte } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { orders } from "../../db/schema.js";
import { recordAudit } from "../audit/index.js";
import { transition } from "../orders/state-machine.js";

const AFTER_MS = 14 * 24 * 3600_000; // F8.3
const BATCH = 200;

// 14 hari sejak dikirim tanpa keluhan menjadi Diterima. SKIP LOCKED: penyapu bersamaan membagi pekerjaan, tiap pesanan diproses sekali.
export async function autoReceiveOrders(deps: Pick<AppDeps, "db" | "now">): Promise<number> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const due = await tx.select().from(orders)
      .where(and(eq(orders.status, "LUNAS"), eq(orders.physicalStatus, "DIKIRIM"), lte(orders.shippedAt, new Date(now.getTime() - AFTER_MS))))
      .limit(BATCH).for("update", { skipLocked: true });
    for (const o of due) {
      const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "RECEIVED" });
      await tx.update(orders).set({ physicalStatus: next.physical, updatedAt: now }).where(eq(orders.id, o.id));
      await recordAudit(tx as unknown as AppDeps["db"], { actorId: null, action: "order.auto_received", entityType: "order", entityId: o.id });
    }
    return due.length;
  });
}
