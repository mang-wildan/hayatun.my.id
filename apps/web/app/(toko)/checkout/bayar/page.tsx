import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { ConfirmOrder } from "@/components/checkout/ConfirmOrder";
import { FormMessage } from "@/components/FormMessage";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Cart } from "@/lib/cart";
import type { Address, Quote } from "@/lib/checkout";
import { formatRupiah } from "@/lib/products";

export const metadata: Metadata = { title: "Bayar" };

export default async function Bayar({ searchParams }: { searchParams: Promise<{ alamat?: string; kurir?: string; layanan?: string }> }) {
  const { alamat, kurir, layanan } = await searchParams;
  const cart = unwrap(await apiServer<Cart>("/api/cart"));
  if (!cart.items.length || !cart.canCheckout) redirect("/keranjang");
  if (cart.requiresAddress && (!alamat || !kurir || !layanan)) redirect("/checkout/pengiriman");

  const res = await apiServer<Quote>("/api/checkout/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cart.requiresAddress ? { addressId: alamat, courier: kurir, service: layanan } : {}),
  });
  if (!res.ok) {
    // pilihan pengiriman sudah tidak berlaku atau alamat hilang: ulang dari Pengiriman
    if (res.status === 404 || res.body.code === "SHIPPING_CHANGED") redirect("/checkout/pengiriman");
    return (
      <>
        <CheckoutSteps current="bayar" physical={cart.requiresAddress} />
        <h1>Bayar</h1>
        <FormMessage tone="error">{res.body.message}</FormMessage>
        {cart.requiresAddress && <Link className="back" href="/checkout/pengiriman">Kembali ke pengiriman</Link>}
      </>
    );
  }

  const q = res.data;
  let address: Address | undefined;
  if (q.requiresAddress) address = unwrap(await apiServer<{ addresses: Address[] }>("/api/addresses")).addresses.find((a) => a.id === alamat);

  return (
    <>
      <CheckoutSteps current="bayar" physical={q.requiresAddress} />
      <h1>Bayar</h1>
      <div className="checkout-layout">
        <div className="stack">
          {address && (
            <section>
              <h2>Pengiriman</h2>
              <p>Dikirim ke {address.recipient}</p>
              <p className="meta">{address.address}, {address.areaId} {address.postalCode}</p>
              <p className="meta">{kurir} {layanan}</p>
            </section>
          )}
          <section>
            <h2>Pesananmu</h2>
            <ul className="summary-items">
              {q.items.map((i) => (
                <li key={i.productId}>
                  <span>{i.name}<span className="meta">{i.qty} × {formatRupiah(i.price)}</span></span>
                  <strong>{formatRupiah(i.lineTotal)}</strong>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="summary stack" aria-labelledby="ringkasan">
          <h2 id="ringkasan">Ringkasan pesanan</h2>
          <dl className="summary-rows">
            <div><dt>Subtotal</dt><dd>{formatRupiah(q.subtotal)}</dd></div>
            {q.requiresAddress && <div><dt>Ongkir</dt><dd data-testid="ongkir">{formatRupiah(q.shippingCost ?? 0)}</dd></div>}
            <div className="grand"><dt>Total</dt><dd data-testid="total">{formatRupiah(q.total ?? 0)}</dd></div>
          </dl>
          <ConfirmOrder expectedTotal={q.total ?? 0} addressId={alamat} courier={kurir} service={layanan} />
        </section>
      </div>
    </>
  );
}
