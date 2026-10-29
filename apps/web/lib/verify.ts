export interface QueueItem {
  orderId: string; invoiceNumber: string; buyerName: string | null; total: number; uploadedAt: string; mime: string;
  items: { name: string; qty: number }[];
}
export interface Queue { items: QueueItem[]; bankAccount: { bank: string; number: string; holder: string } | null }

export const REJECT_PRESETS = ["Nominal kurang", "Foto tidak terbaca", "Transfer tidak ditemukan"];
export const REASON_REQUIRED = "Alasan penolakan wajib diisi.";
