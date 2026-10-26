import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { errorHandler, HttpError } from "./errors.js";
import type { JobQueue } from "./jobs/queue.js";
import { loadSession } from "./modules/auth/middleware.js";
import { authRoutes } from "./modules/auth/routes.js";
import { productRoutes } from "./modules/products/routes.js";
import type { Crypto } from "./modules/crypto/index.js";
import { healthRoutes } from "./modules/health/routes.js";
import type { Storage } from "./modules/storage/index.js";

export interface AppDeps { config: Config; db: Db; logger: Logger; queue: JobQueue; crypto: Crypto; storage: Storage; now: () => Date }

// N7: permintaan pengubah data dari situs lain ditolak. Browser selalu mengirim Origin untuk permintaan lintas situs,
// jadi permintaan tanpa Origin (curl, tes, server-ke-server) tidak berasal dari formulir situs lain.
const checkOrigin = (appUrl: string): RequestHandler => (req, _res, next) => {
  const origin = req.headers.origin;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !origin || origin === new URL(appUrl).origin) return next();
  throw new HttpError(403, "Permintaan ditolak karena berasal dari situs lain.", "BAD_ORIGIN");
};

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(pinoHttp({
    logger: deps.logger,
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    // N30: tanpa query string di log
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split("?")[0] }) },
  }));
  app.use(helmet());
  app.use("/api", checkOrigin(deps.config.appUrl));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", healthRoutes(deps.db, deps.storage));
  app.use("/api", loadSession(deps));
  app.use("/api/auth", authRoutes(deps));
  app.use("/api/admin/products", productRoutes(deps));
  app.use(errorHandler);
  return app;
}
