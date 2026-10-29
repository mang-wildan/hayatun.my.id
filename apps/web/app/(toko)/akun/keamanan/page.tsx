import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SecurityPanel } from "@/components/forms/TotpForms";
import { getAuth } from "@/lib/api-server";

export const metadata: Metadata = { title: "Keamanan akun" };

export default async function Keamanan() {
  const { user, expired } = await getAuth();
  if (!user) redirect(expired ? "/masuk?pesan=sesi-habis" : "/masuk");
  return (
    <>
      <h1>Keamanan akun</h1>
      <h2>Verifikasi dua langkah</h2>
      <SecurityPanel role={user.role} totpEnabled={user.totpEnabled} />
      {user.role === "buyer" && <p><Link href="/akun/hapus">Hapus akun</Link></p>}
    </>
  );
}
