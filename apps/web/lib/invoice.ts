export interface Invoice {
  number: string;
  issuedAt: string;
  store: { name: string; email?: string; phone?: string };
  buyer: { name: string | null; email: string };
  shippingAddress: { recipient: string | null; phone: string | null; address: string | null; postalCode: string | null; courier: string | null; service: string | null } | null;
  items: { name: string; qty: number; unitPrice: number; subtotal: number }[];
  subtotal: number; shippingCost: number; total: number;
  paymentMethod: string;
  status: "Belum Lunas" | "Lunas" | "Dibatalkan";
  paidAt: string | null;
}
