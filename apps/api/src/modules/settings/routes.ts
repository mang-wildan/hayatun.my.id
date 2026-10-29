import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { readStore } from "./index.js";

// Publik: nama dan kontak toko untuk halaman legal (F12.4). Rekening tidak ikut.
export function storeRoutes(deps: AppDeps) {
  const r = Router();
  r.get("/", async (_req, res) => { res.json(await readStore(deps)); });
  return r;
}
