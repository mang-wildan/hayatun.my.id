import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { addItem, getCart, removeItem, setQty } from "./service.js";

export function cartRoutes(deps: AppDeps) {
  const r = Router();
  const me = (req: { session?: { userId: string } }) => req.session!.userId;
  r.use(requireUser);

  r.get("/", async (req, res) => { res.json(await getCart(deps, me(req))); });
  r.post("/items", async (req, res) => { res.status(201).json(await addItem(deps, me(req), req.body)); });
  r.patch("/items/:productId", async (req, res) => { res.json(await setQty(deps, me(req), req.params.productId, req.body)); });
  r.delete("/items/:productId", async (req, res) => {
    await removeItem(deps, me(req), req.params.productId);
    res.status(204).end();
  });
  return r;
}
