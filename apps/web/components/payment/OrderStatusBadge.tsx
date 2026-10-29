import { STATUS_LABELS, STATUS_TONES, type OrderStatus } from "@hayatun/shared";

const ICON: Record<OrderStatus, string> = {
  MENUNGGU_PEMBAYARAN: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  MENUNGGU_VERIFIKASI: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  LUNAS: "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  KEDALUWARSA: "M6 6l12 12M6 18L18 6",
  DIBATALKAN: "M6 6l12 12M6 18L18 6",
  DIKEMBALIKAN: "M6 6l12 12M6 18L18 6",
};

// Status tidak pernah disampaikan lewat warna saja: ikon dan teks (DESIGN §2)
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="badge" data-tone={STATUS_TONES.order[status]} data-testid="status-pesanan">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16"><path d={ICON[status]} /></svg>
      {STATUS_LABELS.order[status]}
    </span>
  );
}
