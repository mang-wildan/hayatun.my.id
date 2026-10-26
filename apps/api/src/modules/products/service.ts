import { createProductSchema, linkSchema, productRuleErrors, updateProductSchema } from "@hayatun/shared";
import { and, count, desc, eq } from "drizzle-orm";
import type { Request } from "express";
import type { AppDeps } from "../../app.js";
import { productFiles, products } from "../../db/schema.js";
import { HttpError } from "../../errors.js";
import { recordAudit } from "../audit/index.js";

type Deps = Pick<AppDeps, "config" | "db" | "storage" | "now">;
type Product = typeof products.$inferSelect;
type ProductFile = typeof productFiles.$inferSelect;
type Details = Record<string, string | number | boolean>;

export const MAX_FILES = 20;
const COVER = { allowed: ["jpg", "png", "webp"], maxBytes: 5 * 1024 * 1024 } as const;
const COVER_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const notFound = () => new HttpError(404, "Produk tidak ditemukan.", "PRODUCT_NOT_FOUND");
const invalid = (field: string, message: string) => new HttpError(422, message, "VALIDATION", { [field]: message });

export interface Stock { available: number | null; reserved: number; sold: number }

export function stockOf(p: Product): Stock {
  if (p.type === "physical") return { available: p.stockQty - p.stockReserved, reserved: p.stockReserved, sold: p.stockSold };
  // produk digital berlisensi dihitung dari kode (T19); tanpa lisensi tidak ada batas
  return { available: p.isLicensed ? 0 : null, reserved: 0, sold: p.stockSold };
}

export const coverUrl = (p: Product) => (p.coverKey ? `/api/admin/products/${p.id}/cover?v=${p.coverUpdatedAt?.getTime() ?? 0}` : null);

const fileView = (f: ProductFile) => ({ id: f.id, kind: f.kind, filename: f.filename, sizeBytes: f.sizeBytes, url: f.url });

function summary(p: Product, fileCount: number, stock: Stock) {
  return { id: p.id, slug: p.slug, name: p.name, type: p.type, price: p.price, active: p.active, isLicensed: p.isLicensed, coverUrl: coverUrl(p), stock, fileCount };
}

async function detail(deps: Deps, p: Product) {
  const files = await deps.db.select().from(productFiles).where(eq(productFiles.productId, p.id)).orderBy(productFiles.createdAt);
  return {
    ...summary(p, files.length, stockOf(p)),
    description: p.description,
    weightG: p.weightG,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files: files.map(fileView),
  };
}
export type ProductDetail = Awaited<ReturnType<typeof detail>>;

async function load(deps: Deps, id: string): Promise<Product> {
  if (!UUID.test(id)) throw notFound();
  const [p] = await deps.db.select().from(products).where(eq(products.id, id));
  if (!p) throw notFound();
  return p;
}

const slugify = (name: string) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "produk";

const audit = (deps: Deps, actorId: string, action: string, entityId: string, details?: Details) =>
  recordAudit(deps.db, { actorId, action, entityType: "product", entityId, details });

export async function listProducts(deps: Deps) {
  const rows = await deps.db.select().from(products).orderBy(desc(products.createdAt));
  const counts = await deps.db.select({ id: productFiles.productId, n: count() }).from(productFiles).groupBy(productFiles.productId);
  const byProduct = new Map(counts.map((c) => [c.id, c.n]));
  return { products: rows.map((p) => summary(p, byProduct.get(p.id) ?? 0, stockOf(p))) };
}

export async function getProduct(deps: Deps, id: string) {
  return detail(deps, await load(deps, id));
}

export async function createProduct(deps: Deps, actorId: string, input: unknown) {
  const body = createProductSchema.parse(input);
  const rules = productRuleErrors(body);
  if (Object.keys(rules).length) throw new HttpError(422, Object.values(rules)[0], "VALIDATION", rules);
  const physical = body.type === "physical";
  const now = deps.now();

  // slug unik: bila sudah dipakai, ditambah -2, -3, ... (aman terhadap pembuatan bersamaan)
  const base = slugify(body.name);
  for (let n = 1; n < 1000; n++) {
    const [created] = await deps.db
      .insert(products)
      .values({
        slug: n === 1 ? base : `${base}-${n}`,
        name: body.name,
        description: body.description ?? "",
        type: body.type,
        price: body.price,
        weightG: physical ? body.weightG : null,
        stockQty: physical ? (body.stockQty ?? 0) : 0,
        isLicensed: !physical && (body.isLicensed ?? false),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: products.slug })
      .returning();
    if (created) {
      await audit(deps, actorId, "product.created", created.id);
      return detail(deps, created);
    }
  }
  throw new HttpError(500, "Alamat produk tidak bisa dibuat. Coba nama yang lain ya.");
}

export async function updateProduct(deps: Deps, actorId: string, id: string, input: unknown) {
  const p = await load(deps, id);
  const body = updateProductSchema.parse(input);
  if (body.type !== undefined && body.type !== p.type) throw invalid("type", "Jenis produk tidak bisa diubah. Buat produk baru kalau perlu.");

  const merged = { ...p, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as Product;
  const rules = productRuleErrors({ type: p.type, weightG: merged.weightG, isLicensed: merged.isLicensed });
  if (Object.keys(rules).length) throw new HttpError(422, Object.values(rules)[0], "VALIDATION", rules);

  const physical = p.type === "physical";
  const changed: Details = {};
  const set: Partial<typeof products.$inferInsert> = { updatedAt: deps.now() };
  if (body.name !== undefined && body.name !== p.name) { set.name = body.name; changed.name = true; }
  if (body.description !== undefined && body.description !== p.description) { set.description = body.description; changed.description = true; }
  if (body.price !== undefined && body.price !== p.price) { set.price = body.price; changed.price = true; }
  if (physical && body.weightG !== undefined && body.weightG !== p.weightG) { set.weightG = body.weightG; changed.weightG = true; }
  if (!physical && body.isLicensed !== undefined && body.isLicensed !== p.isLicensed) { set.isLicensed = body.isLicensed; changed.isLicensed = true; }
  const stockChange = physical && body.stockQty !== undefined && body.stockQty !== p.stockQty;
  if (stockChange) set.stockQty = body.stockQty;

  const [updated] = Object.keys(changed).length || stockChange
    ? await deps.db.update(products).set(set).where(eq(products.id, p.id)).returning()
    : [p];
  if (Object.keys(changed).length) await audit(deps, actorId, "product.updated", p.id, changed);
  if (stockChange) await audit(deps, actorId, "product.stock_changed", p.id, { from: p.stockQty, to: body.stockQty! });
  return detail(deps, updated);
}

export async function setActive(deps: Deps, actorId: string, id: string, active: boolean) {
  const p = await load(deps, id);
  if (p.active === active) return detail(deps, p);
  if (active && p.type === "digital") {
    const [{ n }] = await deps.db.select({ n: count() }).from(productFiles).where(eq(productFiles.productId, p.id));
    if (!n) throw new HttpError(422, "Produk digital perlu minimal satu file atau tautan sebelum dijual.", "NO_FILES");
  }
  const [updated] = await deps.db.update(products).set({ active, updatedAt: deps.now() }).where(eq(products.id, p.id)).returning();
  await audit(deps, actorId, active ? "product.activated" : "product.deactivated", p.id);
  return detail(deps, updated);
}

async function assertCanAddFile(deps: Deps, p: Product) {
  if (p.type !== "digital") throw new HttpError(422, "Produk fisik tidak punya file unduhan.", "NOT_DIGITAL");
  const [{ n }] = await deps.db.select({ n: count() }).from(productFiles).where(eq(productFiles.productId, p.id));
  if (n >= MAX_FILES) throw new HttpError(422, `Maksimal ${MAX_FILES} file atau tautan per produk.`, "TOO_MANY_FILES");
}

// Nama file dari pengguna: hanya bagian akhir path, tanpa karakter kontrol
function cleanFilename(raw: unknown): string {
  const name = typeof raw === "string" ? (raw.split(/[\\/\r\n]+/).filter(Boolean).at(-1) ?? "") : "";
  // eslint-disable-next-line no-control-regex -- sengaja: membuang karakter kontrol dari nama file
  const clean = name.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!clean) throw invalid("filename", "Nama file wajib diisi.");
  if (clean.length > 200) throw invalid("filename", "Nama file maksimal 200 karakter.");
  return clean;
}

export async function addFile(deps: Deps, actorId: string, id: string, req: Request) {
  const p = await load(deps, id);
  await assertCanAddFile(deps, p);
  const filename = cleanFilename(req.query.filename);
  const key = await deps.storage.save("products", req, { allowed: "any", maxBytes: deps.config.productFileMaxBytes });
  const [file] = await deps.db
    .insert(productFiles)
    .values({ productId: p.id, kind: "file", storageKey: key, filename, sizeBytes: await deps.storage.size(key), contentType: req.headers["content-type"] ?? "application/octet-stream", createdAt: deps.now() })
    .returning();
  await audit(deps, actorId, "product.file_added", p.id);
  return fileView(file);
}

export async function addLink(deps: Deps, actorId: string, id: string, input: unknown) {
  const p = await load(deps, id);
  await assertCanAddFile(deps, p);
  const body = linkSchema.parse(input);
  const [file] = await deps.db.insert(productFiles).values({ productId: p.id, kind: "link", url: body.url, filename: body.label, createdAt: deps.now() }).returning();
  await audit(deps, actorId, "product.link_added", p.id);
  return fileView(file);
}

export async function removeFile(deps: Deps, actorId: string, id: string, fileId: string) {
  const p = await load(deps, id);
  const [file] = UUID.test(fileId) ? await deps.db.select().from(productFiles).where(and(eq(productFiles.id, fileId), eq(productFiles.productId, p.id))) : [];
  if (!file) throw new HttpError(404, "File tidak ditemukan.", "FILE_NOT_FOUND");
  if (p.active) {
    const [{ n }] = await deps.db.select({ n: count() }).from(productFiles).where(eq(productFiles.productId, p.id));
    if (n <= 1) throw new HttpError(422, "Produk yang sedang dijual harus punya minimal satu file atau tautan. Nonaktifkan dulu.", "LAST_FILE");
  }
  await deps.db.delete(productFiles).where(eq(productFiles.id, file.id));
  if (file.storageKey) await deps.storage.remove(file.storageKey);
  await audit(deps, actorId, "product.file_removed", p.id);
}

export async function setCover(deps: Deps, actorId: string, id: string, req: Request) {
  const p = await load(deps, id);
  const key = await deps.storage.save("covers", req, COVER);
  const now = deps.now();
  await deps.db.update(products).set({ coverKey: key, coverUpdatedAt: now, updatedAt: now }).where(eq(products.id, p.id));
  if (p.coverKey) await deps.storage.remove(p.coverKey);
  await audit(deps, actorId, "product.cover_changed", p.id);
  return { coverUrl: coverUrl({ ...p, coverKey: key, coverUpdatedAt: now }) };
}

export const coverFile = (key: string) => ({ filename: `sampul.${key.split(".").pop()}`, contentType: COVER_TYPES[key.split(".").pop() as keyof typeof COVER_TYPES] ?? "application/octet-stream", inline: true });

export async function getCover(deps: Deps, id: string) {
  const p = await load(deps, id);
  if (!p.coverKey) throw new HttpError(404, "Produk ini belum punya sampul.", "NO_COVER");
  return { key: p.coverKey, ...coverFile(p.coverKey) };
}
