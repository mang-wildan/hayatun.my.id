import Link from "next/link";
import { ProductForm } from "@/components/products/ProductForm";

export default function ProdukBaru() {
  return (
    <>
      <Link className="back" href="/admin/produk">Semua produk</Link>
      <h1>Produk baru</h1>
      <ProductForm />
    </>
  );
}
