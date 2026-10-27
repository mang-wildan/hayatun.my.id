import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { getInvoice } from "./service.js";

export function invoiceRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:orderId", async (req, res) => { res.json(await getInvoice(deps, req.session!, req.params.orderId)); });
  return r;
}
