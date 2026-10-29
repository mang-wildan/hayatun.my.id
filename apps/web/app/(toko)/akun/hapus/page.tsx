import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { apiServer, getAuth, unwrap } from "@/lib/api-server";

export const metadata: Metadata = { title: "Hapus akun" };

export default async function HapusAkun() {
  const { user, expired } = await getAuth();
  if (!user || user.role !== "buyer") redirect(expired ? "/masuk?pesan=sesi-habis" : "/masuk");
  const state = unwrap(await apiServer<{ requestedAt: string | null; blockers: { orderId: string; invoiceNumber: string; reason: string }[] }>("/api/account/deletion"));
  return (
    <>
      <h1>Hapus akun</h1>
      <section className="stack" aria-labelledby="dihapus-h">
        <h2 id="dihapus-h">Yang dihapus</h2>
        <ul className="plain-list"><li>Profil: nama, email, nomor HP, alamat, dan semua sesi masuk. Kamu tidak bisa masuk lagi dengan akun ini.</li></ul>
      </section>
      <section className="stack" aria-labelledby="disimpan-h">
        <h2 id="disimpan-h">Yang disimpan 10 tahun</h2>
        <ul className="plain-list"><li>Data invoice dan transaksi: nomor invoice, barang, total, dan tanggal pesanan, sebagai catatan pembukuan tanpa data pribadimu.</li></ul>
      </section>
      <DeleteAccount initial={state} />
    </>
  );
}
