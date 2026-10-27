import type { DigitalStatus, OrderStatus, PhysicalStatus } from "@hayatun/shared";
import { HttpError } from "../../errors.js";

// Satu-satunya tempat aturan perpindahan status pesanan (diagram SPEC bagian 3, ARCHITECTURE §2).
// Murni: pemanggil menyimpan hasilnya dengan `UPDATE … WHERE status = <status lama>` supaya aman dari tindakan bersamaan.

export interface OrderState { status: OrderStatus; digital: DigitalStatus; physical: PhysicalStatus }

export type OrderEvent =
  | { type: "PROOF_UPLOADED" }
  | { type: "PROOF_REJECTED" }
  | { type: "PAYMENT_ACCEPTED"; licensePending?: boolean } // licensePending: stok kode habis saat penetapan (F7.7)
  | { type: "GATEWAY_PAID"; licensePending?: boolean }
  | { type: "EXPIRED" }
  | { type: "CANCELLED_BY_BUYER" }
  | { type: "LICENSE_DELIVERED" }
  | { type: "SHIPPED" }
  | { type: "RECEIVED" }
  | { type: "CANCELLED_BY_ADMIN"; refunded: boolean };

export function initialState({ hasDigital, hasPhysical }: { hasDigital: boolean; hasPhysical: boolean }): OrderState {
  if (!hasDigital && !hasPhysical) throw new Error("Pesanan harus berisi minimal satu produk");
  return { status: "MENUNGGU_PEMBAYARAN", digital: hasDigital ? "MENUNGGU" : "TIDAK_ADA", physical: hasPhysical ? "MENUNGGU" : "TIDAK_ADA" };
}

const paid = (s: OrderState, licensePending?: boolean): OrderState => ({
  status: "LUNAS",
  digital: s.digital === "TIDAK_ADA" ? "TIDAK_ADA" : licensePending ? "LISENSI_TERTUNDA" : "TERKIRIM",
  physical: s.physical === "TIDAK_ADA" ? "TIDAK_ADA" : "DIPROSES",
});

export function transition(s: OrderState, e: OrderEvent): OrderState {
  const lunas = s.status === "LUNAS";
  const menungguBayar = s.status === "MENUNGGU_PEMBAYARAN";
  switch (e.type) {
    case "PROOF_UPLOADED": if (menungguBayar) return { ...s, status: "MENUNGGU_VERIFIKASI" }; break;
    case "PROOF_REJECTED": if (s.status === "MENUNGGU_VERIFIKASI") return { ...s, status: "MENUNGGU_PEMBAYARAN" }; break;
    case "PAYMENT_ACCEPTED": if (s.status === "MENUNGGU_VERIFIKASI") return paid(s, e.licensePending); break;
    // tahap 2 (N36): satu-satunya jalur tambahan, hasilnya sama dengan bukti diterima
    case "GATEWAY_PAID": if (menungguBayar) return paid(s, e.licensePending); break;
    case "EXPIRED": if (menungguBayar) return { ...s, status: "KEDALUWARSA" }; break;
    case "CANCELLED_BY_BUYER": if (menungguBayar) return { ...s, status: "DIBATALKAN" }; break;
    case "LICENSE_DELIVERED": if (lunas && s.digital === "LISENSI_TERTUNDA") return { ...s, digital: "TERKIRIM" }; break;
    case "SHIPPED": if (lunas && s.physical === "DIPROSES") return { ...s, physical: "DIKIRIM" }; break;
    case "RECEIVED": if (lunas && s.physical === "DIKIRIM") return { ...s, physical: "DITERIMA" }; break;
    // status fisik dibiarkan: F10.3 memakainya untuk memutuskan stok kembali atau tidak
    case "CANCELLED_BY_ADMIN":
      if (lunas) return { status: e.refunded ? "DIKEMBALIKAN" : "DIBATALKAN", digital: s.digital === "TIDAK_ADA" ? "TIDAK_ADA" : "DICABUT", physical: s.physical };
      break;
  }
  throw new HttpError(409, "Pesanan ini tidak bisa diubah ke status itu. Muat ulang halaman untuk melihat status terbarunya.", "INVALID_TRANSITION");
}

// Pesanan selesai ketika semua bagiannya selesai
export const isComplete = (s: OrderState) =>
  s.status === "LUNAS" && (s.digital === "TIDAK_ADA" || s.digital === "TERKIRIM") && (s.physical === "TIDAK_ADA" || s.physical === "DITERIMA");
