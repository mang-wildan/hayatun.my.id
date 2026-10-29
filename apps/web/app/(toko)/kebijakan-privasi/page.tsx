import type { Metadata } from "next";
import Link from "next/link";
import { Contact, Doc, Part } from "@/components/legal/Doc";

export const metadata: Metadata = { title: "Kebijakan privasi" };

// F12.4, N27, N29 sampai N31. Draf: perlu ditinjau ahli hukum sebelum toko dibuka.
export default function KebijakanPrivasi() {
  return (
    <Doc title="Kebijakan privasi" intro="Halaman ini menjelaskan data apa yang kami kumpulkan saat kamu memakai toko ini, untuk apa, berapa lama disimpan, dan siapa saja yang menerimanya.">
      <Part id="data" title="Data yang kami kumpulkan">
        <ul className="plain-list">
          <li>Akun: nama, email, dan password. Password disimpan sebagai hash, bukan apa adanya.</li>
          <li>Data pengiriman (alamat dan nomor HP): hanya bila pesananmu berisi produk fisik, karena hanya itu yang perlu kami kirim.</li>
          <li>Pesanan: isi pesanan, total, status, dan invoice.</li>
          <li>File bukti transfer yang kamu unggah untuk pembayaran.</li>
          <li>Cookie sesi supaya kamu tetap masuk.</li>
        </ul>
      </Part>
      <Part id="tujuan" title="Untuk apa data dipakai">
        <p>Data dipakai untuk memproses dan mengirim pesananmu, memeriksa (verifikasi) pembayaran, mengirim pemberitahuan lewat email tentang pesananmu, dan menjaga keamanan akunmu. Kami tidak memakainya untuk hal lain.</p>
      </Part>
      <Part id="simpan" title="Berapa lama data disimpan">
        <ul className="plain-list">
          <li>Bukti transfer dihapus otomatis 1 tahun setelah diunggah. Setelah itu yang tersisa hanya catatan bahwa pesanan lunas dan siapa yang memverifikasinya.</li>
          <li>Data invoice dan transaksi disimpan 10 tahun sebagai catatan pembukuan, tanpa data pribadimu bila akunmu sudah dihapus.</li>
          <li>Permintaan hapus akun kami proses paling lama 3×24 jam, dan data yang dihapus hilang dari cadangan paling lama 30 hari kemudian.</li>
          <li>Log aktivitas admin disimpan 2 tahun.</li>
          <li>Log teknis disimpan 90 hari dan tidak memuat data pribadi.</li>
        </ul>
      </Part>
      <Part id="pihak-ketiga" title="Pihak ketiga yang menerima data">
        <ul className="plain-list">
          <li>Layanan pengiriman email: penyedia email menerima alamat email dan isi pemberitahuan supaya email sampai kepadamu.</li>
          <li>Penyedia ekspedisi: hanya menerima wilayah tujuan, kode pos, dan berat paket untuk menghitung ongkos kirim. Ekspedisi tidak menerima nama atau nomor HP-mu dari kami saat menghitung ongkir.</li>
          <li>Penyedia payment gateway: hanya bila kami mengaktifkan pembayaran lewat gateway; saat ini belum aktif.</li>
        </ul>
        <p>Data pribadimu tidak dijual dan tidak dibagikan ke pihak lain di luar daftar ini.</p>
      </Part>
      <Part id="keamanan" title="Keamanan data">
        <p>Data pribadi dienkripsi saat disimpan: nama, email, nomor HP, alamat, dan file bukti transfer. Hanya admin toko yang bisa membuka bukti transfer dan alamat pengiriman, dan setiap pembukaan dicatat.</p>
      </Part>
      <Part id="hapus" title="Menghapus akunmu">
        <p>Kamu bisa meminta hapus akun kapan saja dari halaman <Link href="/akun/hapus">Hapus akun</Link> (perlu masuk dan memasukkan passwordmu). Kami memprosesnya paling lama 3×24 jam: profil, alamat, nomor HP, dan semua sesi masukmu dihapus, dan kami kirim email konfirmasi.</p>
        <p>Bila kamu masih punya pesanan yang masih berjalan (menunggu pembayaran, menunggu verifikasi, atau barang fisik yang belum diterima), penghapusan menunggu sampai pesanan itu selesai atau dibatalkan. Data invoice dan transaksi tetap disimpan 10 tahun sebagai catatan pembukuan.</p>
      </Part>
      <Contact lead="Pertanyaan tentang data pribadimu bisa disampaikan ke:" />
    </Doc>
  );
}
