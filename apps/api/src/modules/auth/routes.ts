import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "./middleware.js";
import { clearSessionCookie, revokeSession, setSessionCookie } from "./sessions.js";
import { CHECK_EMAIL, getMe, login, registerBuyer, resendVerification, verifyEmail } from "./service.js";

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

  r.post("/login", async (req, res) => {
    const result = await login(deps, req.body);
    if (result.next !== "done") return void res.json(result);
    setSessionCookie(res, result.session.token, result.session.expiresAt, deps.config.secureCookies);
    res.json({ next: "done", user: result.user });
  });

  r.post("/logout", async (req, res) => {
    if (req.session) await revokeSession(deps.db, req.session.sessionId);
    clearSessionCookie(res);
    res.status(204).end();
  });

  return r;
}
