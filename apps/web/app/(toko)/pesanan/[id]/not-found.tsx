import Link from "next/link";

export default function PesananTidakAda() {
  return (
    <>
      <h1>Pesanan tidak ditemukan.</h1>
      <Link className="back" href="/">Lihat semua produk</Link>
    </>
  );
}
