import Link from "next/link";

export default function InvoiceTidakAda() {
  return (
    <>
      <h1>Invoice tidak ditemukan.</h1>
      <Link className="back" href="/">Lihat semua produk</Link>
    </>
  );
}
