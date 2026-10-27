import { LOW_STOCK_THRESHOLD } from "@hayatun/shared";

export interface Stock { available: number | null; reserved: number; sold: number }
export interface ProductSummary {
  id: string; slug: string; name: string; type: "digital" | "physical"; price: number; active: boolean;
  isLicensed: boolean; coverUrl: string | null; stock: Stock; fileCount: number;
}
export interface ProductFile { id: string; kind: "file" | "link"; filename: string; sizeBytes: number | null; url: string | null }
export interface ProductDetail extends ProductSummary { description: string; weightG: number | null; files: ProductFile[] }

export const formatRupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
export const typeLabel = (t: ProductSummary["type"]) => (t === "digital" ? "Digital" : "Fisik");

export const stockLabel = (s: Stock) =>
  s.available === null ? `Tanpa batas · Terjual ${s.sold}` : `Tersedia ${s.available} · Ditahan ${s.reserved} · Terjual ${s.sold}`;
export const isLowStock = (s: Stock) => s.available !== null && s.available <= LOW_STOCK_THRESHOLD;

export function formatSize(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
