import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCrypto } from "../modules/crypto/index.js";
import { createMemoryMailer } from "../modules/notifications/mailer.js";
import { enqueueEmail, registerEmailWorker } from "../modules/notifications/worker.js";
import { createLogger } from "../logger.js";
import { createPgBossQueue } from "./queue.js";

// butuh `npm -w apps/api run db:migrate` sudah dijalankan; memakai pg-boss sungguhan lewat role aplikasi
const crypto = createCrypto({ keys: { k1: randomBytes(32) }, activeKeyId: "k1", blindIndexKey: randomBytes(32) });
const logger = createLogger({ logLevel: "silent" });
const queuePromise = createPgBossQueue(process.env.DATABASE_URL!);
afterAll(async () => (await queuePromise).stop());

describe("email lewat pg-boss", () => {
  it("terkirim dalam ≤ 5 detik sejak masuk antrean (N20)", async () => {
    const queue = await queuePromise;
    const mailer = createMemoryMailer();
    await registerEmailWorker(queue, { mailer, crypto, logger });
    const to = `cepat-${randomUUID()}@mail.test`;
    const start = Date.now();
    await enqueueEmail(queue, crypto, "login_locked", to, { name: "Budi" });
    await expect.poll(() => mailer.sent.some((m) => m.to === to), { timeout: 15_000, interval: 100 }).toBe(true);
    expect(Date.now() - start).toBeLessThanOrEqual(5_000);
  }, 20_000);

  it("gagal sekali lalu berhasil pada percobaan ulang: terkirim tepat sekali (F11.4)", async () => {
    const queue = await queuePromise;
    const to = `ulang-${randomUUID()}@mail.test`;
    const delivered: string[] = [];
    let attempts = 0;
    const flaky = {
      async send(msg: { to: string }) {
        if (msg.to !== to) return; // abaikan tugas lain di antrean bersama
        attempts += 1;
        if (attempts === 1) throw new Error("koneksi SMTP terputus");
        delivered.push(msg.to);
      },
    };
    await registerEmailWorker(queue, { mailer: flaky as never, crypto, logger });
    await enqueueEmail(queue, crypto, "verify_email", to, { name: "Budi", link: "https://hayatun.my.id/x?token=t" }, { retryDelaySec: 1 });
    await expect.poll(() => delivered.length, { timeout: 25_000, interval: 200 }).toBe(1);
    expect(attempts).toBe(2);
  }, 30_000);
});
