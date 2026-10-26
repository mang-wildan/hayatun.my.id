import type { Metadata } from "next";
import { InviteForm } from "@/components/forms/AuthForms";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = { title: "Undangan admin" };

// Di luar grup (panel): halaman ini dibuka sebelum akun punya sesi
export default async function Undangan({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <TopBar />
      <main className="page">
        <h1>Undangan admin</h1>
        {token ? <InviteForm token={token} /> : <p className="empty">Tautannya tidak lengkap. Buka lagi tautan dari emailmu ya.</p>}
      </main>
    </>
  );
}
