export interface AuditLogEntry {
  id: number; action: string; actorName: string | null; entityType: string; entityId: string; entityLabel: string | null;
  details: Record<string, string | number | boolean>; createdAt: string;
}
export interface AuditLogPage { logs: AuditLogEntry[]; actions: string[]; total: number; page: number; pageSize: number }

// Aksi yang belum ada di daftar tampil apa adanya, jadi aksi baru tetap terbaca
const LABELS: Record<string, string> = {
  "account.deleted": "Akun pembeli dihapus",
  "account.deletion_requested": "Pembeli meminta hapus akun",
  "admin.bootstrap": "Admin pertama dibuat",
  "admin.disabled": "Admin dinonaktifkan",
  "admin.invite_accepted": "Undangan admin diterima",
  "admin.invite_resent": "Undangan admin dikirim ulang",
  "admin.invited": "Admin diundang",
  "invoice.viewed": "Membuka invoice pembeli",
  "order.address_viewed": "Membuka alamat pengiriman",
  "order.auto_received": "Pesanan diterima otomatis",
  "order.buyer_viewed": "Membuka nama pembeli",
  "order.cancelled": "Pesanan dibatalkan",
  "order.expired": "Pesanan kedaluwarsa",
  "order.refunded": "Pesanan dibatalkan dan dikembalikan",
  "order.shipped": "Resi diisi, pesanan dikirim",
  "order.tracking_changed": "Resi diubah",
  "payment.accepted": "Pembayaran diterima",
  "payment.rejected": "Pembayaran ditolak",
  "payment_proof.deleted": "Bukti bayar dihapus (1 tahun)",
  "payment_proof.viewed": "Membuka bukti bayar",
  "product.activated": "Produk diaktifkan",
  "product.cover_changed": "Sampul produk diganti",
  "product.created": "Produk dibuat",
  "product.deactivated": "Produk dinonaktifkan",
  "product.file_added": "File produk ditambah",
  "product.file_removed": "File produk dihapus",
  "product.licenses_added": "Kode lisensi ditambah",
  "product.link_added": "Tautan produk ditambah",
  "product.stock_changed": "Stok diubah",
  "product.updated": "Produk diubah",
  "settings.bank_account_changed": "Rekening tujuan diubah",
  "settings.store_changed": "Informasi toko diubah",
  "user.totp_disabled": "Verifikasi dua langkah pembeli dimatikan",
  "user.viewed": "Membuka data pembeli",
};
export const actionLabel = (a: string) => LABELS[a] ?? a;
