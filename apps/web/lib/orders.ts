import type { DigitalStatus, OrderStatus, PhysicalStatus } from "@hayatun/shared";

export interface OrderSummary { orderId: string; invoiceNumber: string; createdAt: string; total: number; status: OrderStatus; digitalStatus: DigitalStatus; physicalStatus: PhysicalStatus }
export interface OrderDetail extends OrderSummary {
  subtotal: number; shippingCost: number; paidAt: string | null;
  items: { name: string; type: "digital" | "physical"; qty: number; unitPrice: number }[];
  shipping: { courier: string; service: string | null; trackingNumber: string | null } | null;
}
export interface OrderFiles { items: { name: string; files: { id: string; kind: "file" | "link"; filename: string; sizeBytes: number | null }[] }[] }
export interface OrderLicenses { items: { name: string; codes: string[]; missing: number }[] }

// Garis waktu pembayaran (DESIGN §6): langkah yang dilalui, dan yang sedang berjalan
export function paymentSteps(status: OrderStatus, paid: boolean): { labels: string[]; current: number } {
  const wait = ["Menunggu pembayaran", "Menunggu verifikasi", "Lunas"];
  if (status === "MENUNGGU_PEMBAYARAN") return { labels: wait, current: 0 };
  if (status === "MENUNGGU_VERIFIKASI") return { labels: wait, current: 1 };
  if (status === "LUNAS") return { labels: wait, current: 2 };
  const end = { KEDALUWARSA: "Kedaluwarsa", DIBATALKAN: "Dibatalkan", DIKEMBALIKAN: "Dikembalikan" }[status];
  const labels = [...(paid ? wait : wait.slice(0, 1)), end];
  return { labels, current: labels.length - 1 };
}
