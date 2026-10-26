import type { Metadata } from "next";
import { LoginForm } from "@/components/forms/AuthForms";

export const metadata: Metadata = { title: "Masuk" };

export default async function Masuk({ searchParams }: { searchParams: Promise<{ pesan?: string }> }) {
  const { pesan } = await searchParams;
  return (
    <>
      <h1>Masuk</h1>
      {pesan === "sesi-habis" && <p className="notice" role="status">Sesimu sudah habis, silakan masuk lagi ya.</p>}
      <LoginForm />
    </>
  );
}
