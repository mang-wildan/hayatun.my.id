import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../../errors.js";
import { requireUser } from "../auth/middleware.js";
import { findOwnOrder } from "../payments-manual/upload.js";
import { createDownload, listFiles, openDownload } from "./downloads.js";
import { licensesOf } from "./licenses.js";

// Pengiriman digital untuk pembeli, dipasang di /api/orders: kode lisensi (F7.5) dan file unduhan (F7.2, F7.3)
export function digitalOrderRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:id/licenses", async (req, res) => {
    const o = await findOwnOrder(deps, req.session!, req.params.id);
    if (o.status !== "LUNAS") throw new HttpError(409, "Pesanan ini belum lunas.", "NOT_PAID");
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ items: await licensesOf(deps, o.id) });
  });
  r.get("/:id/files", async (req, res) => { res.setHeader("Cache-Control", "private, no-store"); res.json(await listFiles(deps, req.session!, req.params.id)); });
  r.post("/:id/files/:fileId/download", async (req, res) => { res.setHeader("Cache-Control", "private, no-store"); res.json(await createDownload(deps, req.session!, req.params.id, req.params.fileId)); });
  return r;
}

export function downloadRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:token", async (req, res) => { await openDownload(deps, req.session!, req.params.token, res); });
  return r;
}
