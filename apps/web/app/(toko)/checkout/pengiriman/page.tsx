import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { ShippingForm } from "@/components/checkout/ShippingForm";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Cart } from "@/lib/cart";
import type { Address } from "@/lib/checkout";

export const metadata: Metadata = { title: "Pengiriman" };

export default async function Pengiriman() {
  const cart = unwrap(await apiServer<Cart>("/api/cart"));
  if (!cart.items.length) redirect("/keranjang");
  if (!cart.requiresAddress) redirect("/checkout/bayar"); // F3.3: keranjang digital tidak diminta alamat
  const { addresses } = unwrap(await apiServer<{ addresses: Address[] }>("/api/addresses"));
  return (
    <>
      <CheckoutSteps current="pengiriman" physical />
      <h1>Pengiriman</h1>
      <ShippingForm initial={addresses} />
    </>
  );
}
