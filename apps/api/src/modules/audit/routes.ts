import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import { listAuditLogs } from "./log.js";

export function auditLogRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (req, res) => { res.json(await listAuditLogs(deps, req.query)); });
  return r;
}
