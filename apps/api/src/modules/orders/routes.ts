import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { getMyOrder, listMyOrders } from "./my-orders.js";

export function myOrderRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/", async (req, res) => { res.json(await listMyOrders(deps, req.session!)); });
  r.get("/:id", async (req, res) => { res.json(await getMyOrder(deps, req.session!, req.params.id)); });
  return r;
}
