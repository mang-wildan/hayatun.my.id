import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../../errors.js";
import { requireUser } from "../auth/middleware.js";
import { findOwnOrder } from "../payments-manual/upload.js";
import { licensesOf } from "./licenses.js";

// F7.5: kode lisensi milik pesanan Lunas, hanya untuk pembelinya
export function licenseRoutes(deps: AppDeps) {
  const r = Router();
  r.use(requireUser);
  r.get("/:id/licenses", async (req, res) => {
    const o = await findOwnOrder(deps, req.session!, req.params.id);
    if (o.status !== "LUNAS") throw new HttpError(409, "Pesanan ini belum lunas.", "NOT_PAID");
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ items: await licensesOf(deps, o.id) });
  });
  return r;
}
