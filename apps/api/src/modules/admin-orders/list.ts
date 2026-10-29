import { ORDER_STATUSES } from "@hayatun/shared";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import { orderItems, orders, users } from "../../db/schema.js";

type Deps = Pick<AppDeps, "db" | "crypto">;

const PAGE_SIZE = 25;
const SUMMARY_MONTHS = 24;
const WIB = "+07:00";

// "" dari formulir (Semua status, kolom kosong) berarti tanpa filter
const opt = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());
const day = (msg: string) => z.string({ error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg).refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v); }, msg);
const querySchema = z.object({
  status: opt(z.enum(ORDER_STATUSES, { error: "Status tidak dikenal." })),
  type: opt(z.enum(["digital", "fisik"], { error: "Jenis produk tidak dikenal." })),
  from: opt(day("Tanggal dari tidak valid.")),
  to: opt(day("Tanggal sampai tidak valid.")),
  q: opt(z.string().trim().max(40, "Pencarian maksimal 40 karakter.")),
  page: opt(z.string({ error: "Halaman tidak valid." }).regex(/^[1-9]\d{0,5}$/, "Halaman tidak valid.").transform(Number)),
});

// F13.1. Tanggal dibaca sebagai hari WIB, kedua ujung termasuk. Nomor invoice dicari sebagai teks biasa (tanpa pola LIKE).
export async function listOrders(deps: Deps, query: unknown) {
  const f = querySchema.parse(query);
  const where = and(
    f.status ? eq(orders.status, f.status) : undefined,
    f.from ? gte(orders.createdAt, new Date(`${f.from}T00:00:00${WIB}`)) : undefined,
    f.to ? lt(orders.createdAt, new Date(new Date(`${f.to}T00:00:00${WIB}`).getTime() + 24 * 3600_000)) : undefined,
    f.type ? sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.productType} = ${f.type === "fisik" ? "physical" : "digital"})` : undefined,
    f.q ? sql`position(lower(${f.q}) in lower(${orders.invoiceNumber})) > 0` : undefined,
  );
  const page = f.page ?? 1;
  const [{ total }] = await deps.db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
  const rows = await deps.db.select({ o: orders, nameEnc: users.nameEnc }).from(orders).innerJoin(users, eq(users.id, orders.userId))
    .where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  return {
    orders: rows.map(({ o, nameEnc }) => ({
      orderId: o.id, invoiceNumber: o.invoiceNumber, createdAt: o.createdAt, buyerName: nameEnc ? deps.crypto.decrypt(nameEnc) : null, total: o.total,
      status: o.status, digitalStatus: o.digitalStatus, physicalStatus: o.physicalStatus,
    })),
    total, page, pageSize: PAGE_SIZE,
  };
}

// F13.2. Hanya yang masih Lunas (yang dibatalkan bukan penjualan), per bulan WIB dari tanggal dibayar.
export async function monthlySummary(deps: Pick<AppDeps, "db">) {
  const { rows } = await deps.db.execute(sql`
    select to_char(paid_at at time zone 'Asia/Jakarta', 'YYYY-MM') as month, count(*)::int as orders, sum(subtotal)::int as products, sum(shipping_cost)::int as shipping, sum(total)::int as total
    from orders where status = 'LUNAS' and paid_at is not null group by 1 order by 1 desc limit ${SUMMARY_MONTHS}`);
  return { months: rows };
}
