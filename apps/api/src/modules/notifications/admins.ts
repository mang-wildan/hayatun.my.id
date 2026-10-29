import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { Logger } from "pino";
import type { JobQueue } from "../../jobs/queue.js";
import type { Crypto } from "../crypto/index.js";
import type { EmailData, EmailTemplate } from "./templates.js";
import { enqueueEmail } from "./worker.js";

// Mengirim email yang sama ke semua admin yang aktif (F11.2); admin yang dinonaktifkan atau belum menerima undangan tidak dikirimi.
// F11.4: kegagalan satu admin hanya dicatat dan tidak menghentikan yang lain maupun pemanggilnya.
export async function notifyAdmins(deps: { db: Db; queue: JobQueue; crypto: Crypto; logger: Logger }, template: EmailTemplate, data: Omit<EmailData, "name">) {
  try {
    const admins = await deps.db.select().from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    for (const a of admins) {
      try {
        const name = a.nameEnc ? deps.crypto.decrypt(a.nameEnc) : undefined;
        await enqueueEmail(deps.queue, deps.crypto, template, deps.crypto.decrypt(a.emailEnc), { ...data, name });
      } catch (err) {
        deps.logger.error({ template, errorName: (err as Error).name }, "email gagal masuk antrean");
      }
    }
  } catch (err) {
    deps.logger.error({ template, errorName: (err as Error).name }, "email gagal masuk antrean");
  }
}
