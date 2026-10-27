import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  totpLastStep: bigint("totp_last_step", { mode: "number" }), // langkah waktu kode terakhir yang diterima, agar kode tidak dipakai ulang
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

// Produk tidak pernah dihapus permanen (F9.9); hanya dinonaktifkan, supaya invoice lama tetap utuh.
export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type", { enum: ["digital", "physical"] }).notNull(),
  price: integer("price").notNull(), // Rupiah, bilangan bulat
  weightG: integer("weight_g"),
  stockQty: integer("stock_qty").notNull().default(0), // termasuk yang sedang ditahan
  stockReserved: integer("stock_reserved").notNull().default(0),
  stockSold: integer("stock_sold").notNull().default(0),
  isLicensed: boolean("is_licensed").notNull().default(false),
  coverKey: text("cover_key"),
  coverUpdatedAt: ts("cover_updated_at"),
  active: boolean("active").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("products_active_created_idx").on(t.active, t.createdAt),
  check("products_price_positive", sql`${t.price} > 0`),
  check("products_physical_needs_weight", sql`${t.type} <> 'physical' or ${t.weightG} > 0`), // F9.6
  check("products_stock_non_negative", sql`${t.stockQty} >= 0 and ${t.stockReserved} >= 0 and ${t.stockSold} >= 0`),
]);

export const productFiles = pgTable("product_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  kind: text("kind", { enum: ["file", "link"] }).notNull(),
  storageKey: text("storage_key"),
  url: text("url"),
  filename: text("filename").notNull(), // nama file, atau nama tautan
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  contentType: text("content_type"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("product_files_product_idx").on(t.productId),
  check("product_files_kind_data", sql`(${t.kind} = 'file' and ${t.storageKey} is not null) or (${t.kind} = 'link' and ${t.url} is not null)`),
]);
