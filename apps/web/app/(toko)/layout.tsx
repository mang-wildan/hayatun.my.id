import type { ReactNode } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

export default function TokoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="page">{children}</main>
      <footer className="site-footer">
        <nav aria-label="Informasi hukum">
          <Link className="nav-link" href="/kebijakan-privasi">Kebijakan privasi</Link>
          <Link className="nav-link" href="/syarat-dan-ketentuan">Syarat dan ketentuan</Link>
        </nav>
      </footer>
    </>
  );
}
