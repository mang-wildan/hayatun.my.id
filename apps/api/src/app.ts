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
import { addressRoutes } from "./modules/addresses/routes.js";
import { cartRoutes } from "./modules/cart/routes.js";
import { checkoutRoutes } from "./modules/checkout/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { invoiceRoutes } from "./modules/invoices/routes.js";
import { adminPaymentRoutes } from "./modules/payments-manual/admin-routes.js";
import { digitalOrderRoutes, downloadRoutes } from "./modules/fulfillment-digital/routes.js";
import { adminOrderRoutes } from "./modules/admin-orders/routes.js";
import { receiveRoutes, shipmentRoutes } from "./modules/fulfillment-physical/routes.js";
import { myOrderRoutes } from "./modules/orders/routes.js";
import { orderRoutes } from "./modules/payments-manual/routes.js";
import { productRoutes } from "./modules/products/routes.js";
import type { Crypto } from "./modules/crypto/index.js";
import { healthRoutes } from "./modules/health/routes.js";
import type { ShippingProvider } from "./modules/shipping/index.js";
import type { Storage } from "./modules/storage/index.js";

export interface AppDeps { config: Config; db: Db; logger: Logger; queue: JobQueue; crypto: Crypto; storage: Storage; shipping: ShippingProvider; now: () => Date }

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
    // N30: tanpa query string di log, dan token unduhan (ada di path) disamarkan
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split("?")[0].replace(/^\/api\/downloads\/[^/]+/, "/api/downloads/[disamarkan]") }) },
  }));
  app.use(helmet());
  app.use("/api", checkOrigin(deps.config.appUrl));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", healthRoutes(deps.db, deps.storage));
  app.use("/api", loadSession(deps));
  app.use("/api/auth", authRoutes(deps));
  app.use("/api/admin/products", productRoutes(deps));
  app.use("/api/catalog", catalogRoutes(deps));
  app.use("/api/cart", cartRoutes(deps));
  app.use("/api/addresses", addressRoutes(deps));
  app.use("/api/checkout", checkoutRoutes(deps));
  app.use("/api/invoices", invoiceRoutes(deps));
  app.use("/api/orders", myOrderRoutes(deps));
  app.use("/api/orders", orderRoutes(deps));
  app.use("/api/orders", receiveRoutes(deps));
  app.use("/api/admin/shipments", shipmentRoutes(deps));
  app.use("/api/admin/orders", adminOrderRoutes(deps));
  app.use("/api/orders", digitalOrderRoutes(deps));
  app.use("/api/downloads", downloadRoutes(deps));
  app.use("/api/admin/payments", adminPaymentRoutes(deps));
  app.use(errorHandler);
  return app;
}
