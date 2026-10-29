export interface Shipment {
  orderId: string; invoiceNumber: string; paidAt: string; physicalStatus: "DIPROSES" | "DIKIRIM";
  courier: string | null; service: string | null; recipient: string; phone: string; address: string; areaId: string; postalCode: string;
  trackingNumber: string | null; shippedAt: string | null; items: { name: string; qty: number }[];
}
