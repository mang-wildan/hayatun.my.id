import Link from "next/link";
import { ProductList } from "@/components/products/ProductList";
import { apiServer, unwrap } from "@/lib/api-server";
import type { ProductSummary } from "@/lib/products";

export default async function Produk() {
  const { products } = unwrap(await apiServer<{ products: ProductSummary[] }>("/api/admin/products"));
  return (
    <>
      <div className="page-head">
        <h1>Produk</h1>
        <Link className="btn" data-variant="primary" href="/admin/produk/baru">Tambah produk</Link>
      </div>
      {products.length === 0 ? <p className="empty">Belum ada produk. Tambahkan produk pertamamu.</p> : <ProductList products={products} />}
    </>
  );
}
