import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import { readStore } from "./index.js";
import { readSettings, saveBankAccount, saveStore } from "./service.js";

// Publik: nama dan kontak toko untuk halaman legal (F12.4). Rekening tidak ikut.
export function storeRoutes(deps: AppDeps) {
  const r = Router();
  r.get("/", async (_req, res) => { res.json(await readStore(deps)); });
  return r;
}

export function adminSettingsRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (_req, res) => { res.json(await readSettings(deps)); });
  r.put("/store", async (req, res) => { res.json(await saveStore(deps, req.session!, req.body)); });
  r.put("/bank-account", async (req, res) => { res.json(await saveBankAccount(deps, req.session!, req.body)); });
  return r;
}
