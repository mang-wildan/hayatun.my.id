import type { Logger } from "pino";
import type { JobQueue } from "../../jobs/queue.js";
import type { Crypto } from "../crypto/index.js";
import type { Mailer } from "./mailer.js";
import { renderEmail, type EmailData, type EmailTemplate } from "./templates.js";

const JOB = "email.send";

// F11.4: ulangi 3 kali dalam 30 menit. Seluruh isi dienkripsi karena tautan memuat token asli
export async function enqueueEmail(
  queue: JobQueue,
  crypto: Crypto,
  template: EmailTemplate,
  to: string,
  data: EmailData,
  opts: { retryDelaySec?: number } = {},
): Promise<void> {
  const payload = crypto.encrypt(JSON.stringify({ template, to, data }));
  await queue.send(JOB, { payload }, { retryLimit: 3, retryDelaySec: opts.retryDelaySec ?? 600 });
}

export async function registerEmailWorker(
  queue: JobQueue,
  deps: { mailer: Mailer; crypto: Crypto; logger: Logger },
): Promise<void> {
  await queue.work(JOB, async ({ payload }: { payload: string }) => {
    const { template, to, data } = JSON.parse(deps.crypto.decrypt(payload)) as { template: EmailTemplate; to: string; data: EmailData };
    try {
      await deps.mailer.send({ to, ...renderEmail(template, data) });
    } catch (err) {
      // pesan SMTP sering memuat alamat penerima; jangan dicatat dan jangan diteruskan ke tabel antrean (N30)
      deps.logger.error({ template, errorName: (err as Error).name }, "email gagal terkirim");
      // sengaja tanpa `cause`: pesan SMTP asli bisa memuat alamat penerima dan akan ikut tersimpan di tabel antrean
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Gagal mengirim email");
    }
  });
}
