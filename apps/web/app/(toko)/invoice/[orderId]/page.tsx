import { formatWIB } from "@hayatun/shared";
import type { Metadata } from "next";
import { PrintButton } from "@/components/invoice/PrintButton";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Invoice } from "@/lib/invoice";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Invoice" };

const ICON = { "Lunas": "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z", "Belum Lunas": "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z", "Dibatalkan": "M6 6l12 12M6 18L18 6" } as const;
const TONE = { "Lunas": "ok", "Belum Lunas": "wait", "Dibatalkan": "neutral" } as const;

// Dokumen netral untuk pembukuan (DESIGN: tanpa sapaan, tanpa bahasa santai). Tidak ada PPN (F6.3).
export default async function InvoicePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const inv = unwrap(await apiServer<Invoice>(`/api/invoices/${encodeURIComponent(orderId)}`));
  const a = inv.shippingAddress;

  return (
    <>
      <div className="invoice-actions">
        <PrintButton />
      </div>
      <article className="invoice" data-testid="dokumen">
        <div className="invoice-head">
          <div>
            <p className="shop" data-testid="nama-toko">{inv.store.name}</p>
            {inv.store.email && <p>{inv.store.email}</p>}
            {inv.store.phone && <p>{inv.store.phone}</p>}
          </div>
          <div className="invoice-meta">
            <h1>Invoice</h1>
            <p className="mono" data-testid="nomor-invoice">{inv.number}</p>
            <p>Tanggal terbit: <span data-testid="tanggal-terbit">{formatWIB(new Date(inv.issuedAt))}</span></p>
            <span className="badge" data-tone={TONE[inv.status]} data-testid="status-invoice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16"><path d={ICON[inv.status]} /></svg>
              {inv.status}
            </span>
          </div>
        </div>

        <div className="invoice-parties">
          <section>
            <h2>Pembeli</h2>
            <p>{inv.buyer.name}</p>
            <p>{inv.buyer.email}</p>
          </section>
          {a && (
            <section>
              <h2>Alamat pengiriman</h2>
              <p>{a.recipient}, {a.phone}</p>
              <p>{a.address}, {a.postalCode}</p>
              <p>{a.courier} {a.service}</p>
            </section>
          )}
        </div>

        <table className="invoice-table">
          <thead>
            <tr><th scope="col">Produk</th><th scope="col" className="num">Jumlah</th><th scope="col" className="num">Harga satuan</th><th scope="col" className="num">Subtotal</th></tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td className="num">{i.qty}</td>
                <td className="num">{formatRupiah(i.unitPrice)}</td>
                <td className="num">{formatRupiah(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="summary-rows invoice-totals">
          <div><dt>Subtotal</dt><dd data-testid="subtotal">{formatRupiah(inv.subtotal)}</dd></div>
          {a && <div><dt>Ongkir</dt><dd data-testid="ongkir">{formatRupiah(inv.shippingCost)}</dd></div>}
          <div className="grand"><dt>Total</dt><dd data-testid="total">{formatRupiah(inv.total)}</dd></div>
        </dl>
        <p>Cara bayar: {inv.paymentMethod}</p>
        {inv.paidAt && <p>Tanggal lunas: {formatWIB(new Date(inv.paidAt))}</p>}
      </article>
    </>
  );
}
