import type { Metadata } from "next";
import Link from "next/link";
import { CoverFrame } from "@/components/catalog/ProductCard";
import { getCatalogProduct } from "@/lib/catalog";
import { formatRupiah, typeLabel } from "@/lib/products";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getCatalogProduct((await params).slug);
  return { title: p.name, description: p.description.slice(0, 160) || undefined };
}

export default async function ProdukDetail({ params }: Props) {
  const p = await getCatalogProduct((await params).slug);
  return (
    <>
      <Link className="back" href="/">Semua produk</Link>
      <article className="product-detail">
        <CoverFrame p={p} priority />
        <div className="stack">
          <div className="badges">
            <span className="badge" data-tone="neutral">{typeLabel(p.type)}</span>
            {!p.available && <span className="badge" data-tone="wait">Habis</span>}
          </div>
          <h1>{p.name}</h1>
          <p className="card-price">{formatRupiah(p.price)}</p>
          {p.weightG !== null && <p className="meta">Berat: {p.weightG.toLocaleString("id-ID")} g</p>}
          {p.description && <p className="description">{p.description}</p>}
        </div>
      </article>
    </>
  );
}
