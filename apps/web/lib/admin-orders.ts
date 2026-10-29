import type { DigitalStatus, OrderStatus, PhysicalStatus } from "@hayatun/shared";

export interface AdminOrder { orderId: string; invoiceNumber: string; createdAt: string; buyerName: string | null; total: number; status: OrderStatus; digitalStatus: DigitalStatus; physicalStatus: PhysicalStatus }
export interface AdminOrderList { orders: AdminOrder[]; total: number; page: number; pageSize: number }
export interface MonthSummary { month: string; orders: number; products: number; shipping: number; total: number }

export const FILTER_KEYS = ["status", "type", "from", "to", "q"] as const;
