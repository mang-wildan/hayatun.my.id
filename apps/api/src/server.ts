import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { createPgBossQueue } from "./jobs/queue.js";
import { createLogger } from "./logger.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const { db, pool } = createDb(config.databaseUrl);
const queue = await createPgBossQueue(config.databaseUrl);

const server = createApp({ config, db, logger, queue, now: () => new Date() })
  .listen(config.apiPort, "127.0.0.1", () => logger.info({ port: config.apiPort }, "API berjalan"));

process.on("SIGTERM", async () => {
  server.close();
  await queue.stop();
  await pool.end();
  process.exit(0);
});
