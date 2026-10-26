import { Router, type Response } from "express";
import type { AppDeps } from "../../app.js";
import { requireUser } from "./middleware.js";
import { clearSessionCookie, revokeSession, setSessionCookie } from "./sessions.js";
import {
  CHECK_EMAIL, FORGOT_MESSAGE, forgotPassword, getMe, login, loginTotp, registerBuyer, resendVerification, resetPassword,
  totpConfirm, totpDisable, totpSetup, verifyEmail,
} from "./service.js";

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

  r.post("/forgot-password", async (req, res) => {
    await forgotPassword(deps, req.body);
    res.status(202).json({ message: FORGOT_MESSAGE });
  });

  r.post("/reset-password", async (req, res) => {
    await resetPassword(deps, req.body);
    res.json({ message: "Password-mu sudah diganti. Silakan masuk lagi ya." });
  });

  const sendLogin = (res: Response, done: Awaited<ReturnType<typeof loginTotp>>) => {
    setSessionCookie(res, done.session.token, done.session.expiresAt, deps.config.secureCookies);
    res.json({ next: "done", user: done.user });
  };

  r.post("/login/totp", async (req, res) => {
    sendLogin(res, await loginTotp(deps, req.body ?? {}));
  });

  r.post("/totp/setup", async (req, res) => {
    res.json(await totpSetup(deps, req.session?.userId, req.body ?? {}));
  });

  r.post("/totp/confirm", async (req, res) => {
    const done = await totpConfirm(deps, req.session?.userId, req.body ?? {});
    if (done) return sendLogin(res, done);
    res.json({ message: "Verifikasi dua langkah sudah aktif." });
  });

  r.post("/totp/disable", requireUser, async (req, res) => {
    await totpDisable(deps, req.session!.userId, req.body ?? {});
    res.json({ message: "Verifikasi dua langkah sudah dimatikan." });
  });

  return r;
}
