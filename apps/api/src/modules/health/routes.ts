import { sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "../../db/client.js";

export function healthRoutes(db: Pick<Db, "execute">) {
  const r = Router();
  r.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "error", message: "Database tidak bisa dihubungi." });
    }
  });
  return r;
}
