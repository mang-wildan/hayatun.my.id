import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { checkout, quote } from "./service.js";

export function checkoutRoutes(deps: AppDeps) {
  const r = Router();
  const me = (req: { session?: { userId: string } }) => req.session!.userId;
  r.use(requireUser); // F1.1
  r.post("/quote", async (req, res) => { res.json(await quote(deps, me(req), req.body)); });
  r.post("/", async (req, res) => { res.status(201).json(await checkout(deps, me(req), req.body)); });
  return r;
}
