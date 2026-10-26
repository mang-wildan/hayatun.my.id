import { sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "../../db/client.js";
import type { Storage } from "../storage/index.js";

// N22: dipantau dari luar setiap menit; memeriksa database dan disk privat untuk file
export function healthRoutes(db: Pick<Db, "execute">, storage: Pick<Storage, "checkWritable">) {
  const r = Router();
  r.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
    } catch {
      return void res.status(503).json({ status: "error", message: "Database tidak bisa dihubungi." });
    }
    try {
      await storage.checkWritable();
    } catch {
      return void res.status(503).json({ status: "error", message: "Penyimpanan file tidak bisa ditulis." });
    }
    res.json({ status: "ok" });
  });
  return r;
}
