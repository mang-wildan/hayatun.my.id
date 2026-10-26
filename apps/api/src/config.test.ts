import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const b64 = (n: number) => Buffer.alloc(n, 7).toString("base64");
const validEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  APP_URL: "https://hayatun.my.id",
  APP_TIMEZONE: "Asia/Jakarta",
  LOG_LEVEL: "info",
  LOG_DIR: "/tmp/hayatun-log",
  WEB_PORT: "3000",
  API_PORT: "4000",
  API_INTERNAL_URL: "http://127.0.0.1:4000",
  DATABASE_URL: "postgres://app:x@127.0.0.1:5432/hayatun",
  DATABASE_MIGRATION_URL: "postgres://migrate:x@127.0.0.1:5432/hayatun",
  SESSION_SECRET: b64(32),
  DATA_ENCRYPTION_KEYS: `k1:${b64(32)}`,
  DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1",
  BLIND_INDEX_KEY: b64(32),
  TOTP_ISSUER: "Hayatun",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_USER: "u",
  SMTP_PASSWORD: "p",
  EMAIL_FROM: "toko@hayatun.my.id",
  STORAGE_DIR: "/srv/hayatun/files",
  ...over,
});

describe("loadConfig", () => {
  it("menyebut nama variabel yang kurang", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it("membaca kunci enkripsi 32 byte dan port sebagai angka", () => {
    const c = loadConfig(validEnv());
    expect(c.encryptionKeys.k1.length).toBe(32);
    expect(c.activeKeyId).toBe("k1");
    expect(c.apiPort).toBe(4000);
    expect(c.blindIndexKey.length).toBe(32);
  });
  it("mendukung beberapa kunci untuk rotasi", () => {
    const c = loadConfig(validEnv({ DATA_ENCRYPTION_KEYS: `k1:${b64(32)},k2:${b64(32)}`, DATA_ENCRYPTION_ACTIVE_KEY_ID: "k2" }));
    expect(Object.keys(c.encryptionKeys)).toEqual(["k1", "k2"]);
  });
  it("menolak kunci yang bukan 32 byte", () => {
    expect(() => loadConfig(validEnv({ DATA_ENCRYPTION_KEYS: `k1:${b64(16)}` }))).toThrow(/32 byte/);
  });
  it("menolak ID kunci aktif yang tidak ada di daftar kunci", () => {
    expect(() => loadConfig(validEnv({ DATA_ENCRYPTION_ACTIVE_KEY_ID: "k9" }))).toThrow(/k9/);
  });
  it("cookie Secure aktif kecuali test dan development", () => {
    expect(loadConfig(validEnv({ NODE_ENV: "production" })).secureCookies).toBe(true);
    expect(loadConfig(validEnv({ NODE_ENV: "test" })).secureCookies).toBe(false);
  });
  it("membaca lokasi penyimpanan; prefix internal Nginx opsional dan harus diawali /", () => {
    expect(loadConfig(validEnv()).storage).toEqual({ dir: "/srv/hayatun/files", internalPrefix: undefined });
    expect(loadConfig(validEnv({ STORAGE_INTERNAL_PREFIX: "/_files" })).storage.internalPrefix).toBe("/_files");
    expect(() => loadConfig(validEnv({ STORAGE_DIR: "" }))).toThrow(/STORAGE_DIR/);
    expect(() => loadConfig(validEnv({ STORAGE_INTERNAL_PREFIX: "_files" }))).toThrow(/STORAGE_INTERNAL_PREFIX/);
  });
});
