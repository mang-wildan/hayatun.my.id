import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { getCatalogCover, getCatalogProduct, listCatalog } from "./service.js";

// Publik: tanpa login (F2.2). Hanya produk aktif, dan hanya yang perlu untuk kartu dan halaman detail.
export function catalogRoutes(deps: AppDeps) {
  const r = Router();
  r.get("/", async (_req, res) => { res.json(await listCatalog(deps)); });
  r.get("/:slug", async (req, res) => { res.json(await getCatalogProduct(deps, req.params.slug)); });
  r.get("/:slug/cover", async (req, res) => {
    const { key, ...file } = await getCatalogCover(deps, req.params.slug);
    await deps.storage.send(res, key, file);
  });
  return r;
}
