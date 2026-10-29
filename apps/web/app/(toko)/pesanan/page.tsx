import { formatWIB } from "@hayatun/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/payment/OrderStatusBadge";
import { apiServer, unwrap } from "@/lib/api-server";
import type { OrderSummary } from "@/lib/orders";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Pesanan saya" };

export default async function PesananSaya() {
  const { orders } = unwrap(await apiServer<{ orders: OrderSummary[] }>("/api/orders"));
  return (
    <>
      <h1>Pesanan saya</h1>
      {orders.length === 0 ? (
        <>
          <p className="empty">Belum ada pesanan. Yuk, lihat produknya.</p>
          <Link className="btn" data-variant="primary" href="/">Lihat produk</Link>
        </>
      ) : (
        <ul className="order-cards">
          {orders.map((o) => (
            <li key={o.orderId} data-testid="pesanan-item">
              <Link className="mono" href={`/pesanan/${o.orderId}`}>{o.invoiceNumber}</Link>
              <span className="meta">{formatWIB(new Date(o.createdAt))}</span>
              <strong>{formatRupiah(o.total)}</strong>
              <OrderStatusBadge status={o.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
