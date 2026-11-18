import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNav } from "./AdminNav";
import { LogoutButton } from "./LogoutButton";

export function AdminShell({ children, queueCount = 0 }: { children: ReactNode; queueCount?: number }) {
  return (
    <div className="admin">
      <a className="skip-link" href="#konten-utama">Lewati ke konten utama</a>
      <header className="admin-top">
        <Link href="/admin" className="brand">Hayatun <span className="admin-label">Admin</span></Link>
        <LogoutButton />
      </header>
      <AdminNav queueCount={queueCount} />
      <main id="konten-utama" className="admin-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
