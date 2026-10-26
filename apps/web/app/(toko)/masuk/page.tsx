import type { Metadata } from "next";

export const metadata: Metadata = { title: "Masuk" };

// Formulirnya menyusul di T15; sementara hanya menampilkan pesan dari pengalihan.
export default async function Masuk({ searchParams }: { searchParams: Promise<{ pesan?: string }> }) {
  const { pesan } = await searchParams;
  return (
    <>
      <h1>Masuk</h1>
      {pesan === "sesi-habis" && <p className="notice" role="status">Sesimu sudah habis, silakan masuk lagi ya.</p>}
    </>
  );
}
