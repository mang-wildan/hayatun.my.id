import Link from "next/link";
import { apiServer, getAuth } from "@/lib/api-server";
import type { Cart } from "@/lib/cart";
import { LogoutButton } from "./LogoutButton";

// DESIGN §6: nama toko di kiri, akun di kanan, tanpa menu hamburger
export async function TopBar() {
  const { user } = await getAuth();
  const cart = user ? await apiServer<Cart>("/api/cart") : null;
  const count = cart?.ok ? cart.data.items.length : 0;
  return (
    <header className="top-bar">
      <Link href="/" className="brand">Hayatun</Link>
      <nav aria-label="Akun">
        {user ? (
          <>
            <Link href="/keranjang" className="nav-link" aria-label={count ? `Keranjang, ${count} item` : "Keranjang"}>
              Keranjang{count > 0 && <span className="count" aria-hidden="true">{count}</span>}
            </Link>
            {user.role !== "admin" && <Link href="/pesanan" className="nav-link">Pesanan</Link>}
            <Link href={user.role === "admin" ? "/admin" : "/akun/keamanan"} className="nav-link">Akun</Link>
            <LogoutButton />
          </>
        ) : (
          <Link href="/masuk" className="nav-link">Masuk</Link>
        )}
      </nav>
    </header>
  );
}
