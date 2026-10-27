import Link from "next/link";

export default function ProdukTidakAda() {
  return (
    <>
      <h1>Produk tidak ditemukan.</h1>
      <p className="empty">Mungkin produknya sudah tidak dijual, atau alamatnya salah ketik.</p>
      <Link className="back" href="/">Lihat semua produk</Link>
    </>
  );
}
