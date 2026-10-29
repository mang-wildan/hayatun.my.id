import { formatWIB } from "@hayatun/shared";
import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import type { JobQueue } from "../../jobs/queue.js";
import { orders, users } from "../../db/schema.js";
import { enqueueEmail } from "../notifications/worker.js";
import { releaseHold } from "../orders/hold.js";
import { transition } from "../orders/state-machine.js";

type Deps = Pick<AppDeps, "db" | "queue" | "crypto" | "config" | "now">;

const JOB = "orders.sweep";
const REMIND_BEFORE_MS = 3 * 3600_000; // F4.5

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

async function emailBuyer(deps: Deps, o: { id: string; userId: string; invoiceNumber: string; total: number; expiresAt: Date }, template: "order_expired" | "order_reminder") {
  const [u] = await deps.db.select({ emailEnc: users.emailEnc, nameEnc: users.nameEnc }).from(users).where(eq(users.id, o.userId));
  await enqueueEmail(deps.queue, deps.crypto, template, deps.crypto.decrypt(u.emailEnc), {
    name: u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined,
    invoiceNumber: o.invoiceNumber,
    total: rupiah(o.total),
    deadline: formatWIB(o.expiresAt),
    link: `${deps.config.appUrl}/pesanan/${o.id}`,
  });
}

// ARCHITECTURE §5.4. Memilih SEMUA pesanan yang sudah lewat batas, jadi yang tertinggal saat server mati ikut terproses (N25).
// SKIP LOCKED: beberapa penyapu bersamaan membagi pekerjaan, tiap pesanan diproses tepat sekali.
export async function sweepOrders(deps: Deps, { batchSize = 100 } = {}) {
  const now = deps.now();
  let expired = 0;
  for (;;) {
    const done = await deps.db.transaction(async (tx) => {
      const due = await tx.select().from(orders)
        .where(and(eq(orders.status, "MENUNGGU_PEMBAYARAN"), lte(orders.expiresAt, now)))
        .orderBy(asc(orders.expiresAt)).limit(batchSize).for("update", { skipLocked: true });
      for (const o of due) {
        const next = transition({ status: o.status, digital: o.digitalStatus, physical: o.physicalStatus }, { type: "EXPIRED" });
        await tx.update(orders).set({ status: next.status, updatedAt: now }).where(eq(orders.id, o.id));
        await releaseHold(tx, o.id);
      }
      return due;
    });
    for (const o of done) await emailBuyer(deps, o, "order_expired"); // setelah commit
    expired += done.length;
    if (done.length < batchSize) break;
  }

  // pengingat ditandai atomik di UPDATE: tepat sekali walau penyapu berjalan bersamaan; pesanan yang sudah lewat batas tidak diingatkan
  const due = await deps.db.update(orders).set({ reminderSentAt: now })
    .where(and(eq(orders.status, "MENUNGGU_PEMBAYARAN"), isNull(orders.reminderSentAt), gt(orders.expiresAt, now), lte(orders.expiresAt, new Date(now.getTime() + REMIND_BEFORE_MS))))
    .returning();
  for (const o of due) await emailBuyer(deps, o, "order_reminder");
  return { expired, reminded: due.length };
}

// Disapu tiap menit: kedaluwarsa paling lambat sekitar 1 menit dari jadwalnya (N25 meminta ≤ 5 menit)
export async function registerOrderJobs(queue: JobQueue, deps: Deps): Promise<void> {
  await queue.work(JOB, async () => { await sweepOrders(deps); });
  await queue.schedule(JOB, "* * * * *");
}
