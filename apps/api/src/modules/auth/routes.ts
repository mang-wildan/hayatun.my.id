import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "./middleware.js";
import { CHECK_EMAIL, getMe, registerBuyer, resendVerification, verifyEmail } from "./service.js";

export function authRoutes(deps: AppDeps) {
  const r = Router();

  r.post("/register", async (req, res) => {
    await registerBuyer(deps, req.body);
    res.status(202).json({ message: CHECK_EMAIL });
  });

  r.post("/verify-email", async (req, res) => {
    await verifyEmail(deps, req.body?.token);
    res.json({ message: "Emailmu sudah terverifikasi. Selamat belanja!" });
  });

  r.post("/resend-verification", async (req, res) => {
    await resendVerification(deps, req.body);
    res.status(202).json({ message: CHECK_EMAIL });
  });

  r.get("/me", requireUser, async (req, res) => {
    res.json(await getMe(deps, req.session!.userId));
  });

  return r;
}
