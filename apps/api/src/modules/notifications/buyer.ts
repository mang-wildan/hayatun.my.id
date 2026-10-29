import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { Logger } from "pino";
import type { JobQueue } from "../../jobs/queue.js";
import type { Crypto } from "../crypto/index.js";
import type { EmailData, EmailTemplate } from "./templates.js";
import { enqueueEmail } from "./worker.js";

// Email ke satu pembeli menurut id akunnya; alamat didekripsi hanya saat antre dibuat.
// F11.4: gagal masuk antrean hanya dicatat, supaya perubahan pesanan yang sudah tersimpan tidak ikut gagal.
export async function emailBuyer(deps: { db: Db; queue: JobQueue; crypto: Crypto; logger: Logger }, userId: string, template: EmailTemplate, data: Omit<EmailData, "name">) {
  try {
    const [u] = await deps.db.select({ emailEnc: users.emailEnc, nameEnc: users.nameEnc }).from(users).where(eq(users.id, userId));
    await enqueueEmail(deps.queue, deps.crypto, template, deps.crypto.decrypt(u.emailEnc), { ...data, name: u.nameEnc ? deps.crypto.decrypt(u.nameEnc) : undefined });
  } catch (err) {
    deps.logger.error({ template, errorName: (err as Error).name }, "email gagal masuk antrean");
  }
}
