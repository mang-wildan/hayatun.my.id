import { DIGITAL_STATUSES, ORDER_STATUSES, PHYSICAL_STATUSES } from "@hayatun/shared";
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
  lowStockNotified: boolean("low_stock_notified").notNull().default(false), // admin sudah dikabari untuk penurunan ini (F9.5)
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

// Kode lisensi untuk produk digital berlisensi. Isi kode terenkripsi; `code_index` (blind index) hanya untuk menolak duplikat.
export const licenseCodes = pgTable("license_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  codeEnc: text("code_enc").notNull(),
  codeIndex: text("code_index").notNull(),
  status: text("status", { enum: ["available", "reserved", "assigned"] }).notNull().default("available"),
  orderItemId: uuid("order_item_id"), // diisi saat pesanan dibuat (T28)
  assignedAt: ts("assigned_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  unique("license_codes_product_code_unique").on(t.productId, t.codeIndex), // F9.7
  index("license_codes_status_idx").on(t.productId, t.status),
]);

// Keranjang per akun (F3.1). Tidak menahan stok; penahanan terjadi saat checkout (T28).
export const cartItems = pgTable("cart_items", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  qty: integer("qty").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.productId] }),
  check("cart_items_qty_range", sql`${t.qty} between 1 and 99`),
]);

// Alamat pembeli (F12.1). Nama, nomor HP, dan alamat terenkripsi; area_id dan kode pos terbuka karena hanya itu yang dikirim ke penyedia ongkir (N27).
export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientEnc: text("recipient_enc").notNull(),
  phoneEnc: text("phone_enc").notNull(),
  addressEnc: text("address_enc").notNull(),
  areaId: text("area_id").notNull(),
  postalCode: text("postal_code").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("addresses_user_idx").on(t.userId, t.createdAt)]);

// Pesanan (F3.4). Status mengikuti mesin status di modules/orders; alamat disalin terenkripsi supaya invoice lama tidak berubah.
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ORDER_STATUSES }).notNull(),
  digitalStatus: text("digital_status", { enum: DIGITAL_STATUSES }).notNull(),
  physicalStatus: text("physical_status", { enum: PHYSICAL_STATUSES }).notNull(),
  paymentMethod: text("payment_method", { enum: ["manual", "gateway"] }).notNull().default("manual"),
  subtotal: integer("subtotal").notNull(),
  shippingCost: integer("shipping_cost").notNull(),
  total: integer("total").notNull(),
  expiresAt: ts("expires_at").notNull(),
  shipRecipientEnc: text("ship_recipient_enc"),
  shipPhoneEnc: text("ship_phone_enc"),
  shipAddressEnc: text("ship_address_enc"),
  shipAreaId: text("ship_area_id"),
  shipPostalCode: text("ship_postal_code"),
  courier: text("courier"),
  courierService: text("courier_service"),
  verifiedBy: uuid("verified_by").references(() => users.id), // admin yang menerima bukti (F5.2)
  paidAt: ts("paid_at"),
  reminderSentAt: ts("reminder_sent_at"), // pengingat 3 jam sudah dikirim (F4.5); ditandai atomik supaya tidak ganda
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("orders_user_idx").on(t.userId, t.createdAt),
  index("orders_status_idx").on(t.status, t.expiresAt),
  check("orders_amounts", sql`${t.subtotal} >= 0 and ${t.shippingCost} >= 0 and ${t.total} = ${t.subtotal} + ${t.shippingCost}`),
]);

// Harga dan nama dikunci saat checkout (F3.4, F9.8)
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  productType: text("product_type", { enum: ["digital", "physical"] }).notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPrice: integer("unit_price").notNull(),
  qty: integer("qty").notNull(),
}, (t) => [index("order_items_order_idx").on(t.orderId), check("order_items_qty_positive", sql`${t.qty} > 0`)]);

// Satu baris per bulan (YYYYMM), dikunci saat mengambil nomor (F6.1)
export const invoiceCounters = pgTable("invoice_counters", {
  period: text("period").primaryKey(),
  lastNumber: integer("last_number").notNull(),
});

// Bukti bayar (F4.3). File terenkripsi di disk privat; baris ini tetap ada sebagai catatan walau file dihapus setelah 1 tahun (F12.3).
export const paymentProofs = pgTable("payment_proofs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(), // dari isi file, bukan dari kiriman pembeli
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
  rejectReason: text("reject_reason"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
}, (t) => [index("payment_proofs_order_idx").on(t.orderId, t.uploadedAt)]);
