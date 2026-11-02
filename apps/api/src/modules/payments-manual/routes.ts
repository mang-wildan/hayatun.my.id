import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { gatewayLink } from "../gateway/index.js";
import { getPaymentInstructions } from "./service.js";
import { cancelByBuyer } from "./cancel.js";
import { findOwnOrder, uploadProof } from "./upload.js";

export function orderRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:id/payment", async (req, res) => { res.json(await getPaymentInstructions(deps, req.session!, req.params.id)); });
  r.post("/:id/payment/gateway", async (req, res) => { res.json({ paymentUrl: await gatewayLink(deps, (await findOwnOrder(deps, req.session!, req.params.id)).id) }); }); // T64
  r.post("/:id/cancel", async (req, res) => { res.json(await cancelByBuyer(deps, req.session!, req.params.id)); });
  r.post("/:id/proof", async (req, res) => { res.status(201).json(await uploadProof(deps, req.session!, req.params.id, req)); });
  return r;
}
