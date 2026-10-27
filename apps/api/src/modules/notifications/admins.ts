import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { JobQueue } from "../../jobs/queue.js";
import type { Crypto } from "../crypto/index.js";
import type { EmailData, EmailTemplate } from "./templates.js";
import { enqueueEmail } from "./worker.js";

// Mengirim email yang sama ke semua admin yang aktif (F11.2); admin yang dinonaktifkan atau belum menerima undangan tidak dikirimi.
export async function notifyAdmins(deps: { db: Db; queue: JobQueue; crypto: Crypto }, template: EmailTemplate, data: Omit<EmailData, "name">) {
  const admins = await deps.db.select().from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
  for (const a of admins) {
    const name = a.nameEnc ? deps.crypto.decrypt(a.nameEnc) : undefined;
    await enqueueEmail(deps.queue, deps.crypto, template, deps.crypto.decrypt(a.emailEnc), { ...data, name });
  }
}
