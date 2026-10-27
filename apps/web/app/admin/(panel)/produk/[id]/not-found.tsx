import Link from "next/link";

export default function ProdukTidakAda() {
  return (
    <>
      <h1>Produk tidak ditemukan.</h1>
      <Link className="back" href="/admin/produk">Kembali ke daftar produk</Link>
    </>
  );
}
