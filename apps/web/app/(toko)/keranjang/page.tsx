import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Cart } from "@/lib/cart";

export const metadata: Metadata = { title: "Keranjang" };

export default async function Keranjang() {
  const cart = unwrap(await apiServer<Cart>("/api/cart"));
  return (
    <>
      <h1>Keranjang</h1>
      <CartView cart={cart} />
    </>
  );
}
