import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "./LogoutButton";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

// Menu yang sama di semua ukuran layar: navigasi bawah di HP dan tablet, menu samping dari 1024px (DESIGN §6)
const MENU = [
  { href: "/admin", label: "Verifikasi", d: "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/admin/pesanan", label: "Pesanan", d: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" },
  { href: "/admin/produk", label: "Produk", d: "M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" },
  { href: "/admin/lainnya", label: "Lainnya", d: "M4 7h16M4 12h16M4 17h16" },
];

export function AdminShell({ children, current = "/admin" }: { children: ReactNode; current?: string }) {
  return (
    <div className="admin">
      <header className="admin-top">
        <Link href="/admin" className="brand">Hayatun <span className="admin-label">Admin</span></Link>
        <LogoutButton />
      </header>
      <nav className="admin-nav" aria-label="Menu admin">
        <ul>
          {MENU.map((m) => (
            <li key={m.href}>
              <Link href={m.href} aria-current={m.href === current ? "page" : undefined}>
                {icon(m.d)}
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
