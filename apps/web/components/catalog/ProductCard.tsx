import Image from "next/image";
import Link from "next/link";
import { formatRupiah, typeLabel } from "@/lib/products";
import type { CatalogCard } from "@/lib/catalog";

// Bingkai sampul: rasio 4:5 tetap dipesan sejak awal supaya halaman tidak melompat saat gambar tiba (N17).
// Produk tanpa sampul memakai gambar kosong di bingkai yang sama.
export function CoverFrame({ p, priority, sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" }: { p: CatalogCard; priority?: boolean; sizes?: string }) {
  // next/image mengecilkan sampul mentah dari admin (bisa beberapa MB) ke ukuran tampil, dalam WebP, supaya LCP tetap ≤ 2,5 detik (N17)
  return (
    <div className="sampul" data-testid="sampul">
      <Image src={p.coverUrl ?? "/sampul-kosong.svg"} alt={p.coverUrl ? p.name : ""} fill sizes={sizes} priority={priority} unoptimized={!p.coverUrl} />
    </div>
  );
}

// Seluruh kartu adalah satu tautan ke halaman detail (DESIGN §5)
export function ProductCard({ p, priority }: { p: CatalogCard; priority?: boolean }) {
  return (
    <li className="product-card">
      <Link href={`/produk/${p.slug}`}>
        <CoverFrame p={p} priority={priority} />
        <div className="badges">
          <span className="badge" data-tone="neutral">{typeLabel(p.type)}</span>
          {!p.available && <span className="badge" data-tone="wait">Habis</span>}
        </div>
        <p className="card-name" data-testid="nama">{p.name}</p>
        <p className="card-price">{formatRupiah(p.price)}</p>
      </Link>
    </li>
  );
}
