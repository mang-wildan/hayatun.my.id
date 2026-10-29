import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import { disableAdmin, disableBuyerTotp, inviteAdmin, listAdmins, lookupBuyer } from "./service.js";

export function adminAdminRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (_req, res) => { res.json(await listAdmins(deps)); });
  r.post("/", async (req, res) => { res.status(201).json(await inviteAdmin(deps, req.session!, req.body)); });
  r.post("/:id/disable", async (req, res) => { res.json(await disableAdmin(deps, req.session!, req.params.id)); });
  return r;
}

export function adminUserRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.post("/lookup", async (req, res) => { res.json(await lookupBuyer(deps, req.session!, req.body)); });
  r.post("/:id/totp/disable", async (req, res) => { res.json(await disableBuyerTotp(deps, req.session!, req.params.id)); });
  return r;
}
