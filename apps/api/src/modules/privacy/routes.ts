import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireBuyer } from "../auth/middleware.js";
import { cancelDeletion, getDeletion, requestDeletion } from "./delete-account.js";

export function accountRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireBuyer);
  r.get("/deletion", async (req, res) => { res.json(await getDeletion(deps, req.session!)); });
  r.post("/deletion", async (req, res) => { res.json(await requestDeletion(deps, req.session!, req.body)); });
  r.delete("/deletion", async (req, res) => { res.json(await cancelDeletion(deps, req.session!)); });
  return r;
}
