import { z } from "zod";

const num = z.coerce.number().int().positive();
const base64Key = (name: string) =>
  z.string().transform((v, ctx) => {
    const b = Buffer.from(v, "base64");
    if (b.length !== 32) ctx.addIssue({ code: "custom", message: `${name} harus 32 byte (base64)` });
    return b;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  APP_URL: z.url(),
  APP_TIMEZONE: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_DIR: z.string().min(1),
  WEB_PORT: num,
  API_PORT: num,
  API_INTERNAL_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1),
  SESSION_SECRET: base64Key("SESSION_SECRET"),
  DATA_ENCRYPTION_KEYS: z.string().min(1),
  DATA_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  BLIND_INDEX_KEY: base64Key("BLIND_INDEX_KEY"),
  TOTP_ISSUER: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: num,
  SMTP_USER: z.string(),
  SMTP_PASSWORD: z.string(),
  EMAIL_FROM: z.string().min(1),
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
  PRODUCT_FILE_MAX_MB: z.coerce.number().positive().default(500), // pertanyaan terbuka SPEC 6
  STORAGE_DIR: z.string().min(1),
  STORAGE_INTERNAL_PREFIX: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || v.startsWith("/"), "harus diawali /"),
  // none: belum ada penyedia, checkout produk fisik ditahan (F3.6). Penyedia sungguhan ditambah setelah dipilih (SPEC pertanyaan terbuka 1).
  SHIPPING_PROVIDER: z.enum(["none", "fake"]).default("none"),
  SHIPPING_ORIGIN_AREA_ID: z.string().default(""),
  SHIPPING_TIMEOUT_MS: z.coerce.number().int().min(1).max(5000, "maksimal 5000 (N19)").default(5000),
});

// format DATA_ENCRYPTION_KEYS: "k1:<base64 32 byte>,k2:<base64 32 byte>"
function parseKeys(raw: string): Record<string, Buffer> {
  const keys: Record<string, Buffer> = {};
  for (const part of raw.split(",")) {
    const [id, b64] = part.split(":");
    const key = Buffer.from(b64 ?? "", "base64");
    if (!id || key.length !== 32) throw new Error(`DATA_ENCRYPTION_KEYS: kunci "${id}" harus 32 byte (base64)`);
    keys[id] = key;
  }
  return keys;
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Konfigurasi salah: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && e.SHIPPING_PROVIDER === "fake") throw new Error("Konfigurasi salah: SHIPPING_PROVIDER: tiruan tidak boleh dipakai di produksi");
  const encryptionKeys = parseKeys(e.DATA_ENCRYPTION_KEYS);
  if (!encryptionKeys[e.DATA_ENCRYPTION_ACTIVE_KEY_ID]) {
    throw new Error(`DATA_ENCRYPTION_ACTIVE_KEY_ID: kunci "${e.DATA_ENCRYPTION_ACTIVE_KEY_ID}" tidak ada di DATA_ENCRYPTION_KEYS`);
  }
  return {
    nodeEnv: e.NODE_ENV,
    appUrl: e.APP_URL,
    appTimezone: e.APP_TIMEZONE,
    logLevel: e.LOG_LEVEL,
    logDir: e.LOG_DIR,
    webPort: e.WEB_PORT,
    apiPort: e.API_PORT,
    apiInternalUrl: e.API_INTERNAL_URL,
    databaseUrl: e.DATABASE_URL,
    databaseMigrationUrl: e.DATABASE_MIGRATION_URL,
    sessionSecret: e.SESSION_SECRET,
    encryptionKeys,
    activeKeyId: e.DATA_ENCRYPTION_ACTIVE_KEY_ID,
    blindIndexKey: e.BLIND_INDEX_KEY,
    totpIssuer: e.TOTP_ISSUER,
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, password: e.SMTP_PASSWORD },
    emailFrom: e.EMAIL_FROM,
    adminBootstrapEmail: e.ADMIN_BOOTSTRAP_EMAIL,
    storage: { dir: e.STORAGE_DIR, internalPrefix: e.STORAGE_INTERNAL_PREFIX },
    productFileMaxBytes: Math.round(e.PRODUCT_FILE_MAX_MB * 1024 * 1024),
    shipping: { provider: e.SHIPPING_PROVIDER, originAreaId: e.SHIPPING_ORIGIN_AREA_ID, timeoutMs: e.SHIPPING_TIMEOUT_MS },
    secureCookies: e.NODE_ENV === "production",
  };
}

export type Config = ReturnType<typeof loadConfig>;
