import { STATUS_LABELS, ORDER_STATUSES } from "@hayatun/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminOrderList } from "@/components/admin-orders/AdminOrderList";
import { FormMessage } from "@/components/FormMessage";
import { apiServer, unwrap } from "@/lib/api-server";
import { FILTER_KEYS, type AdminOrderList as Page, type MonthSummary } from "@/lib/admin-orders";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Pesanan" };

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function Pesanan({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const k of [...FILTER_KEYS, "page"] as const) if (sp[k]) params.set(k, sp[k]!);
  const res = await apiServer<Page>(`/api/admin/orders?${params}`);
  const invalid = !res.ok && res.status === 422 ? res.body.message : undefined;
  const list: Page = invalid ? { orders: [], total: 0, page: 1, pageSize: 25 } : unwrap(res);
  const { months } = unwrap(await apiServer<{ months: MonthSummary[] }>("/api/admin/orders/summary"));
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (page: number) => { const p = new URLSearchParams(params); p.set("page", String(page)); return `/admin/pesanan?${p}`; };

  return (
    <>
      <h1>Pesanan</h1>

      <section className="stack" aria-labelledby="ringkasan-h">
        <h2 id="ringkasan-h">Penjualan per bulan</h2>
        {months.length === 0 ? <p className="empty">Belum ada penjualan.</p> : (
          <div className="table-scroll" tabIndex={0} role="group" aria-label="Tabel penjualan, bisa digeser">
          <table className="product-table summary-table" aria-label="Penjualan per bulan">
            <thead><tr><th scope="col">Bulan</th><th scope="col">Pesanan</th><th scope="col">Produk</th><th scope="col">Ongkir</th><th scope="col">Total</th></tr></thead>
            <tbody>{months.map((m) => (
              <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{m.orders}</td><td>{formatRupiah(m.products)}</td><td>{formatRupiah(m.shipping)}</td><td>{formatRupiah(m.total)}</td></tr>
            ))}</tbody>
          </table>
          </div>
        )}
      </section>

      <form role="search" aria-label="Filter pesanan" method="get" action="/admin/pesanan" className="filters">
        <div className="field"><label htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Semua status</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS.order[s]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-type">Jenis produk</label>
          <select id="f-type" name="type" defaultValue={sp.type ?? ""}>
            <option value="">Semua jenis</option><option value="digital">Digital</option><option value="fisik">Fisik</option>
          </select></div>
        <div className="field"><label htmlFor="f-from">Dari tanggal</label><input id="f-from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="f-to">Sampai tanggal</label><input id="f-to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="field"><label htmlFor="f-q">Cari nomor invoice</label><input id="f-q" name="q" type="search" defaultValue={sp.q ?? ""} autoComplete="off" /></div>
        <div className="filter-actions">
          <button type="submit" className="btn" data-variant="primary">Terapkan</button>
          <Link href="/admin/pesanan" className="btn" data-variant="secondary">Atur ulang</Link>
        </div>
      </form>

      {invalid && <FormMessage tone="error">{invalid}</FormMessage>}
      <p data-testid="jumlah">{list.total} pesanan</p>
      <AdminOrderList orders={list.orders} />
      {pages > 1 && (
        <nav className="pager" aria-label="Halaman">
          {list.page > 1 && <Link className="btn" data-variant="secondary" href={link(list.page - 1)}>Sebelumnya</Link>}
          <span>Halaman {list.page} dari {pages}</span>
          {list.page < pages && <Link className="btn" data-variant="secondary" href={link(list.page + 1)}>Berikutnya</Link>}
        </nav>
      )}
    </>
  );
}
