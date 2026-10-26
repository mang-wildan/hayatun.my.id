import Link from "next/link";
import { getAuth } from "@/lib/api-server";
import { LogoutButton } from "./LogoutButton";

// DESIGN §6: nama toko di kiri, akun di kanan, tanpa menu hamburger
export async function TopBar() {
  const { user } = await getAuth();
  return (
    <header className="top-bar">
      <Link href="/" className="brand">Hayatun</Link>
      <nav aria-label="Akun">
        {user ? (
          <>
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
