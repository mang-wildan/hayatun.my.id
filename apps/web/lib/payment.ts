import type { OrderStatus } from "@hayatun/shared";

export interface PaymentInfo {
  orderId: string; invoiceNumber: string; status: OrderStatus; total: number; expiresAt: string; expired: boolean; canUploadProof: boolean;
  lastRejection: { reason: string; at: string } | null;
  bankAccount: { bank: string; number: string; holder: string } | null;
  store: { name: string; email?: string; phone?: string };
}

export const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
// pesan yang sama dengan server (modul storage), supaya pembeli melihat kalimat yang sama di mana pun ditolaknya
export const PROOF_TYPE_ERROR = "Jenis file tidak didukung. Pakai JPG, PNG, atau PDF ya.";
export const PROOF_SIZE_ERROR = "Filenya kebesaran nih, maksimal 5 MB ya. Coba kecilkan dulu.";
