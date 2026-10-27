import type { Cart } from "./cart";

export interface Address { id: string; recipient: string; phone: string; address: string; areaId: string; postalCode: string }
export interface ShippingOption { courier: string; service: string; price: number; etdDays: string | null }
export interface Quote {
  items: { productId: string; name: string; type: "digital" | "physical"; price: number; qty: number; lineTotal: number }[];
  subtotal: number; requiresAddress: boolean; shippingOptions: ShippingOption[]; shippingCost: number | null; total: number | null;
}

export const optionLabel = (o: ShippingOption) => `${o.courier} ${o.service}${o.etdDays ? ` · ${o.etdDays} hari` : ""} · Rp${o.price.toLocaleString("id-ID")}`;
export const checkoutHref = (cart: Pick<Cart, "requiresAddress">) => (cart.requiresAddress ? "/checkout/pengiriman" : "/checkout/bayar");
