import pino from "pino";
import request from "supertest";
import { describe, it } from "vitest";
import { createApp } from "../../app.js";

const ok = async () => {};
const appWith = (execute: () => Promise<unknown>, checkWritable: () => Promise<void> = ok) =>
  createApp({
    config: { secureCookies: false } as never,
    db: { execute } as never,
    logger: pino({ level: "silent" }),
    queue: {} as never,
    crypto: {} as never,
    storage: { checkWritable } as never,
    now: () => new Date(),
  });

describe("GET /api/health", () => {
  it("200 bila database terjangkau", async () => {
    await request(appWith(async () => [])).get("/api/health").expect(200, { status: "ok" });
  });
  it("503 dengan pesan jelas bila database mati", async () => {
    const down = async () => { throw new Error("ECONNREFUSED"); };
    await request(appWith(down)).get("/api/health").expect(503, { status: "error", message: "Database tidak bisa dihubungi." });
  });
  it("503 bila disk penyimpanan file tidak bisa ditulis", async () => {
    const readOnly = async () => { throw new Error("EROFS"); };
    await request(appWith(async () => [], readOnly)).get("/api/health").expect(503, { status: "error", message: "Penyimpanan file tidak bisa ditulis." });
  });
});
