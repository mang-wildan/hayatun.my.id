import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import { cancelOrder } from "./cancel.js";

export function adminOrderRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.post("/:id/cancel", async (req, res) => { res.json(await cancelOrder(deps, req.session!, req.params.id, req.body)); });
  return r;
}
