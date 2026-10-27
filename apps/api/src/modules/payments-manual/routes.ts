import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { getPaymentInstructions } from "./service.js";
import { uploadProof } from "./upload.js";

export function orderRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:id/payment", async (req, res) => { res.json(await getPaymentInstructions(deps, req.session!, req.params.id)); });
  r.post("/:id/proof", async (req, res) => { res.status(201).json(await uploadProof(deps, req.session!, req.params.id, req)); });
  return r;
}
