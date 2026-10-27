import Link from "next/link";
import { StatusBadge } from "@/components/products/ProductList";
import { ProductForm } from "@/components/products/ProductForm";
import { CoverPanel, FilesPanel, LicensesPanel, StatusControls } from "@/components/products/ProductPanels";
import { apiServer, unwrap } from "@/lib/api-server";
import { stockLabel, type ProductDetail } from "@/lib/products";

export default async function ProdukDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = unwrap(await apiServer<ProductDetail>(`/api/admin/products/${encodeURIComponent(id)}`));
  return (
    <>
      <Link className="back" href="/admin/produk">Semua produk</Link>
      <div className="page-head">
        <h1>{p.name}</h1>
        <StatusBadge active={p.active} />
      </div>
      <p data-testid="stock-summary">{stockLabel(p.stock)}</p>
      <StatusControls product={p} />
      <section className="panel"><h2>Data produk</h2><ProductForm product={p} /></section>
      <section className="panel"><h2>Sampul</h2><CoverPanel product={p} /></section>
      {p.type === "digital" && <section className="panel"><h2>File dan tautan</h2><FilesPanel product={p} /></section>}
      {p.type === "digital" && p.isLicensed && <section className="panel"><h2>Kode lisensi</h2><LicensesPanel product={p} /></section>}
    </>
  );
}
