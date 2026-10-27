export interface CartItem {
  productId: string; slug: string; name: string; type: "digital" | "physical"; price: number; qty: number; maxQty: number; lineTotal: number; coverUrl: string | null;
  status: "ok" | "inactive" | "out_of_stock" | "exceeds_stock";
}
export interface Cart { items: CartItem[]; subtotal: number; canCheckout: boolean }
