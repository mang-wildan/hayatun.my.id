# Peta Rencana Pengerjaan — Toko Hayatun

SPEC, DESIGN, dan ARCHITECTURE terlalu besar untuk satu rencana. Pekerjaan dibagi menjadi 8 rencana berurutan. Setiap rencana menghasilkan perangkat lunak yang berjalan dan teruji. Rencana berikutnya ditulis setelah rencana sebelumnya selesai, supaya nama fungsi dan tabel yang dirujuk sudah pasti ada.

| # | Rencana | Isi | Fitur SPEC | Hasil yang bisa dicoba |
|---|---------|-----|------------|------------------------|
| 1 | **Fondasi dan akun** | Monorepo, paket bersama, API dasar, database, enkripsi, sesi, email dan antrean tugas, daftar/login/reset/TOTP, admin pertama, kerangka tampilan, CI | F1, F15.2, sebagian F11 dan F15 | Pembeli bisa daftar, verifikasi email, login, reset password. Admin pertama bisa login dengan TOTP. |
| 2 | Katalog dan produk | Penyimpanan file, kelola produk dan stok, kode lisensi massal, katalog dan detail produk | F2, F9 | Admin mengisi produk; pembeli melihat katalog. |
| 3 | Keranjang, ongkir, checkout, invoice | Keranjang, adaptor ongkir, penahanan stok, mesin status pesanan, penomoran invoice, halaman invoice | F3, F6, diagram status | Pembeli checkout dan mendapat invoice. |
| 4 | Pembayaran manual dan verifikasi | Unggah bukti, antrean verifikasi admin, kedaluwarsa 24 jam, pengingat, email terkait | F4, F5, sebagian F11 | Alur bayar lengkap sampai Lunas. |
| 5 | Pengiriman dan pengelolaan pesanan | Unduhan 15 menit, penetapan lisensi, resi, Diterima otomatis, pembatalan/pengembalian, daftar dan ringkasan admin | F7, F8, F10, F13.1–F13.2 | Pesanan selesai dari ujung ke ujung. |
| 6 | Privasi, admin, dan pengaturan | Hapus akun, hapus bukti 1 tahun, kebijakan privasi, undang/nonaktifkan admin, log aktivitas, pengaturan toko dan rekening | F12, F13.3, F15 | Semua fitur tahap 1 lengkap. |
| 7 | Operasi dan rilis | Nginx, PM2, SELinux, firewalld, logrotate, cadangan dan uji pulih, pemantauan, uji beban, ZAP, panduan operasi | N1, N22–N25, N30, N34, N35 | Toko berjalan di server produksi. |
| 8 | Payment gateway (tahap 2) | Adaptor gateway, webhook idempoten | F14 | Pembayaran otomatis. |

Rencana 1: [`2026-10-26-01-fondasi-dan-akun.md`](2026-10-26-01-fondasi-dan-akun.md)
