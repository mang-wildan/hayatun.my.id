import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCrypto } from "../modules/crypto/index.js";
import type { EmailMessage, Mailer } from "../modules/notifications/mailer.js";
import { enqueueEmail, registerEmailWorker } from "../modules/notifications/worker.js";
import { createLogger } from "../logger.js";
import { createPgBossQueue } from "./queue.js";

// butuh `npm -w apps/api run db:migrate` sudah dijalankan; memakai pg-boss sungguhan lewat role aplikasi
const crypto = createCrypto({ keys: { k1: randomBytes(32) }, activeKeyId: "k1", blindIndexKey: randomBytes(32) });
const queuePromise = createPgBossQueue(process.env.DATABASE_URL!);

// satu worker untuk seluruh berkas: dua worker di antrean yang sama akan berebut tugas.
// Setiap tes mendaftarkan penangannya sendiri per penerima.
const handlers = new Map<string, (msg: EmailMessage) => Promise<void>>();
const router: Mailer = { send: async (msg) => { await handlers.get(msg.to)?.(msg); } };

beforeAll(async () => {
  await registerEmailWorker(await queuePromise, { mailer: router, crypto, logger: createLogger({ logLevel: "silent" }) });
});
afterAll(async () => (await queuePromise).stop());

describe("email lewat pg-boss", () => {
  it("terkirim dalam ≤ 5 detik sejak masuk antrean (N20)", async () => {
    const queue = await queuePromise;
    const to = `cepat-${randomUUID()}@mail.test`;
    const sent: string[] = [];
    handlers.set(to, async (m) => void sent.push(m.to));
    const start = Date.now();
    await enqueueEmail(queue, crypto, "login_locked", to, { name: "Budi" });
    await expect.poll(() => sent.length, { timeout: 15_000, interval: 100 }).toBe(1);
    expect(Date.now() - start).toBeLessThanOrEqual(5_000);
  }, 20_000);

  it("gagal sekali lalu berhasil pada percobaan ulang: terkirim tepat sekali (F11.4)", async () => {
    const queue = await queuePromise;
    const to = `ulang-${randomUUID()}@mail.test`;
    let attempts = 0;
    const delivered: string[] = [];
    handlers.set(to, async (m) => {
      attempts += 1;
      if (attempts === 1) throw new Error("koneksi SMTP terputus");
      delivered.push(m.to);
    });
    await enqueueEmail(queue, crypto, "verify_email", to, { name: "Budi", link: "https://hayatun.my.id/x?token=t" }, { retryDelaySec: 1 });
    await expect.poll(() => delivered.length, { timeout: 25_000, interval: 200 }).toBe(1);
    expect(attempts).toBe(2);
  }, 30_000);
});
