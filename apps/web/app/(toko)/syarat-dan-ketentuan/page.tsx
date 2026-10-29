import type { Metadata } from "next";
import Link from "next/link";
import { Contact, Doc, Part } from "@/components/legal/Doc";

export const metadata: Metadata = { title: "Syarat dan ketentuan" };

// Hanya memuat aturan yang benar-benar dijalankan aplikasi. Draf: perlu ditinjau ahli hukum sebelum toko dibuka.
export default function SyaratDanKetentuan() {
  return (
    <Doc title="Syarat dan ketentuan" intro="Dengan memakai toko ini, kamu menyetujui aturan berikut.">
      <Part id="memesan" title="Memesan">
        <p>Untuk memesan kamu perlu punya akun dengan email yang sudah diverifikasi. Harga dan stok dikunci saat kamu checkout. Produk fisik memerlukan alamat pengiriman, dan ongkos kirim dihitung saat checkout.</p>
      </Part>
      <Part id="pembayaran" title="Pembayaran">
        <p>Pembayaran lewat transfer ke rekening yang tertera di halaman pesananmu. Unggah bukti transfer dalam 24 jam sejak pesanan dibuat; pesanan yang belum dibayar dalam batas itu kedaluwarsa dan stoknya dilepas. Setelah bukti diunggah, admin melakukan verifikasi. Bukti yang ditolak bisa diunggah ulang selama batas waktunya belum lewat.</p>
      </Part>
      <Part id="digital" title="Produk digital">
        <p>Setelah pesananmu lunas, file dan tautan produk bisa diunduh dari halaman pesananmu kapan saja tanpa batas jumlah unduhan. Tautan unduhan bersifat pribadi dan berlaku 15 menit; buat tautan baru bila sudah habis. Produk berlisensi mendapat satu kode lisensi per unit, yang tampil di halaman pesanan dan dikirim lewat email. Bila stok kode kosong, kode menyusul begitu toko menambah stok.</p>
      </Part>
      <Part id="fisik" title="Produk fisik">
        <p>Barang dikirim setelah pembayaran lunas, dan kamu menerima email berisi ekspedisi dan nomor resi. Setelah barang tiba, tekan Pesanan diterima di halaman pesananmu. Bila tidak ada konfirmasi, pesanan dianggap diterima 14 hari setelah dikirim.</p>
      </Part>
      <Part id="pembatalan" title="Pembatalan dan pengembalian">
        <p>Kamu bisa membatalkan pesanan yang belum dibayar sendiri dari halaman pesananmu. Untuk pesanan yang sudah lunas, hubungi toko; admin dapat menandainya Dibatalkan atau Dikembalikan, dan akses unduhan ikut dicabut. Penyelesaian dana dilakukan di luar aplikasi, lewat kontak toko di bawah.</p>
      </Part>
      <Part id="akun" title="Akun">
        <p>Jaga kerahasiaan passwordmu dan segera ganti bila kamu curiga akunmu dipakai orang lain. Cara kami memakai data pribadimu dijelaskan di <Link href="/kebijakan-privasi">Kebijakan privasi</Link>. Kamu bisa menghapus akunmu kapan saja.</p>
      </Part>
      <Contact lead="Pertanyaan tentang pesanan atau syarat ini bisa disampaikan ke:" />
    </Doc>
  );
}
