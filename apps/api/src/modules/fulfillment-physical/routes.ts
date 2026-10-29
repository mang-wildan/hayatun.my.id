import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin, requireUser } from "../auth/middleware.js";
import { listShipments, markReceived, setTracking } from "./shipping.js";

export function shipmentRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (req, res) => { res.json(await listShipments(deps, req.session!)); });
  r.post("/:orderId/tracking", async (req, res) => { res.json(await setTracking(deps, req.session!, req.params.orderId, req.body)); });
  return r;
}

export function receiveRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.post("/:id/received", async (req, res) => { res.json(await markReceived(deps, req.session!, req.params.id)); });
  return r;
}
