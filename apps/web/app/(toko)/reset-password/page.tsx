import type { Metadata } from "next";
import { ResetForm } from "@/components/forms/AuthForms";

export const metadata: Metadata = { title: "Atur ulang password" };

// Token dibaca dari alamat tautan di email; tanpa token, halaman menjelaskan apa yang harus dilakukan
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1>Atur ulang password</h1>
      {token ? <ResetForm token={token} /> : <p className="empty">Tautannya tidak lengkap. Buka lagi tautan dari emailmu ya.</p>}
    </>
  );
}
