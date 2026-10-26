import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { createMemoryQueue } from "../jobs/queue.js";
import { createLogger } from "../logger.js";
import { createCrypto } from "../modules/crypto/index.js";
import { createSmtpMailer } from "../modules/notifications/mailer.js";
import { registerEmailWorker } from "../modules/notifications/worker.js";
import { bootstrapAdmin } from "./bootstrap-admin.js";

const config = loadConfig(process.env);
const { db, pool } = createDb(config.databaseUrl);
const crypto = createCrypto({ keys: config.encryptionKeys, activeKeyId: config.activeKeyId, blindIndexKey: config.blindIndexKey });
const queue = createMemoryQueue();
await registerEmailWorker(queue, { mailer: createSmtpMailer(config), crypto, logger: createLogger(config) });

try {
  const result = await bootstrapAdmin({ config, db, queue, crypto, now: () => new Date() });
  if (result === "admin_exists") {
    console.log("Admin sudah ada. Tidak ada yang diubah.");
  } else {
    await queue.runAll(); // kirim sekarang; alamat email tidak dicetak
    console.log("Undangan admin terkirim ke email yang diatur di ADMIN_BOOTSTRAP_EMAIL.");
  }
} catch (err) {
  console.error(`Gagal: ${(err as Error).message}. Setelah diperbaiki, jalankan ulang skrip ini; undangan baru akan dikirim.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
