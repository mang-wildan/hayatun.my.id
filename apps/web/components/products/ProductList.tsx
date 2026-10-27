"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { formatRupiah, isLowStock, stockLabel, typeLabel, type ProductSummary } from "@/lib/products";

const WIDE = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
// Hanya satu tampilan yang ada di halaman: kartu di HP dan tablet, tabel dari 1024px (DESIGN §6)
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);

export function StatusBadge({ active }: { active: boolean }) {
  return <span className="badge" data-tone={active ? "ok" : "neutral"}>{active ? "Aktif" : "Nonaktif"}</span>;
}
const Low = ({ p }: { p: ProductSummary }) => (isLowStock(p.stock) ? <span className="badge" data-tone="wait">Stok rendah</span> : null);

export function ProductList({ products }: { products: ProductSummary[] }) {
  const wide = useWide();
  if (!wide) {
    return (
      <ul className="product-cards">
        {products.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/produk/${p.id}`}>{p.name}</Link>
            <div className="badges">
              <span className="badge" data-tone="neutral">{typeLabel(p.type)}</span>
              <StatusBadge active={p.active} />
              <Low p={p} />
            </div>
            <p>{formatRupiah(p.price)}</p>
            <p className="meta">{stockLabel(p.stock)}</p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="product-table">
      <thead>
        <tr><th scope="col">Produk</th><th scope="col">Jenis</th><th scope="col">Harga</th><th scope="col">Status</th><th scope="col">Stok</th></tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id}>
            <td><Link href={`/admin/produk/${p.id}`}>{p.name}</Link></td>
            <td>{typeLabel(p.type)}</td>
            <td>{formatRupiah(p.price)}</td>
            <td><StatusBadge active={p.active} /></td>
            <td>{stockLabel(p.stock)} <Low p={p} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
