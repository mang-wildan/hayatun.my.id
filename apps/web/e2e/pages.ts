import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// N6: setiap halaman web dibuka sebagai tamu, pembeli, dan admin. Tabel ini harus memuat semua halaman di app/.
//  public = siapa saja; user = harus masuk (pembeli atau admin); buyer = pembeli saja; admin = admin saja
//  owner  = halaman satu pesanan: pembeli lain mendapat 404, admin hanya lewat invoice
export type Who = "public" | "user" | "buyer" | "admin" | "order-buyer" | "order-invoice";
export const PAGES: Record<string, Who> = {
  "/": "public",
  "/produk/[slug]": "public",
  "/daftar": "public",
  "/masuk": "public",
  "/masuk/atur-kode": "public",
  "/masuk/kode": "public",
  "/lupa-password": "public",
  "/reset-password": "public",
  "/verifikasi-email": "public",
  "/kebijakan-privasi": "public",
  "/syarat-dan-ketentuan": "public",
  "/admin/undangan": "public",
  "/keranjang": "user",
  "/checkout/pengiriman": "user",
  "/checkout/bayar": "user",
  "/pesanan": "user",
  "/akun/keamanan": "user",
  "/akun/hapus": "buyer",
  "/pesanan/[id]": "order-buyer",
  "/invoice/[orderId]": "order-invoice",
  "/admin": "admin",
  "/admin/admin": "admin",
  "/admin/lainnya": "admin",
  "/admin/log": "admin",
  "/admin/pengaturan": "admin",
  "/admin/pengiriman": "admin",
  "/admin/pesanan": "admin",
  "/admin/produk": "admin",
  "/admin/produk/[id]": "admin",
  "/admin/produk/baru": "admin",
};

// semua page.tsx di app/, tanpa grup rute seperti (toko) dan (panel)
export function discover(dir = join(process.cwd(), "app"), rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return discover(full, name.startsWith("(") ? rel : `${rel}/${name}`);
    return name === "page.tsx" ? [rel || "/"] : [];
  });
}

