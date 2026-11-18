import type { ReactNode } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

export default function TokoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#konten-utama">Lewati ke konten utama</a>
      <TopBar />
      <main id="konten-utama" className="page" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Link href="/" className="brand">Hayatun</Link>
            <p>Belanja produk, kelola keranjang, dan pantau pesanan dalam satu tempat.</p>
          </div>
          <div className="footer-bottom">
            <nav aria-label="Informasi hukum">
              <Link className="nav-link" href="/kebijakan-privasi">Kebijakan privasi</Link>
              <Link className="nav-link" href="/syarat-dan-ketentuan">Syarat dan ketentuan</Link>
            </nav>
          </div>
        </div>
      </footer>
    </>
  );
}
