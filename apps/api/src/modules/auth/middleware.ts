import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../errors.js";
import { resolveSession, SESSION_COOKIE, type Role, type SessionUser } from "./sessions.js";

declare global {
  namespace Express {
    interface Request { session?: SessionUser }
  }
}

export function loadSession(deps: { db: Db; now: () => Date }): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) req.session = (await resolveSession(deps.db, token, deps.now())) ?? undefined;
    next();
  };
}

const requireRole = (role: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.session) {
    // cookie ada tapi tidak berlaku = sesi habis; tanpa cookie = belum pernah masuk
    throw req.cookies?.[SESSION_COOKIE]
      ? new HttpError(401, "Sesimu sudah habis, silakan masuk lagi ya.", "SESSION_EXPIRED")
      : new HttpError(401, "Kamu perlu masuk dulu ya.", "UNAUTHENTICATED");
  }
  if (req.session.role !== role) throw new HttpError(403, "Kamu tidak punya akses ke halaman ini.", "FORBIDDEN");
  next();
};

export const requireBuyer = requireRole("buyer");
export const requireAdmin = requireRole("admin");
