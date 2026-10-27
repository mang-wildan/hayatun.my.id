// Nilai status pesanan (ARCHITECTURE §4), label Bahasa Indonesia, dan warna status (DESIGN §2)
export const ORDER_STATUSES = ["MENUNGGU_PEMBAYARAN", "MENUNGGU_VERIFIKASI", "LUNAS", "KEDALUWARSA", "DIBATALKAN", "DIKEMBALIKAN"] as const;
export const DIGITAL_STATUSES = ["TIDAK_ADA", "MENUNGGU", "TERKIRIM", "LISENSI_TERTUNDA", "DICABUT"] as const;
export const PHYSICAL_STATUSES = ["TIDAK_ADA", "MENUNGGU", "DIPROSES", "DIKIRIM", "DITERIMA"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type DigitalStatus = (typeof DIGITAL_STATUSES)[number];
export type PhysicalStatus = (typeof PHYSICAL_STATUSES)[number];
export type StatusTone = "ok" | "wait" | "danger" | "neutral";

export const STATUS_LABELS = {
  order: {
    MENUNGGU_PEMBAYARAN: "Menunggu pembayaran", MENUNGGU_VERIFIKASI: "Menunggu verifikasi", LUNAS: "Lunas",
    KEDALUWARSA: "Kedaluwarsa", DIBATALKAN: "Dibatalkan", DIKEMBALIKAN: "Dikembalikan",
  } satisfies Record<OrderStatus, string>,
  digital: {
    TIDAK_ADA: "Tidak ada", MENUNGGU: "Menunggu pembayaran", TERKIRIM: "Terkirim", LISENSI_TERTUNDA: "Lisensi tertunda", DICABUT: "Akses dicabut",
  } satisfies Record<DigitalStatus, string>,
  physical: {
    TIDAK_ADA: "Tidak ada", MENUNGGU: "Menunggu pembayaran", DIPROSES: "Diproses", DIKIRIM: "Dikirim", DITERIMA: "Diterima",
  } satisfies Record<PhysicalStatus, string>,
};

export const STATUS_TONES = {
  order: {
    MENUNGGU_PEMBAYARAN: "neutral", MENUNGGU_VERIFIKASI: "wait", LUNAS: "ok", KEDALUWARSA: "neutral", DIBATALKAN: "neutral", DIKEMBALIKAN: "neutral",
  } satisfies Record<OrderStatus, StatusTone>,
  digital: { TIDAK_ADA: "neutral", MENUNGGU: "neutral", TERKIRIM: "ok", LISENSI_TERTUNDA: "wait", DICABUT: "neutral" } satisfies Record<DigitalStatus, StatusTone>,
  physical: { TIDAK_ADA: "neutral", MENUNGGU: "neutral", DIPROSES: "neutral", DIKIRIM: "neutral", DITERIMA: "ok" } satisfies Record<PhysicalStatus, StatusTone>,
};
