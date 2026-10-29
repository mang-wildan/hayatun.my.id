import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import { acceptPayment, openProof, rejectPayment, verificationQueue } from "./verify.js";

export function adminPaymentRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (req, res) => { res.json(await verificationQueue(deps, req.session!)); });
  r.get("/:orderId/proof", async (req, res) => { await openProof(deps, req.session!, req.params.orderId, res); });
  r.post("/:orderId/accept", async (req, res) => { res.json(await acceptPayment(deps, req.session!, req.params.orderId)); });
  r.post("/:orderId/reject", async (req, res) => { res.json(await rejectPayment(deps, req.session!, req.params.orderId, req.body)); });
  return r;
}
