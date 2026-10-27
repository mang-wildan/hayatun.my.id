import type { Metadata } from "next";
import Link from "next/link";
import { apiServer, unwrap } from "@/lib/api-server";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Pesanan dibuat" };

interface InvoiceSummary { number: string; total: number }

// Instruksi bayar (rekening, batas waktu) dan unggah bukti ditambahkan di halaman ini oleh T32 dan T36
export default async function PesananDibuat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = unwrap(await apiServer<InvoiceSummary>(`/api/invoices/${encodeURIComponent(id)}`));
  return (
    <>
      <h1>Pesanan dibuat</h1>
      <dl className="summary-rows">
        <div><dt>Nomor invoice</dt><dd className="mono" data-testid="nomor-invoice">{inv.number}</dd></div>
        <div className="grand"><dt>Total</dt><dd data-testid="total">{formatRupiah(inv.total)}</dd></div>
      </dl>
      <Link className="btn" data-variant="secondary" href={`/invoice/${id}`}>Lihat invoice</Link>
    </>
  );
}
