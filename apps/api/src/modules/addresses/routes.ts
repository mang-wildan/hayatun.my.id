import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "../auth/middleware.js";
import { createAddress, deleteAddress, listAddresses, updateAddress } from "./service.js";

export function addressRoutes(deps: AppDeps) {
  const r = Router();
  const me = (req: { session?: { userId: string } }) => req.session!.userId;
  r.use(requireUser);

  r.get("/", async (req, res) => { res.json(await listAddresses(deps, me(req))); });
  r.post("/", async (req, res) => { res.status(201).json(await createAddress(deps, me(req), req.body)); });
  r.patch("/:id", async (req, res) => { res.json(await updateAddress(deps, me(req), req.params.id, req.body)); });
  r.delete("/:id", async (req, res) => {
    await deleteAddress(deps, me(req), req.params.id);
    res.status(204).end();
  });
  return r;
}
