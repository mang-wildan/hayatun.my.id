import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { errorHandler } from "./errors.js";
import type { JobQueue } from "./jobs/queue.js";
import { healthRoutes } from "./modules/health/routes.js";

export interface AppDeps { config: Config; db: Db; logger: Logger; queue: JobQueue; now: () => Date }

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(pinoHttp({
    logger: deps.logger,
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    // N30: tanpa query string di log
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split("?")[0] }) },
  }));
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", healthRoutes(deps.db));
  app.use(errorHandler);
  return app;
}
