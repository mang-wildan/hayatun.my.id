import { bigserial, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role", { enum: ["buyer", "admin"] }).notNull(),
  status: text("status", { enum: ["invited", "active", "disabled", "deleted"] }).notNull().default("active"),
  emailEnc: text("email_enc").notNull(),
  emailIndex: text("email_index").notNull().unique(), // HMAC email ternormalisasi, untuk login dan cek duplikat
  nameEnc: text("name_enc"),
  phoneEnc: text("phone_enc"),
  passwordHash: text("password_hash"), // kosong selama status invited
  emailVerifiedAt: ts("email_verified_at"),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  idHash: text("id_hash").notNull().unique(), // hanya hash token yang disimpan
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type", { enum: ["verify_email", "reset_password", "admin_invite", "mfa_challenge"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  emailIndex: text("email_index").notNull(),
  success: boolean("success").notNull(),
  attemptedAt: ts("attempted_at").notNull().defaultNow(),
}, (t) => [index("login_attempts_email_idx").on(t.emailIndex, t.attemptedAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details").notNull().default({}), // tanpa data pribadi
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const storeSettings = pgTable("store_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
