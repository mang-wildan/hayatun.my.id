import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { users } from "../db/schema.js";
import { createMemoryQueue } from "../jobs/queue.js";
import { createLogger } from "../logger.js";
import { hashPassword } from "../modules/auth/password.js";
import { createSession } from "../modules/auth/sessions.js";
import { createCrypto } from "../modules/crypto/index.js";
import { createMemoryMailer, type Mailer } from "../modules/notifications/mailer.js";
import { registerEmailWorker } from "../modules/notifications/worker.js";
import { createStorage } from "../modules/storage/index.js";
import { resetDb, testDb } from "./db.js";

export const APP_URL = "https://hayatun.my.id";
export const T0 = new Date("2026-10-26T07:00:00Z");

const b64 = () => randomBytes(32).toString("base64");

export function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    APP_URL,
    APP_TIMEZONE: "Asia/Jakarta",
    LOG_LEVEL: "silent",
    LOG_DIR: "/tmp",
    WEB_PORT: "3000",
    API_PORT: "4000",
    API_INTERNAL_URL: "http://127.0.0.1:4000",
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
    SESSION_SECRET: b64(),
    DATA_ENCRYPTION_KEYS: `k1:${b64()}`,
    DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    BLIND_INDEX_KEY: b64(),
    TOTP_ISSUER: "Hayatun",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    EMAIL_FROM: "toko@hayatun.my.id",
    STORAGE_DIR: mkdtempSync(join(tmpdir(), "hayatun-files-")),
  });
}

// App lengkap dengan database tes, antrean memori, email memori, dan jam yang bisa dimajukan.
export async function createTestContext(over: { mailer?: Mailer } = {}) {
  await resetDb();
  const { db, pool } = testDb();
  const config = testConfig();
  const crypto = createCrypto({ keys: config.encryptionKeys, activeKeyId: config.activeKeyId, blindIndexKey: config.blindIndexKey });
  const logger = createLogger({ logLevel: "silent" });
  const queue = createMemoryQueue();
  const memoryMailer = createMemoryMailer();
  await registerEmailWorker(queue, { mailer: over.mailer ?? memoryMailer, crypto, logger });
  const clock = {
    now: T0,
    advance(ms: number) { this.now = new Date(this.now.getTime() + ms); },
  };
  const storage = createStorage(config.storage);
  const app = createApp({ config, db, logger, queue, crypto, storage, now: () => clock.now });

  // pengguna langsung di database, untuk tes yang tidak menguji pendaftaran
  async function createUser(u: {
    email: string;
    password?: string;
    name?: string;
    role?: "buyer" | "admin";
    status?: "invited" | "active" | "disabled" | "deleted";
    verified?: boolean;
    totpSecret?: string;
  }) {
    const [row] = await db
      .insert(users)
      .values({
        role: u.role ?? "buyer",
        status: u.status ?? "active",
        emailEnc: crypto.encrypt(u.email.trim().toLowerCase()),
        emailIndex: crypto.blindIndex(u.email),
        nameEnc: crypto.encrypt(u.name ?? "Budi"),
        passwordHash: u.password ? await hashPassword(u.password) : null,
        emailVerifiedAt: u.verified === false ? null : clock.now,
        totpSecretEnc: u.totpSecret ? crypto.encrypt(u.totpSecret) : null,
        totpEnabled: Boolean(u.totpSecret),
      })
      .returning({ id: users.id });
    return row.id;
  }

  // cookie sesi untuk admin atau pembeli baru, langsung dibuat di database
  let seq = 0;
  async function cookieFor(role: "admin" | "buyer", over: { status?: "active" | "disabled" } = {}) {
    const email = `${role}${++seq}@hayatun.test`;
    const id = await createUser({ email, password: "rahasia-hayatun-1", role, name: `${role} ${seq}`, ...over });
    return `hayatun_sid=${(await createSession(db, { id, role }, clock.now)).token}`;
  }

  // jalankan antrean lalu kembalikan email yang terkirim
  async function emails() {
    await queue.runAll();
    return memoryMailer.sent;
  }

  return {
    app, db, crypto, config, queue, storage, clock, createUser, emails,
    adminCookie: () => cookieFor("admin"),
    buyerCookie: () => cookieFor("buyer"),
    post: (path: string, body?: object, cookie?: string) => {
      const r = request(app).post(path).send(body ?? {});
      return cookie ? r.set("Cookie", cookie) : r;
    },
    get: (path: string, cookie?: string) => {
      const r = request(app).get(path);
      return cookie ? r.set("Cookie", cookie) : r;
    },
    close: () => pool.end(),
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export const linkFrom = (text: string) => text.match(/https:\/\/\S+/)![0];
export const tokenFrom = (link: string) => new URL(link).searchParams.get("token")!;
export const cookieOf = (res: { headers: Record<string, unknown> }) =>
  (res.headers["set-cookie"] as string[] | undefined)?.[0]?.split(";")[0] ?? "";
