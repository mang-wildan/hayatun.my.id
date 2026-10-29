import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { createPgBossQueue } from "./jobs/queue.js";
import { createLogger } from "./logger.js";
import { registerOrderJobs } from "./modules/jobs/expiry.js";
import { createCrypto } from "./modules/crypto/index.js";
import { createSmtpMailer } from "./modules/notifications/mailer.js";
import { registerEmailWorker } from "./modules/notifications/worker.js";
import { createShippingProvider } from "./modules/shipping/index.js";
import { createStorage } from "./modules/storage/index.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const { db, pool } = createDb(config.databaseUrl);
const queue = await createPgBossQueue(config.databaseUrl, logger);
const crypto = createCrypto({ keys: config.encryptionKeys, activeKeyId: config.activeKeyId, blindIndexKey: config.blindIndexKey });
await registerEmailWorker(queue, { mailer: createSmtpMailer(config), crypto, logger });
await registerOrderJobs(queue, { db, queue, crypto, config, logger, now: () => new Date() });

const server = createApp({ config, db, logger, queue, crypto, storage: createStorage(config.storage), shipping: createShippingProvider(config), now: () => new Date() })
  .listen(config.apiPort, "127.0.0.1", () => logger.info({ port: config.apiPort }, "API berjalan"));

process.on("SIGTERM", async () => {
  server.close();
  await queue.stop();
  await pool.end();
  process.exit(0);
});
