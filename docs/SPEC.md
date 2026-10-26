# SPEC — Toko Online Produk Digital & Fisik

Versi 1.0 · 2026-10-26 · Status: draf, menunggu persetujuan pemilik

Dokumen ini menjelaskan **apa** yang dibangun, bukan **dengan apa**. Pilihan teknologi diserahkan ke pembangun.

Kriteria penerimaan memakai pola EARS:

| Pola | Bentuk |
|------|--------|
| Umum | Sistem **harus** … |
| Pemicu | **Ketika** <kejadian>, sistem **harus** … |
| Keadaan | **Selama** <keadaan>, sistem **harus** … |
| Tidak diinginkan (error) | **Jika** <kondisi>, **maka** sistem **harus** … |
| Opsional | **Di mana** <fitur aktif>, sistem **harus** … |

Tanda **[usulan]** berarti keputusan dibuat penyusun spesifikasi, belum dikonfirmasi pemilik.

---

## 1. Masalah

Pemilik adalah UMKM (non-PKP) yang baru mulai berjualan. Saat ini penjualan hanya lewat mulut ke mulut. Belum ada tempat bagi pembeli untuk melihat produk, memesan, dan membayar sendiri. Pencatatan pesanan, bukti bayar, invoice, dan pengiriman produk digital masih manual, sehingga rawan terlewat, sulit dilacak, dan tidak meninggalkan catatan yang rapi untuk pembukuan.

Pemilik menjual dua jenis produk:

- **Digital**: e-book, template, aplikasi web, aplikasi mobile, dan lisensi (kode).
- **Fisik**: barang yang dikirim lewat ekspedisi.

**Tujuan**: toko online tempat pembeli memilih produk, checkout sendiri, membayar lewat transfer manual (tahap 1) atau payment gateway (tahap 2), lalu menerima invoice dan produknya. Pemilik dan para admin cukup memverifikasi pembayaran dan mengirim barang.

**Pengguna**

| Peran | Siapa | Kebutuhan utama |
|-------|-------|-----------------|
| Pembeli | Siapa pun yang punya akun | Belanja, bayar, unduh produk digital, lacak kiriman, unduh invoice |
| Admin | Pemilik dan para pembantu; **semua admin punya hak penuh** | Kelola produk dan stok, verifikasi bukti bayar, isi resi, kelola admin |

**Skala yang diharapkan (tahun pertama)**: sekitar 24 pesanan per bulan dan 10 produk. Target non-fungsional disiapkan untuk 10 kali skala ini.

**Ukuran keberhasilan**

- Setiap pesanan punya invoice, status yang jelas, dan jejak siapa yang memverifikasinya.
- Tidak ada pesanan lunas yang produk digitalnya tidak terkirim.
- Tidak ada stok atau kode lisensi yang terjual dua kali.

---

## 2. Di luar lingkup

Hal berikut **tidak** dibangun pada versi ini:

1. **Pemeriksaan keabsahan lisensi.** Aplikasi yang dijual tidak menghubungi toko untuk aktivasi, cek masa berlaku, atau jumlah perangkat. Toko hanya membagikan kode dari stok.
2. **Refund dan retur di dalam aplikasi.** Penyelesaian dilakukan di luar aplikasi. Admin hanya menandai pesanan "Dibatalkan/Dikembalikan" (lihat F10).
3. **Faktur pajak dan PPN.** Pemilik non-PKP; invoice biasa saja.
4. **Pemberitahuan lewat WhatsApp, SMS, atau push.** Hanya email.
5. Voucher atau kode diskon.
6. Ulasan dan rating produk.
7. Program afiliasi atau reseller.
8. Aplikasi mobile khusus untuk toko. Toko dibuka lewat browser di HP dan laptop.
9. Bahasa selain Indonesia; mata uang selain Rupiah.
10. Laporan penjualan rumit. Cukup daftar pesanan yang bisa difilter dan total per bulan (F13).
11. Chat di dalam aplikasi.
12. Peran admin dengan hak terbatas. Semua admin berhak penuh.
13. Input pesanan manual oleh admin (misalnya dari chat). Semua pesanan dibuat pembeli sendiri.

---

## 3. Fitur

### Status pesanan (acuan untuk semua fitur)

```
Menunggu Pembayaran ──(unggah bukti)──▶ Menunggu Verifikasi ──(diterima)──▶ Lunas
        ▲                                     │
        └──────────(ditolak + alasan)─────────┘
Menunggu Pembayaran ──(lewat 24 jam / dibatalkan pembeli)──▶ Kedaluwarsa / Dibatalkan
Lunas ──▶ bagian digital: Terkirim
      ──▶ bagian fisik:   Diproses ──▶ Dikirim (resi) ──▶ Diterima
Pesanan selesai ketika semua bagiannya selesai.
Admin dapat mengubah pesanan Lunas mana pun menjadi Dibatalkan/Dikembalikan.
```

Pada tahap 2 (F14), pembayaran lewat gateway langsung berpindah dari Menunggu Pembayaran ke Lunas tanpa Menunggu Verifikasi.

---

### F1. Akun pembeli

**Sebagai** pembeli, **saya ingin** membuat akun dan login, **agar** saya bisa melihat riwayat pesanan, invoice, dan mengunduh ulang produk digital kapan saja.

- F1.1 Sistem **harus** mewajibkan akun yang sudah login untuk checkout.
- F1.2 **Ketika** pembeli mendaftar dengan nama, email, dan password, sistem **harus** mengirim email verifikasi. Akun tidak bisa checkout sebelum email terverifikasi. **[usulan]**
- F1.3 **Ketika** pembeli meminta reset password, sistem **harus** mengirim tautan reset sekali pakai yang kedaluwarsa dalam 60 menit.
- F1.4 **Di mana** pembeli mengaktifkan verifikasi dua langkah, sistem **harus** meminta kode authenticator setiap login.
- F1.5 **Ketika** pembeli meminta hapus akun, sistem **harus** memproses dalam paling lama 3×24 jam, sesuai F12.
- F1.6 **Jika** email yang didaftarkan sudah dipakai, **maka** sistem **harus** menampilkan pesan umum yang tidak membocorkan apakah email itu terdaftar, dan mengirim email pemberitahuan ke pemilik email tersebut.
- F1.7 **Jika** tautan verifikasi atau reset sudah kedaluwarsa atau sudah dipakai, **maka** sistem **harus** menolaknya dan menawarkan pengiriman tautan baru.
- F1.8 **Jika** login gagal 5 kali dalam 15 menit untuk satu akun, **maka** sistem **harus** menunda percobaan berikutnya selama 15 menit dan memberi tahu pemilik akun lewat email.

### F2. Katalog produk

**Sebagai** pembeli, **saya ingin** melihat daftar dan detail produk, **agar** saya tahu apa yang dijual, harganya, dan apakah tersedia.

- F2.1 Sistem **harus** menampilkan setiap produk aktif dengan nama, foto, deskripsi, harga (Rupiah), jenis (digital/fisik), dan status ketersediaan.
- F2.2 Katalog **harus** bisa dilihat tanpa login.
- F2.3 **Selama** stok produk fisik atau stok kode lisensi suatu produk bernilai 0 (setelah dikurangi stok yang ditahan), sistem **harus** menampilkan produk sebagai "Habis" dan mencegahnya masuk keranjang.
- F2.4 **Jika** produk dinonaktifkan admin saat ada di keranjang pembeli, **maka** sistem **harus** menandainya di keranjang dan mencegah checkout untuk item itu.

### F3. Keranjang dan checkout

**Sebagai** pembeli, **saya ingin** memasukkan produk digital dan fisik ke satu keranjang lalu checkout sekali, **agar** saya cukup membayar satu kali.

- F3.1 Sistem **harus** mengizinkan produk digital dan fisik dalam satu keranjang dan satu pesanan.
- F3.2 **Ketika** keranjang berisi minimal satu produk fisik, sistem **harus** meminta alamat pengiriman dan menghitung ongkir otomatis dari alamat tujuan dan total berat. Pembeli memilih dari layanan pengiriman yang tersedia. **[usulan]**
- F3.3 **Ketika** keranjang hanya berisi produk digital, sistem **tidak boleh** meminta alamat atau nomor HP.
- F3.4 **Ketika** pembeli mengonfirmasi checkout, sistem **harus** membuat pesanan berstatus Menunggu Pembayaran, mengunci harga dan ongkir pada saat itu, menahan stok fisik dan kode lisensi untuk pesanan tersebut, menerbitkan invoice (F6), dan menampilkan instruksi pembayaran beserta batas waktunya.
- F3.5 Sistem **harus** menampilkan rincian sebelum konfirmasi: item, jumlah, subtotal, ongkir, dan total.
- F3.6 **Jika** tarif ongkir gagal diambil (layanan ekspedisi tidak merespons dalam 5 detik atau mengembalikan error), **maka** sistem **harus** menahan checkout, menampilkan pesan "Ongkir belum bisa dihitung, coba lagi beberapa saat", dan **tidak boleh** memakai ongkir Rp0.
- F3.7 **Jika** alamat tujuan tidak dilayani ekspedisi, **maka** sistem **harus** memberi tahu pembeli dan mencegah checkout untuk bagian fisik.
- F3.8 **Jika** stok habis di antara saat masuk keranjang dan konfirmasi checkout (misalnya dibeli orang lain), **maka** sistem **harus** menolak checkout, menunjukkan item yang habis, dan **tidak boleh** membuat pesanan sebagian tanpa persetujuan pembeli.
- F3.9 **Jika** dua pembeli checkout bersamaan untuk stok terakhir, **maka** sistem **harus** memberikan stok ke tepat satu pesanan; pembeli lain menerima pesan stok habis (F3.8).

### F4. Pembayaran transfer manual

**Sebagai** pembeli, **saya ingin** transfer ke rekening toko lalu mengunggah bukti bayar, **agar** pesanan saya bisa diverifikasi.

- F4.1 Sistem **harus** menampilkan rekening tujuan (bank, nomor, atas nama), total yang harus ditransfer, dan batas waktu unggah bukti.
- F4.2 Sistem **harus** memberi batas waktu **1×24 jam sejak checkout** untuk mengunggah bukti bayar. Batas ini berlaku untuk unggah bukti, **bukan** untuk verifikasi admin.
- F4.3 **Ketika** pembeli mengunggah bukti bayar (JPG, PNG, atau PDF; maks. 5 MB) **[usulan]**, sistem **harus** menyimpannya terenkripsi, mengubah status menjadi Menunggu Verifikasi, dan memberi tahu admin lewat email.
- F4.4 **Ketika** batas 24 jam lewat dan belum ada bukti terunggah, sistem **harus** mengubah status menjadi Kedaluwarsa dalam waktu paling lama 5 menit, melepas stok fisik dan kode lisensi yang ditahan, dan memberi tahu pembeli lewat email.
- F4.5 **Ketika** tersisa 3 jam sebelum batas waktu dan belum ada bukti, sistem **harus** mengirim email pengingat ke pembeli. **[usulan]**
- F4.6 **Selama** status Menunggu Pembayaran, pembeli **harus** bisa membatalkan pesanannya sendiri; stok yang ditahan langsung dilepas. **[usulan]**
- F4.7 **Jika** file yang diunggah bukan JPG, PNG, atau PDF (diperiksa dari isi file, bukan nama), lebih besar dari 5 MB, atau rusak, **maka** sistem **harus** menolaknya dengan pesan yang menyebut alasannya, dan status pesanan tidak berubah.
- F4.8 **Jika** pembeli mencoba mengunggah bukti setelah pesanan Kedaluwarsa, **maka** sistem **harus** menolak dan menyarankan checkout ulang.

### F5. Verifikasi pembayaran oleh admin

**Sebagai** admin, **saya ingin** melihat bukti bayar lalu menerima atau menolaknya, **agar** hanya pesanan yang benar-benar dibayar yang diproses.

- F5.1 Sistem **harus** menampilkan antrean pesanan Menunggu Verifikasi, diurutkan dari yang paling lama menunggu.
- F5.2 **Ketika** admin menerima bukti, sistem **harus** mengubah status menjadi Lunas, memperbarui invoice menjadi Lunas, menjalankan pengiriman digital (F7), memindahkan bagian fisik ke Diproses (F8), mencatat siapa dan kapan memverifikasi, serta mengirim email ke pembeli.
- F5.3 **Ketika** admin menolak bukti, sistem **harus** mewajibkan alasan tertulis, mengembalikan status ke Menunggu Pembayaran, menampilkan alasannya ke pembeli, dan mengirim email ke pembeli.
- F5.4 **Selama** batas 24 jam belum lewat, pembeli yang buktinya ditolak **harus** bisa mengunggah ulang.
- F5.5 **Ketika** bukti ditolak setelah batas 24 jam lewat, sistem **harus** memberi pembeli tambahan waktu 24 jam sejak penolakan untuk unggah ulang, supaya pembeli tidak dirugikan oleh lambatnya verifikasi. **[usulan]**
- F5.6 **Jika** dua admin memproses bukti yang sama bersamaan, **maka** sistem **harus** menerima hanya tindakan pertama dan memberi tahu admin kedua bahwa pesanan sudah diproses.
- F5.7 **Jika** admin mencoba menolak tanpa alasan, **maka** sistem **harus** mencegah penyimpanan.

### F6. Invoice

**Sebagai** pembeli, **saya ingin** invoice untuk setiap pesanan, **agar** saya punya catatan resmi transaksi. **Sebagai** pemilik, **saya ingin** invoice bernomor urut, **agar** pembukuan saya rapi.

- F6.1 **Ketika** pesanan dibuat, sistem **harus** menerbitkan invoice dengan nomor unik dan berurutan per bulan, misalnya `INV/2026/10/0001` **[usulan]**. Nomor tidak boleh dipakai ulang, termasuk untuk pesanan yang batal.
- F6.2 Invoice **harus** memuat: nomor, tanggal terbit, nama dan kontak toko, nama dan email pembeli, alamat kirim (jika ada produk fisik), rincian item (nama, jumlah, harga satuan, subtotal), ongkir, total, cara bayar, status (Belum Lunas / Lunas / Dibatalkan), dan tanggal lunas.
- F6.3 Invoice **tidak boleh** memuat PPN atau label "faktur pajak".
- F6.4 Pembeli dan admin **harus** bisa melihat dan mengunduh invoice sebagai dokumen yang bisa dicetak.
- F6.5 **Selama** invoice berstatus Lunas, isi item dan nominalnya **tidak boleh** berubah. Pembatalan hanya mengubah status menjadi Dibatalkan beserta tanggalnya.
- F6.6 **Jika** pengguna yang bukan pemilik pesanan dan bukan admin mencoba membuka invoice, **maka** sistem **harus** menolak akses tanpa membocorkan apakah invoice itu ada.

### F7. Pengiriman produk digital

**Sebagai** pembeli, **saya ingin** langsung bisa mengunduh produk digital dan menerima kode lisensi setelah lunas, **agar** saya tidak perlu menunggu admin mengirim manual.

- F7.1 **Ketika** pesanan menjadi Lunas, sistem **harus** dalam 1 menit membuka akses unduhan untuk semua item digital dan menetapkan tepat satu kode lisensi dari stok untuk setiap unit produk berlisensi.
- F7.2 Pembeli **harus** bisa mengunduh produk digitalnya kapan saja dari halaman akun, **tanpa batas jumlah unduhan**, selama pesanannya tidak Dibatalkan/Dikembalikan.
- F7.3 **Ketika** pembeli menekan tombol unduh, sistem **harus** membuat tautan pribadi yang hanya berlaku untuk akun itu dan **kedaluwarsa dalam 15 menit**.
- F7.4 Produk aplikasi web atau mobile **harus** dikirim sebagai file dan/atau tautan yang diisi admin di data produk, ditambah kode lisensi jika produk itu berlisensi.
- F7.5 Kode lisensi yang sudah ditetapkan **harus** terlihat di halaman pesanan pembeli dan ikut dalam email Lunas.
- F7.6 **Jika** tautan unduhan dipakai setelah 15 menit atau oleh akun lain, **maka** sistem **harus** menolak dan meminta pembeli membuat tautan baru dari akunnya.
- F7.7 **Jika** stok kode lisensi ternyata kosong saat penetapan, **maka** sistem **harus** tetap menandai pesanan Lunas, menandai item itu "Lisensi tertunda", memberi tahu semua admin lewat email, dan mengirim kode ke pembeli segera setelah admin menambah stok. (Ini seharusnya tidak terjadi karena stok ditahan saat checkout; aturan ini jaring pengaman.)
- F7.8 **Jika** pesanan menjadi Dibatalkan/Dikembalikan, **maka** sistem **harus** langsung mencabut akses unduhan. Kode lisensi yang sudah dikirim **tidak** dikembalikan ke stok.

### F8. Pengiriman produk fisik

**Sebagai** admin, **saya ingin** mencatat nomor resi, **agar** pembeli bisa melacak kirimannya. **Sebagai** pembeli, **saya ingin** tahu status barang saya.

- F8.1 Sistem **harus** menampilkan ke admin daftar pesanan yang bagian fisiknya berstatus Diproses, lengkap dengan alamat kirim dan layanan ekspedisi yang dipilih pembeli.
- F8.2 **Ketika** admin mengisi nomor resi, sistem **harus** mengubah bagian fisik menjadi Dikirim dan mengirim email berisi nama ekspedisi dan nomor resi ke pembeli.
- F8.3 **Ketika** pembeli menekan "Pesanan diterima", atau 14 hari setelah berstatus Dikirim tanpa keluhan **[usulan]**, sistem **harus** mengubah bagian fisik menjadi Diterima.
- F8.4 **Jika** admin mengisi resi kosong atau dengan format yang jelas salah (kurang dari 8 karakter), **maka** sistem **harus** menolak penyimpanan. **[usulan]**
- F8.5 **Jika** admin perlu memperbaiki resi, **maka** sistem **harus** mengizinkan perubahan, mencatat nilai lama dan baru di log aktivitas, dan mengirim email pembaruan ke pembeli.

### F9. Pengelolaan produk dan stok (admin)

**Sebagai** admin, **saya ingin** menambah dan mengubah produk serta stoknya, **agar** katalog selalu akurat.

- F9.1 Admin **harus** bisa membuat, mengubah, menonaktifkan, dan mengaktifkan produk dengan data: nama, deskripsi, foto, harga, dan jenis.
- F9.2 Produk fisik **harus** punya berat (gram) dan jumlah stok. Produk digital **harus** punya minimal satu file atau tautan.
- F9.3 Admin **harus** bisa menandai produk digital sebagai berlisensi dan menambah kode lisensi secara massal (satu kode per baris).
- F9.4 Sistem **harus** menampilkan untuk setiap produk: stok tersedia, stok ditahan, dan stok terjual.
- F9.5 **Ketika** stok tersedia (fisik atau kode lisensi) turun menjadi 3 atau kurang **[usulan]**, sistem **harus** mengirim email peringatan ke semua admin, sekali per penurunan ke bawah ambang.
- F9.6 **Jika** admin menyimpan produk fisik tanpa berat atau dengan berat 0, **maka** sistem **harus** menolak penyimpanan, karena ongkir tidak bisa dihitung.
- F9.7 **Jika** admin menambah kode lisensi yang sudah ada di stok produk yang sama, **maka** sistem **harus** menolak kode duplikat itu dan melaporkan jumlah yang ditolak.
- F9.8 **Jika** admin mengubah harga, **maka** pesanan yang sudah dibuat **tidak boleh** ikut berubah (F3.4).
- F9.9 Produk yang sudah pernah dipesan **tidak boleh** dihapus permanen, hanya dinonaktifkan, agar invoice lama tetap utuh.

### F10. Pembatalan dan pengembalian (admin)

**Sebagai** admin, **saya ingin** menandai pesanan sebagai dibatalkan atau dikembalikan beserta catatan, **agar** kasus yang diselesaikan di luar aplikasi tetap tercatat.

- F10.1 Admin **harus** bisa mengubah pesanan berstatus Lunas atau lebih lanjut menjadi Dibatalkan/Dikembalikan, dengan catatan wajib.
- F10.2 **Ketika** pesanan Dibatalkan/Dikembalikan, sistem **harus** mencabut akses unduhan (F7.8), memperbarui status invoice, mencatat tindakan di log aktivitas, dan mengirim email ke pembeli.
- F10.3 **Ketika** pesanan yang bagian fisiknya belum Dikirim dibatalkan, sistem **harus** mengembalikan stok fisiknya. **Ketika** bagian fisiknya sudah Dikirim, stok **tidak** otomatis kembali; admin menambahkannya manual bila barang benar kembali.
- F10.4 **Jika** admin mencoba membatalkan tanpa catatan, **maka** sistem **harus** mencegah penyimpanan.

### F11. Pemberitahuan email

**Sebagai** pembeli dan admin, **saya ingin** diberi tahu lewat email setiap ada kejadian penting, **agar** saya tidak perlu terus membuka aplikasi.

- F11.1 Sistem **harus** mengirim email ke **pembeli** untuk: verifikasi akun, reset password, pesanan dibuat (berisi instruksi bayar), pengingat 3 jam sebelum kedaluwarsa, pesanan kedaluwarsa, bukti ditolak (berisi alasan), pesanan lunas (berisi akses unduhan dan kode lisensi), resi diisi atau diubah, pesanan dibatalkan/dikembalikan, dan akun dihapus.
- F11.2 Sistem **harus** mengirim email ke **semua admin** untuk: bukti bayar baru diunggah, stok rendah, lisensi tertunda, dan admin baru ditambahkan atau dihapus.
- F11.3 Email **tidak boleh** memuat password, data pribadi pembeli lain, atau lampiran bukti transfer.
- F11.4 **Jika** pengiriman email gagal, **maka** sistem **harus** mencoba ulang minimal 3 kali dalam 30 menit, mencatat kegagalannya, dan **tidak boleh** membatalkan atau menunda perubahan status pesanan. Semua informasi di email juga harus tersedia di halaman akun.

### F12. Data pribadi dan hapus akun

**Sebagai** pembeli, **saya ingin** data pribadi saya dilindungi dan bisa dihapus, **agar** privasi saya terjaga sesuai UU PDP.

- F12.1 Sistem **harus** mengenkripsi data pribadi saat disimpan: nama, email, nomor HP, alamat, dan file bukti transfer.
- F12.2 **Ketika** permintaan hapus akun diproses, sistem **harus** menghapus atau menganonimkan profil, alamat, dan nomor HP, mengakhiri semua sesi akun itu, dan mengirim email konfirmasi. Data invoice dan transaksi **tetap disimpan 10 tahun** sebagai catatan pembukuan.
- F12.3 Sistem **harus** menghapus otomatis file bukti transfer **1 tahun** setelah diunggah. Setelah itu yang tersisa hanya catatan "Lunas, diverifikasi oleh <admin> pada <tanggal>".
- F12.4 Sistem **harus** menampilkan halaman kebijakan privasi yang menyebut: data apa yang dikumpulkan, untuk apa, berapa lama disimpan, ke pihak ketiga mana data dikirim, dan cara meminta hapus akun.
- F12.5 **Jika** pembeli yang meminta hapus akun masih punya pesanan Menunggu Verifikasi atau bagian fisik yang belum Diterima, **maka** sistem **harus** memberi tahu pembeli dan menunda penghapusan sampai pesanan itu selesai atau dibatalkan. **[usulan]**

### F13. Pengelolaan pesanan dan ringkasan (admin)

**Sebagai** admin, **saya ingin** melihat semua pesanan dan total penjualan per bulan, **agar** saya tahu apa yang perlu dikerjakan dan berapa hasil penjualan.

- F13.1 Sistem **harus** menampilkan daftar pesanan yang bisa difilter berdasarkan status, rentang tanggal, dan jenis produk, serta bisa dicari berdasarkan nomor invoice.
- F13.2 Sistem **harus** menampilkan total penjualan lunas per bulan (jumlah pesanan dan nilai Rupiah, dipisah antara produk dan ongkir).
- F13.3 Admin **harus** bisa mengatur informasi toko tanpa bantuan pembangun: nama toko, kontak, dan rekening tujuan transfer.

### F14. Pembayaran lewat payment gateway — **TAHAP 2**

**Sebagai** pembeli, **saya ingin** membayar lewat gateway (misalnya virtual account atau e-wallet), **agar** pembayaran langsung terkonfirmasi tanpa unggah bukti.

Tahap 1 **harus** dirancang supaya fitur ini bisa ditambah tanpa mengubah alur status pesanan.

- F14.1 **Ketika** pembeli memilih gateway saat checkout, sistem **harus** mengarahkan pembeli ke pembayaran gateway dengan nominal yang sama dengan total invoice.
- F14.2 **Ketika** gateway mengonfirmasi pembayaran berhasil, sistem **harus** langsung mengubah status menjadi Lunas tanpa verifikasi admin, lalu menjalankan F5.2 (kecuali bagian verifikasi), dengan catatan "Lunas via gateway".
- F14.3 Sistem **harus** memproses konfirmasi gateway hanya setelah keasliannya diverifikasi, misalnya dengan tanda tangan dari gateway.
- F14.4 **Jika** konfirmasi gateway yang sama diterima lebih dari sekali, **maka** sistem **harus** memprosesnya tepat satu kali.
- F14.5 **Jika** nominal yang dikonfirmasi gateway tidak sama dengan total invoice, **maka** sistem **tidak boleh** menandai Lunas, dan harus menandai pesanan untuk diperiksa admin.
- F14.6 **Jika** konfirmasi gateway tiba setelah pesanan Kedaluwarsa, **maka** sistem **harus** menandai pesanan untuk ditangani admin dan **tidak boleh** menetapkan stok otomatis.
- F14.7 **Jika** konfirmasi tidak datang dalam batas waktu gateway, **maka** sistem **harus** memperlakukan pesanan seperti F4.4 (kedaluwarsa dan stok dilepas).

### F15. Akun admin dan log aktivitas

**Sebagai** pemilik, **saya ingin** menambah admin dan melihat siapa melakukan apa, **agar** kesalahan bisa dilacak dan akses bisa dicabut.

- F15.1 Admin **harus** bisa mengundang admin baru lewat email dan menonaktifkan admin lain.
- F15.2 Sistem **harus** mewajibkan verifikasi dua langkah (password + kode authenticator) untuk setiap login admin. **[usulan — belum dijawab pemilik]**
- F15.3 Sistem **harus** mencatat di log aktivitas setiap tindakan admin: verifikasi diterima/ditolak, perubahan status, pengisian resi, perubahan produk, harga, dan stok, penambahan kode lisensi, perubahan rekening, penambahan atau penonaktifan admin, serta **setiap pembukaan data pribadi atau bukti transfer**. Setiap catatan berisi siapa, apa, kapan, dan pesanan atau produk terkait.
- F15.4 Log aktivitas **tidak boleh** bisa diubah atau dihapus oleh admin mana pun.
- F15.5 **Ketika** admin dinonaktifkan, sistem **harus** mengakhiri semua sesinya dalam 1 menit.
- F15.6 **Jika** admin yang tinggal satu-satunya mencoba menonaktifkan dirinya sendiri, **maka** sistem **harus** mencegahnya.
- F15.7 **Ketika** rekening tujuan transfer diubah, sistem **harus** mengirim email pemberitahuan ke semua admin, karena perubahan rekening adalah sasaran penipuan.

---

## 4. Non-fungsional

Angka di bawah disiapkan untuk skala 10 kali tahun pertama: sekitar 240 pesanan per bulan dan 100 produk.

### Keamanan

- **N1. Enkripsi saat dikirim.** Semua lalu lintas memakai TLS 1.2 atau lebih baru. Akses lewat HTTP biasa dialihkan ke HTTPS. 0 halaman yang bisa diakses tanpa enkripsi.
- **N2. Enkripsi saat disimpan.** Data pribadi (F12.1) dan file bukti transfer dienkripsi dengan algoritma standar industri, minimal setara AES-256. Kunci enkripsi disimpan terpisah dari data dan tidak pernah ada di kode sumber. Cadangan (backup) juga terenkripsi.
- **N3. Password.** Disimpan hanya sebagai hash satu arah dengan algoritma yang dirancang untuk password. Panjang minimal 8 karakter. Password yang ada di daftar password bocor umum ditolak.
- **N4. Login.** Ada pembatasan percobaan sesuai F1.8. Sesi admin berakhir setelah 30 menit tidak aktif. Sesi pembeli berakhir setelah 30 hari. Login admin wajib dua langkah (F15.2).
- **N5. Akses file.** File produk digital dan bukti transfer tidak pernah bisa diakses lewat alamat publik. Akses hanya lewat tautan pribadi berumur 15 menit (produk) atau halaman admin (bukti). File unggahan tidak pernah dijalankan oleh server.
- **N6. Otorisasi.** Setiap permintaan data pesanan, invoice, unduhan, atau bukti diperiksa kepemilikannya di server. Uji otorisasi mencakup 100% halaman dan aksi yang menampilkan data pembeli.
- **N7. Kerentanan.** Sebelum rilis tahap 1, 0 temuan tingkat tinggi atau kritis dari pemeriksaan keamanan terhadap risiko umum aplikasi web (daftar OWASP Top 10).

### Kegunaan

- **N8.** Pembeli baru bisa menyelesaikan pembelian dari halaman produk sampai instruksi bayar dalam **≤ 5 layar** dan **≤ 5 menit**. Diuji dengan 5 orang; minimal 4 dari 5 berhasil tanpa bantuan.
- **N9.** Admin bisa memverifikasi satu bukti bayar (buka, periksa, terima atau tolak) dalam **≤ 1 menit** dan **≤ 3 klik** dari antrean.
- **N10.** Semua pesan error berbahasa Indonesia dan menyebut apa yang terjadi serta apa yang bisa dilakukan pengguna. Tidak ada kode error mentah yang ditampilkan ke pengguna.
- **N11.** Semua halaman pembeli dan admin bisa dipakai penuh di layar selebar **360 px** tanpa gulir horizontal.

### Aksesibilitas

- **N12.** Halaman pembeli dan admin memenuhi **WCAG 2.1 level AA**.
- **N13.** Kontras teks minimal **4,5:1** (teks besar 3:1). Ukuran teks isi minimal **16 px**. Area sentuh minimal **44 × 44 px**.
- **N14.** Seluruh alur checkout, unggah bukti, dan verifikasi admin bisa diselesaikan hanya dengan keyboard, dengan penanda fokus yang selalu terlihat.
- **N15.** Setiap kolom isian punya label yang terlihat. Pesan error muncul di dekat kolomnya dan dibacakan pembaca layar. Status tidak pernah disampaikan lewat warna saja.
- **N16.** Semua gambar produk punya teks alternatif. Animasi dimatikan bila pengguna memilih "kurangi gerakan" di perangkatnya.

### Performa

- **N17.** Halaman katalog dan detail produk tampil (LCP) dalam **≤ 2,5 detik** pada persentil ke-75, di HP kelas menengah dengan jaringan 4G.
- **N18.** Respons server untuk aksi biasa (buka halaman, simpan, ubah status) **≤ 500 ms** pada persentil ke-95, pada beban 50 pengguna bersamaan.
- **N19.** Permintaan tarif ongkir dibatasi **5 detik**, lalu berlaku F3.6.
- **N20.** Email dari F11 terkirim dalam **≤ 5 menit** sejak kejadian, pada persentil ke-95.
- **N21.** Unggah bukti 5 MB selesai dalam **≤ 10 detik** di jaringan 4G.

### Keandalan

- **N22.** Ketersediaan toko minimal **99,5% per bulan**, atau paling lama sekitar 3,6 jam tidak bisa diakses per bulan.
- **N23.** Cadangan data setiap hari. Data yang boleh hilang paling banyak **24 jam** (RPO). Pemulihan selesai dalam **≤ 8 jam** (RTO). Uji pemulihan dilakukan **setiap 3 bulan**.
- **N24.** **0 kejadian** stok fisik atau kode lisensi yang terjual atau ditetapkan dua kali, termasuk saat ada permintaan bersamaan (F3.9, F5.6).
- **N25.** Proses otomatis (kedaluwarsa 24 jam, pengingat, penghapusan bukti 1 tahun) berjalan paling lambat **5 menit** dari jadwalnya. Bila sempat mati, proses mengejar semua yang tertinggal saat hidup kembali.
- **N26.** Gangguan pada layanan pihak ketiga (ekspedisi, email, dan gateway di tahap 2) tidak membuat katalog, akun, atau unduhan produk digital ikut mati.

### Privasi

- **N27.** **Minimalisasi data.** Nomor HP dan alamat hanya diminta bila pesanan berisi produk fisik. Layanan ekspedisi hanya menerima data yang dibutuhkan untuk tarif (wilayah tujuan dan berat), bukan nama atau nomor HP pembeli.
- **N28.** **100%** pembukaan data pribadi dan bukti transfer oleh admin tercatat di log aktivitas (F15.3). Log disimpan minimal **2 tahun**. **[usulan]**
- **N29.** **Masa simpan.** Permintaan hapus akun diproses dalam ≤ 3×24 jam. Bukti transfer dihapus setelah 1 tahun. Invoice dan transaksi disimpan 10 tahun. Data yang dihapus juga hilang dari cadangan paling lama **30 hari** kemudian, mengikuti siklus cadangan.
- **N30.** Log teknis (log error dan log server) **tidak boleh** memuat password, isi data pribadi, atau kode lisensi. Log teknis disimpan **90 hari**.
- **N31.** Data pribadi tidak dibagikan ke pihak ketiga selain yang tercantum di kebijakan privasi (F12.4): penyedia email, ekspedisi (data terbatas sesuai N27), dan gateway (tahap 2).

### Perawatan

- **N32.** Informasi toko dan rekening bisa diubah admin sendiri (F13.3), tanpa mengubah kode.
- **N33.** Semua perpindahan status pesanan pada diagram di bagian 3 punya uji otomatis. Cakupan: **100% perpindahan status**, termasuk jalur error.
- **N34.** Pembaruan keamanan untuk komponen pihak ketiga dengan tingkat tinggi atau kritis dipasang dalam **≤ 30 hari** sejak tersedia.
- **N35.** Ada dokumen singkat untuk: cara memasang ulang aplikasi dari nol, cara memulihkan cadangan, dan cara mengganti kunci enkripsi. Prosedurnya bisa diikuti oleh pembangun lain tanpa bertanya ke pembangun asli.
- **N36.** Menambah gateway di tahap 2 (F14) tidak mengubah diagram status tahap 1. Gateway hanya menambah jalur Menunggu Pembayaran → Lunas.

---

## 5. Asumsi dan pertanyaan terbuka

### Asumsi (keputusan penyusun, silakan koreksi)

| # | Asumsi | Terkait |
|---|--------|---------|
| A1 | Admin wajib verifikasi dua langkah. Pertanyaan ini diajukan tapi belum dijawab sebelum wawancara ditutup. | F15.2, N4 |
| A2 | Pembeli wajib memverifikasi email sebelum bisa checkout. | F1.2 |
| A3 | Pembeli memilih sendiri layanan ekspedisi dari pilihan yang tersedia. | F3.2 |
| A4 | Format bukti bayar: JPG, PNG, atau PDF, maksimal 5 MB. | F4.3 |
| A5 | Ada email pengingat 3 jam sebelum pesanan kedaluwarsa. | F4.5 |
| A6 | Pembeli boleh membatalkan pesanan sendiri selama belum membayar. | F4.6 |
| A7 | Bila bukti ditolak setelah batas 24 jam, pembeli mendapat tambahan 24 jam sejak penolakan. | F5.5 |
| A8 | Format nomor invoice: `INV/YYYY/MM/NNNN`. | F6.1 |
| A9 | Bagian fisik otomatis berstatus Diterima 14 hari setelah Dikirim. | F8.3 |
| A10 | Ambang peringatan stok rendah: 3 unit atau kode. | F9.5 |
| A11 | Hapus akun ditunda bila masih ada pesanan aktif. | F12.5 |
| A12 | Log aktivitas disimpan minimal 2 tahun. | N28 |
| A13 | Satu toko, satu pemilik usaha, satu atau lebih rekening tujuan transfer. | F4.1, F13.3 |
| A14 | Semua admin bisa mengundang dan menonaktifkan admin lain, karena semua admin berhak penuh. | F15.1 |

### Pertanyaan terbuka

1. **Layanan tarif ekspedisi.** Ekspedisi mana yang dipakai (JNE, J&T, SiCepat, dan lain-lain), dan layanan apa yang menyediakan tarifnya? Ini menentukan pilihan kurir yang tampil di F3.2.
2. **Kode unik transfer.** Apakah total transfer perlu ditambah kode unik 3 digit (misalnya Rp150.123) supaya admin lebih mudah mencocokkan mutasi rekening? Ini mengubah total di invoice.
3. **Nominal kurang atau lebih.** Bila pembeli transfer kurang Rp1.000 atau lebih Rp10.000, apakah admin selalu menolak, atau boleh menerima dengan catatan?
4. **Target waktu verifikasi.** Berapa lama paling lambat admin harus memverifikasi bukti, misalnya 1×24 jam di hari kerja? Perlukah target itu ditampilkan ke pembeli?
5. **Bentuk aplikasi mobile yang dijual.** Apakah berupa file (misalnya APK atau kode sumber), tautan ke toko aplikasi, atau keduanya? Ini memengaruhi ukuran file maksimal yang harus didukung.
6. **Ukuran file produk digital terbesar.** Berapa ukuran file terbesar yang akan dijual (aplikasi dan video template bisa ratusan MB)? Ini memengaruhi N17–N21.
7. **Payment gateway (tahap 2).** Penyedia mana, dan metode apa saja (virtual account, QRIS, e-wallet, kartu)? Siapa yang menanggung biaya transaksinya?
8. **Bila menjadi PKP.** Bila nanti usaha menjadi PKP, faktur pajak dan PPN perlu spesifikasi tambahan.
9. **Syarat dan ketentuan.** Siapa yang menyiapkan teks syarat & ketentuan serta kebijakan privasi (F12.4)? Apakah perlu ditinjau ahli hukum?
10. **Batas pembelian lisensi.** Apakah satu pembeli boleh membeli beberapa unit produk berlisensi dalam satu pesanan (mendapat beberapa kode)?
