import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Lainnya" };

// DESIGN §6: Pengiriman, Admin, Log aktivitas, dan Pengaturan toko; yang lain menyusul di tugasnya masing-masing
export default function Lainnya() {
  return (
    <>
      <h1>Lainnya</h1>
      <ul className="plain-list">
        <li><Link className="nav-link" href="/admin/pengiriman">Pengiriman</Link></li>
        <li><Link className="nav-link" href="/admin/pengaturan">Pengaturan toko</Link></li>
      </ul>
    </>
  );
}
