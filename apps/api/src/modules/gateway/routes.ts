import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../../errors.js";
import { handleGatewayWebhook } from "./webhook.js";

// Dipanggil gateway (server ke server), tanpa sesi: keasliannya dijamin tanda tangan, bukan cookie. Badan mentah dari express.raw (lihat app.ts).
export function webhookRoutes(deps: AppDeps) {
  const r = Router();
  r.post("/", async (req, res) => {
    if (deps.config.gateway.provider === "none") throw new HttpError(404, "Tidak ditemukan.", "NOT_FOUND");
    await handleGatewayWebhook(deps, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers);
    res.json({ status: "ok" });
  });
  return r;
}
