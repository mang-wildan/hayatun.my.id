import { formatWIB } from "@hayatun/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { DigitalSection } from "@/components/orders/DigitalSection";
import { PhysicalSection } from "@/components/orders/PhysicalSection";
import { Steps } from "@/components/orders/Steps";
import { CopyButton } from "@/components/CopyButton";
import { CancelOrder } from "@/components/payment/CancelOrder";
import { OrderStatusBadge } from "@/components/payment/OrderStatusBadge";
import { ProofUpload } from "@/components/payment/ProofUpload";
import { apiServer, unwrap } from "@/lib/api-server";
import { paymentSteps, type OrderDetail, type OrderFiles, type OrderLicenses } from "@/lib/orders";
import type { PaymentInfo } from "@/lib/payment";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Pesanan" };

// Instruksi bayar (F4.1): batas waktu, total, rekening, lalu area unggah. Batas ditulis sebagai tanggal dan jam, bukan hitung mundur (DESIGN).
export default async function Pesanan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = unwrap(await apiServer<PaymentInfo>(`/api/orders/${encodeURIComponent(id)}/payment`));
  const d = unwrap(await apiServer<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`));
  const delivered = d.status === "LUNAS" && (d.digitalStatus === "TERKIRIM" || d.digitalStatus === "LISENSI_TERTUNDA");
  const files = delivered ? unwrap(await apiServer<OrderFiles>(`/api/orders/${encodeURIComponent(id)}/files`)).items : [];
  const licenses = delivered ? unwrap(await apiServer<OrderLicenses>(`/api/orders/${encodeURIComponent(id)}/licenses`)).items : [];
  // alamat tautan eksternal tidak ada di daftar file; diminta per tautan (hanya pemilik pesanan yang bisa)
  const links: Record<string, string> = {};
  for (const f of files.flatMap((i) => i.files).filter((x) => x.kind === "link")) {
    const r = await apiServer<{ url: string }>(`/api/orders/${encodeURIComponent(id)}/files/${f.id}/download`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (r.ok) links[f.id] = r.data.url;
  }
  // batas sudah lewat tapi tugas kedaluwarsa belum jalan: tampil sebagai kedaluwarsa (F4.8)
  const status = p.status === "MENUNGGU_PEMBAYARAN" && p.expired ? "KEDALUWARSA" : p.status;
  const waiting = status === "MENUNGGU_PEMBAYARAN";
  const timeline = paymentSteps(status, Boolean(d.paidAt));

  return (
    <>
      <h1>{waiting ? "Pesanan dibuat" : "Status pesanan"}</h1>
      <dl className="summary-rows">
        <div><dt>Nomor invoice</dt><dd><span className="mono" data-testid="nomor-invoice">{p.invoiceNumber}</span> <CopyButton text={p.invoiceNumber} label="Salin nomor invoice" /></dd></div>
        <div><dt>Status</dt><dd><OrderStatusBadge status={status} /></dd></div>
        <div className="grand"><dt>Total</dt><dd><span data-testid="total">{formatRupiah(p.total)}</span> <CopyButton text={String(p.total)} label="Salin total transfer" /></dd></div>
      </dl>

      <section aria-labelledby="waktu-h" className="stack">
        <h2 id="waktu-h">Perkembangan</h2>
        <Steps label="Garis waktu pesanan" labels={timeline.labels} current={timeline.current} />
      </section>

      {waiting && (
        <>
          <p data-testid="batas-waktu">Upload sebelum {formatWIB(new Date(p.expiresAt))}</p>

          <section className="stack" aria-labelledby="rekening">
            <h2 id="rekening">Rekening tujuan</h2>
            {p.bankAccount ? (
              <dl className="summary-rows">
                <div><dt>Bank</dt><dd>{p.bankAccount.bank}</dd></div>
                <div><dt>Nomor rekening</dt><dd><span className="mono" data-testid="nomor-rekening">{p.bankAccount.number}</span> <CopyButton text={p.bankAccount.number} label="Salin nomor rekening" /></dd></div>
                <div><dt>Atas nama</dt><dd>{p.bankAccount.holder}</dd></div>
              </dl>
            ) : (
              <p className="notice">Rekening tujuan belum diatur. Hubungi toko{p.store.email ? ` di ${p.store.email}` : ""}{p.store.phone ? ` atau ${p.store.phone}` : ""} untuk menanyakan rekening transfer.</p>
            )}
          </section>

          {p.lastRejection && (
            <div className="notice" role="status" data-testid="alasan-penolakan">
              <strong>Bukti bayarmu belum bisa diterima.</strong> {p.lastRejection.reason}
            </div>
          )}

          <section className="stack">
            <h2>Unggah bukti bayar</h2>
            <ProofUpload orderId={id} />
          </section>
          <CancelOrder orderId={id} />
        </>
      )}

      <section aria-labelledby="barang-h" className="stack" data-testid="barang">
        <h2 id="barang-h">Isi pesanan</h2>
        <ul className="plain-list">{d.items.map((i, n) => <li key={n}>{i.name} × {i.qty} <span className="meta">{formatRupiah(i.unitPrice)}</span></li>)}</ul>
        <dl className="summary-rows">
          <div><dt>Subtotal</dt><dd>{formatRupiah(d.subtotal)}</dd></div>
          {d.shipping && <div><dt>Ongkir</dt><dd>{formatRupiah(d.shippingCost)}</dd></div>}
          <div className="grand"><dt>Total</dt><dd>{formatRupiah(d.total)}</dd></div>
        </dl>
      </section>

      {["TERKIRIM", "LISENSI_TERTUNDA", "DICABUT"].includes(d.digitalStatus) && d.paidAt && <DigitalSection orderId={id} status={d.digitalStatus} files={files} licenses={licenses} links={links} />}
      {["DIPROSES", "DIKIRIM", "DITERIMA"].includes(d.physicalStatus) && <PhysicalSection status={d.physicalStatus} shipping={d.shipping} />}

      {status === "MENUNGGU_VERIFIKASI" && <p role="status">Bukti bayar terkirim. Kami akan segera mengeceknya.</p>}
      {status === "KEDALUWARSA" && (
        <>
          <p>Pesanan ini kedaluwarsa. Silakan checkout ulang ya.</p>
          <Link className="btn" data-variant="primary" href="/">Kembali belanja</Link>
        </>
      )}
      <Link className="btn" data-variant="secondary" href={`/invoice/${id}`}>Lihat invoice</Link>
    </>
  );
}
