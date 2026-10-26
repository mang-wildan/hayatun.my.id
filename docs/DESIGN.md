# Design System: Hayatun

Versi 1.0 · 2026-10-26 · Status: draf, menunggu persetujuan pemilik
Pasangan dokumen: [`SPEC.md`](SPEC.md). Bila ada yang bertentangan, SPEC yang berlaku.

Dokumen ini menjelaskan **tampilan dan perilaku** toko Hayatun dan panel adminnya. Pilihan teknologi diserahkan ke pembangun. Tanda **[usulan]** berarti keputusan penyusun yang belum dikonfirmasi pemilik.

---

## 1. Tema visual dan suasana

Toko kecil yang hangat, rapi, dan bisa dipercaya. Kesannya **feminin dan bersahabat**, tapi jelas dan tidak ramai, seperti etalase butik yang tertata, bukan pasar.

Prinsip utama: **begitu dibuka, pembeli langsung tahu ini toko apa dan apa saja yang dijual.** Konten (produk) tampil lebih dulu daripada hiasan. Tidak ada banner besar yang menghabiskan layar pertama, dan tidak ada slider promosi.

| Kenop | Nilai | Artinya |
|-------|-------|---------|
| Kepadatan | 4 dari 10 | Seimbang. Lega di toko, sedikit lebih padat di panel admin. |
| Variasi tata letak | 3 dari 10 | Teratur dan mudah ditebak. Ini toko tempat orang mentransfer uang, jadi kejelasan lebih penting daripada kejutan. |
| Gerakan | 2 dari 10 | Tenang. Hanya transisi singkat sebagai umpan balik, tanpa animasi yang terus berjalan. |

Nilai ini sengaja lebih rendah dari bawaan gaya "taste" (variasi 8, gerakan 6), karena toko harus terasa tenang dan bisa dipercaya, dan harus memenuhi aturan aksesibilitas di SPEC (N12–N16).

**Satu aplikasi web yang menyesuaikan diri** dengan HP, tablet, laptop, dan PC. Tidak ada versi terpisah per perangkat.

---

## 2. Palet warna dan perannya

Latar pink pucat, tombol hijau tua (pilihan "C" dari wawancara). Semua warna dipakai lewat **token bernama**, tidak pernah lewat kode warna langsung di komponen, agar mode gelap bisa ditambah nanti tanpa membongkar desain.

### Warna dasar

| Token | Nama | Hex | Peran |
|-------|------|-----|-------|
| `canvas` | Blush Pucat | `#FDF2F8` | Latar halaman toko |
| `surface` | Putih Bersih | `#FFFFFF` | Kartu, panel, kolom isian, bar atas |
| `canvas-admin` | Abu Kabut | `#FAFAF9` | Latar halaman panel admin (lebih netral untuk kerja lama) **[usulan]** |
| `ink` | Arang | `#18181B` | Teks utama |
| `ink-soft` | Abu Batu | `#52525B` | Teks kedua: deskripsi, keterangan, label tabel |
| `line` | Garis Mawar | `#FBCFE8` | Garis pemisah dan tepi kartu (hiasan saja) |
| `line-strong` | Garis Tegas | `#71717A` | Tepi kolom isian, kotak centang, dan kontrol lain yang wajib terlihat |

### Warna merek dan aksi

| Token | Nama | Hex | Peran |
|-------|------|-----|-------|
| `brand` | Rose Tua | `#9D174D` | Nama toko "Hayatun", label jenis produk (E-BOOK, FISIK), tautan teks |
| `brand-tint` | Rose Lembut | `#FCE7F3` | Latar bingkai sampul produk, sorotan halus |
| `action` | Hijau Daun Tua | `#166534` | Tombol utama, pilihan aktif, cincin fokus. **Satu-satunya warna aksi.** |
| `action-pressed` | Hijau Hutan | `#14532D` | Tombol utama saat ditekan |

### Warna status (hanya untuk menyampaikan makna)

| Token | Teks | Latar | Dipakai untuk |
|-------|------|-------|---------------|
| `ok` | `#166534` | `#DCFCE7` | Lunas, Terkirim, Diterima, berhasil disimpan |
| `wait` | `#92400E` | `#FEF3C7` | Menunggu Verifikasi, Lisensi tertunda, stok rendah |
| `danger` | `#991B1B` | `#FEE2E2` | Bukti ditolak, error, tombol "Tolak" (teks `#B91C1C` di atas putih) |
| `neutral` | `#3F3F46` | `#F4F4F5` | Menunggu Pembayaran, Diproses, Dikirim, Kedaluwarsa, Dibatalkan |

### Kontras yang sudah diperiksa (WCAG 2.1 AA)

| Pasangan | Rasio | Syarat |
|----------|-------|--------|
| `ink` di `canvas` | 16,2:1 | ≥ 4,5 |
| `ink-soft` di `canvas` / `surface` | 7,1 / 7,7:1 | ≥ 4,5 |
| `brand` di `canvas` / `surface` | 7,2 / 7,9:1 | ≥ 4,5 |
| Teks putih di `action` | 7,1:1 | ≥ 4,5 |
| `action` (cincin fokus) di `canvas` | 6,5:1 | ≥ 3 |
| `line-strong` (tepi isian) di `surface` | 4,8:1 | ≥ 3 |
| Teks status di latarnya: ok / wait / danger / neutral | 6,5 / 6,4 / 6,8 / 9,5:1 | ≥ 4,5 |
| `danger` `#B91C1C` di `surface` | 6,5:1 | ≥ 4,5 |

**Aturan warna**

- Hanya **satu warna aksi** (hijau). Pink tidak pernah dipakai untuk tombol.
- `line` (`#FBCFE8`) hanya untuk hiasan. Tepi kontrol yang wajib terlihat memakai `line-strong`.
- **Status tidak pernah disampaikan lewat warna saja**: selalu ada teks label dan ikon.
- Tidak ada hitam pekat `#000000`, gradien, atau bayangan bercahaya (glow).

---

## 3. Tipografi

| Peran | Huruf | Aturan |
|-------|-------|--------|
| Semua teks (toko dan admin) | **Outfit** (400, 500, 600, 700) | Bulat dan ramah. Hierarki lewat ketebalan dan warna, bukan ukuran raksasa. |
| Kode dan nomor | **JetBrains Mono** (400, 500) | Nomor invoice, kode lisensi, nomor resi, nomor rekening. Supaya 0/O dan 1/l tidak tertukar. **[usulan]** |
| Angka harga dan total di tabel | Outfit dengan angka selebar sama (tabular) | Supaya kolom angka lurus. |

### Skala ukuran

| Gaya | Ukuran | Tebal | Tinggi baris | Pemakaian |
|------|--------|-------|--------------|-----------|
| Merek | 22 px | 700 | 1,2 | "Hayatun" di bar atas, rose tua, jarak huruf −0,02em |
| Judul 1 | `clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)` (24–36 px) | 600 | 1,2 | Judul halaman, kalimat pembuka beranda |
| Judul 2 | 20 px | 600 | 1,3 | Judul bagian: "Digital", "Fisik", "Ringkasan pesanan" |
| Judul 3 | 18 px | 600 | 1,4 | Nama produk di halaman detail, judul kartu admin |
| Isi | **16 px** | 400 | 1,5 | Semua teks isi. Batas minimum isi di SPEC N13. |
| Label | 16 px | 500 | 1,4 | Label kolom isian, tombol |
| Kecil | 14 px | 500 | 1,4 | Hanya untuk keterangan pendek: label jenis produk (huruf kapital, jarak +0,04em), waktu, teks bantu |

- Lebar baris teks maksimal **65 karakter**.
- Teks tidak boleh lebih kecil dari 14 px di mana pun.
- Pengguna boleh memperbesar teks hingga 200% tanpa ada isi yang terpotong atau tumpang tindih. Zoom browser tidak boleh dimatikan.
- **Dilarang**: Inter, huruf berkait (serif) apa pun, huruf sambung atau dekoratif.

---

## 4. Gaya bahasa

Akrab dan santai, menyapa pembeli dengan **"kamu"**.

| Tempat | Contoh |
|--------|--------|
| Tombol | "Masukkan ke keranjang", "Lanjut bayar", "Upload bukti bayar" |
| Error | "Fotonya kebesaran nih, maksimal 5 MB ya. Coba kecilkan dulu." |
| Keadaan kosong | "Keranjangmu masih kosong. Yuk lihat produk Hayatun." |
| Bukti ditolak | "Bukti bayarmu belum bisa kami terima: *<alasan admin>*. Kamu masih bisa upload ulang sampai *<jam, tanggal>*." |
| Admin | Santai tapi lebih ringkas: "3 bukti menunggu dicek", "Resi tersimpan". |

- **Dokumen invoice tetap netral**, tanpa sapaan dan tanpa bahasa santai, karena invoice adalah catatan resmi untuk pembukuan.
- Setiap pesan error menyebut **apa yang terjadi** dan **apa yang bisa dilakukan** (SPEC N10).
- Tombol memakai kata kerja yang menyebut hasilnya, bukan "OK" atau "Submit".
- Tanggal dan jam: "26 Okt 2026, 14.30 WIB". Uang: "Rp150.000" (titik sebagai pemisah ribuan, tanpa desimal).
- **Dilarang**: emoji, klise iklan ("elevate", "seamless", "solusi terbaik", "next-gen"), dan data atau angka karangan (misalnya "1.000+ pembeli puas") selama datanya belum benar-benar ada.

---

## 5. Gaya komponen

Ukuran dasar: jarak kelipatan **4 px** (4, 8, 12, 16, 24, 32, 48, 64). Lengkungan sudut: kartu **16 px**, tombol dan kolom isian **12 px**, label status bulat penuh. Bayangan hampir tidak dipakai; pemisahan memakai garis tepi dan jarak.

**Tombol**
- *Utama*: latar `action`, teks putih 16 px tebal 600, tinggi minimal **48 px**, lengkungan 12 px. Saat ditekan berubah ke `action-pressed` dan turun 1 px. Hanya **satu tombol utama** per layar atau per kartu.
- *Kedua*: latar `surface`, garis tepi `line-strong`, teks `ink`.
- *Bahaya* (misalnya "Tolak", "Batalkan pesanan"): latar `surface`, garis tepi dan teks `#B91C1C`. Selalu meminta konfirmasi.
- *Sedang memproses*: label berganti (misalnya "Menyimpan…"), tombol tidak bisa ditekan dua kali, lebar tombol tidak berubah.
- *Tidak aktif*: tetap terbaca (kontras teks ≥ 4,5:1) dan disertai alasan di dekatnya, misalnya "Ongkir belum bisa dihitung".
- Tidak ada glow, gradien, atau kursor khusus.

**Kolom isian**
- Label selalu terlihat **di atas** kolom. Placeholder bukan pengganti label.
- Tinggi minimal 48 px, tepi `line-strong` 1 px, latar `surface`.
- Teks bantu (opsional) di bawah label. Pesan error tampil **tepat di bawah kolom**, berwarna `#B91C1C`, dengan ikon, dan dibacakan pembaca layar.
- Kolom yang bermasalah mendapat tepi `#B91C1C` 2 px.
- Jenis papan ketik sesuai isinya: angka untuk nomor HP dan kode pos, email untuk email.

**Cincin fokus**: garis `action` 2 px dengan jarak 2 px dari elemen, selalu terlihat saat memakai keyboard. Tidak pernah dihilangkan.

**Kartu produk**
- Latar `surface`, tepi `line`, lengkungan 16 px.
- Sampul dalam bingkai **4:5**, ditampilkan utuh **tanpa dipotong**, sisa ruang berlatar `brand-tint`. **[usulan]**
- Di bawah sampul: label jenis produk (Kecil, `brand`), nama produk (maks. 2 baris, lalu dipotong dengan "…"), dan harga (`ink`, tebal 500).
- Produk habis: sampul sedikit pudar, ada label status `neutral` "Habis", dan tidak ada tombol beli.
- Seluruh kartu bisa diketuk untuk membuka detail produk.

**Label status**: bentuk pil, teks 14 px tebal 600, warna sesuai token status, selalu dengan ikon kecil di kiri dan teks yang jelas (misalnya "Menunggu verifikasi", bukan hanya titik kuning).

**Unggah bukti bayar**
- Area unggah besar (tinggi minimal 160 px) dengan tepi putus-putus `line-strong`. Di HP bisa membuka kamera atau galeri.
- Setelah dipilih: tampil pratinjau gambar, nama file, ukuran, tombol "Ganti", dan tombol utama "Upload bukti bayar".
- Batas waktu bayar selalu terlihat di dekatnya: "Upload sebelum 27 Okt 2026, 14.30 WIB".

**Nomor yang perlu disalin** (nomor rekening, total transfer, kode lisensi, nomor resi): huruf JetBrains Mono, dengan tombol "Salin" di sampingnya. Setelah disalin, label tombol berubah menjadi "Tersalin" selama 2 detik.

**Pemberitahuan singkat** (misalnya "Resi tersimpan"): muncul di bagian bawah layar selama 4 detik, tidak menutupi tombol utama, dan dibacakan pembaca layar. Error penting **tidak** memakai pemberitahuan singkat; error ditampilkan di tempatnya dan tetap terlihat.

**Memuat**: kerangka abu-abu muda dengan ukuran sama seperti isi aslinya, supaya tata letak tidak bergeser. Tidak memakai lingkaran berputar untuk memuat halaman.

**Keadaan kosong**: kalimat singkat yang menjelaskan keadaannya dan satu aksi berikutnya. Contoh di admin: "Belum ada bukti yang perlu dicek. Bukti baru akan muncul di sini."

**Ikon**: satu set ikon bergaris yang konsisten, ukuran 20–24 px, tebal garis 1,5–2 px, warna mengikuti teks. Ikon di navigasi selalu disertai label teks. Ikon tanpa teks wajib punya label untuk pembaca layar. Tidak pernah memakai emoji sebagai ikon.

**Konfirmasi** (misalnya tolak bukti, batalkan pesanan, nonaktifkan admin): dialog dengan judul yang menyebut aksinya ("Tolak bukti bayar INV/2026/10/0001?"), tombol bahaya di kanan dan "Batal" di kiri, fokus keyboard terkunci di dalam dialog, dan bisa ditutup dengan tombol Esc.

---

## 6. Tata letak dan responsif

### Titik patah

| Nama | Lebar layar | Perangkat |
|------|-------------|-----------|
| HP | 360–767 px | Semua tata letak satu kolom, kecuali kisi produk |
| Tablet | 768–1023 px | Dua kolom bila perlu |
| Laptop/PC | ≥ 1024 px | Isi dibatasi lebar maksimal **1200 px** di tengah, dengan jarak samping minimal 16 px (HP) hingga 32 px (PC) |

Aturan umum:
- Dirancang mulai dari HP, lalu diperluas.
- **Tidak boleh ada gulir ke samping** di lebar 360 px (SPEC N11), kecuali di dalam tabel admin yang sengaja bisa digeser.
- Semua area sentuh minimal **44 × 44 px**, dengan jarak antar-area minimal 8 px.
- Jarak antarbagian vertikal: `clamp(2rem, 6vw, 4rem)`.
- Area penting tidak boleh tertutup notch atau bilah sistem HP.
- Ruang gambar dipesan sebelum gambar dimuat, supaya isi tidak melompat.

### Toko (pembeli)

**Bar atas** (semua ukuran): "Hayatun" di kiri; ikon keranjang dengan jumlah barang dan ikon akun di kanan. Di tablet dan PC ditambah tautan teks "Produk" dan "Pesanan saya". **Tidak ada menu hamburger**, karena halamannya sedikit.

**Beranda / katalog**
- Bagian atas: satu kalimat jelas tentang apa yang dijual, misalnya "E-book, template, aplikasi, dan produk pilihan dari Hayatun". Tidak ada gambar besar yang mendorong produk ke bawah.
- Langsung di bawahnya: semua produk (sekitar 10), dikelompokkan dengan judul **Digital** dan **Fisik**. Bisa juga disaring dengan dua tombol pil "Digital" / "Fisik".
- Kisi produk: **2 kolom di HP, 3 di tablet, 4 di PC**. **[usulan]**
- Di HP 360 px, minimal satu baris kartu produk sudah terlihat tanpa menggulir.

**Detail produk**
- HP: sampul di atas, lalu label jenis, nama, harga, tombol utama "Masukkan ke keranjang", dan deskripsi.
- Tablet dan PC: dua kolom, sampul di kiri (sekitar 55%) dan informasi serta tombol di kanan (sekitar 45%).
- Di HP, tombol "Masukkan ke keranjang" menempel di bagian bawah layar saat menggulir deskripsi panjang.
- Isi tambahan per jenis produk masih menjadi pertanyaan terbuka (lihat bagian 9).

**Keranjang dan checkout**
- HP: satu kolom. Ringkasan total dan tombol "Lanjut bayar" menempel di bawah layar.
- PC: dua kolom, daftar item dan isian di kiri, ringkasan pesanan menempel di kanan.
- Langkah checkout terlihat jelas di bagian atas: **Keranjang → Pengiriman** (hanya bila ada produk fisik) **→ Bayar**. Maksimal 5 layar sampai instruksi bayar (SPEC N8).
- Pilihan ongkir tampil sebagai daftar pilihan berisi nama layanan, perkiraan lama kirim, dan harga.

**Instruksi bayar dan unggah bukti**
- Urutan dari atas: batas waktu, total transfer (bisa disalin), rekening tujuan (bank, nomor yang bisa disalin, atas nama), area unggah bukti.
- Sisa waktu ditulis sebagai jam dan tanggal batas yang jelas, bukan hitung mundur yang terus bergerak.

**Pesanan saya dan detail pesanan**
- Daftar pesanan sebagai kartu: nomor invoice, tanggal, total, dan label status.
- Detail pesanan memakai **garis waktu vertikal** status (Menunggu Pembayaran → … → Lunas → Terkirim/Dikirim/Diterima). Pesanan campuran menampilkan bagian **Digital** dan **Fisik** terpisah, masing-masing dengan statusnya.
- Bagian digital: tombol "Unduh" per file dan kode lisensi yang bisa disalin.
- Bagian fisik: nama ekspedisi, nomor resi yang bisa disalin, dan tombol "Pesanan diterima".
- Tombol "Lihat invoice" selalu ada.

**Invoice**
- Tampil sebagai dokumen bersih di atas `surface`, lebar maksimal 800 px, siap dicetak dan diunduh.
- Versi cetak: latar putih, tanpa bar atas dan tombol, teks hitam arang, nama toko tetap rose tua.

**Akun**: profil, alamat, ubah password, verifikasi dua langkah, dan "Hapus akun" (tombol bahaya, dengan penjelasan apa yang dihapus dan apa yang disimpan 10 tahun).

### Panel admin

Latar `canvas-admin` (netral), komponen dan warna aksi sama dengan toko.

**Navigasi**
- HP: **navigasi bawah** dengan 4 tombol berlabel: **Verifikasi** (dengan angka antrean), **Pesanan**, **Produk**, **Lainnya**. "Lainnya" berisi Pengiriman, Admin, Log aktivitas, dan Pengaturan toko.
- Tablet: navigasi bawah yang sama.
- Laptop/PC: **menu samping kiri** yang tetap terlihat (lebar sekitar 240 px) dengan menu yang sama.

**Daftar pesanan dan antrean verifikasi**
- HP: kartu bertumpuk berisi nomor invoice, nama pembeli, total, label status, dan **satu tombol aksi utama** (misalnya "Periksa bukti").
- Tablet: kartu dua kolom.
- Laptop/PC: tabel dengan kolom yang bisa diurutkan dan disaring. Baris tabel bisa diklik.

**Memeriksa bukti bayar** (target SPEC N9: ≤ 1 menit, ≤ 3 klik)
- HP: foto bukti tampil **layar penuh dan bisa di-zoom**. Total yang harus dibayar dan rekening tujuan terlihat di atasnya. Tombol **Terima** (utama) dan **Tolak** (bahaya) selalu terlihat di bagian bawah layar.
- Laptop/PC: **panel samping** di kanan berisi foto bukti, rincian pesanan, dan tombol Terima/Tolak, sehingga daftar tetap terlihat di kiri dan admin bisa lanjut ke bukti berikutnya.
- "Tolak" membuka kolom alasan yang wajib diisi, dengan beberapa alasan siap pakai ("Nominal kurang", "Foto tidak terbaca", "Transfer tidak ditemukan") yang tetap bisa diubah.

**Produk**: daftar produk dengan stok tersedia, ditahan, dan terjual. Stok rendah ditandai dengan label `wait`. Formulir produk satu kolom di semua ukuran layar.

---

## 7. Gerakan dan interaksi

- Hanya **transisi singkat**: 150–250 ms untuk tombol, panel, dan dialog; perlambatan halus di akhir gerakan, bukan gerakan linear.
- Menutup lebih cepat daripada membuka (sekitar 150 ms berbanding 250 ms).
- Hanya menggerakkan **posisi dan transparansi**. Lebar, tinggi, dan posisi tata letak tidak dianimasikan.
- **Tidak ada animasi yang berjalan terus-menerus**: tidak ada denyut, melayang, mesin ketik, atau efek kilau dekoratif. Satu-satunya pengecualian adalah kilau tipis pada kerangka memuat.
- Saat perangkat disetel **"kurangi gerakan"**, semua transisi menjadi instan dan kilau kerangka memuat berhenti (SPEC N16).
- Perubahan status penting (misalnya pesanan menjadi Lunas) diumumkan ke pembaca layar, tidak hanya lewat animasi.
- Setiap tindakan yang lebih lama dari 300 ms menampilkan umpan balik (tombol berganti label atau kerangka memuat).

---

## 8. Larangan

1. Emoji di mana pun, termasuk sebagai ikon.
2. Huruf Inter, huruf berkait (serif), atau huruf dekoratif.
3. Hitam pekat `#000000`.
4. Pink sebagai warna tombol; lebih dari satu warna aksi.
5. Gradien, bayangan bercahaya (glow), atau warna neon.
6. Banner raksasa, slider promosi, atau gambar pembuka yang menutupi produk di layar pertama.
7. Teks pengisi seperti "Scroll untuk melihat", panah memantul, atau ajakan menggulir.
8. Elemen yang saling tumpang tindih; teks di atas foto.
9. Status yang hanya disampaikan lewat warna.
10. Placeholder sebagai pengganti label.
11. Menghilangkan cincin fokus.
12. Menu hamburger di toko.
13. Hitung mundur yang terus bergerak untuk batas bayar.
14. Lingkaran berputar untuk memuat halaman.
15. Animasi yang berjalan terus-menerus.
16. Nama contoh generik ("John Doe", "Toko ABC") dan angka atau testimoni karangan di desain maupun tampilan akhir.
17. Klise iklan ("elevate", "seamless", "solusi terbaik", "next-gen").
18. Gulir ke samping di HP (kecuali di dalam tabel admin).
19. Mematikan zoom browser.
20. Kursor mouse khusus.

---

## 9. Asumsi dan pertanyaan terbuka

### Asumsi (keputusan penyusun, silakan koreksi)

| # | Asumsi |
|---|--------|
| D1 | Latar panel admin netral (`#FAFAF9`), bukan pink pucat, supaya nyaman untuk kerja lama. |
| D2 | Kode, nomor invoice, nomor resi, dan nomor rekening memakai JetBrains Mono. |
| D3 | Sampul produk ditampilkan utuh dalam bingkai 4:5 tanpa dipotong. |
| D4 | Kisi produk 2 / 3 / 4 kolom untuk HP / tablet / PC. |
| D5 | Detail produk di HP punya tombol beli yang menempel di bawah layar. |
| D6 | Admin di tablet memakai navigasi bawah seperti di HP. |
| D7 | Alasan penolakan bukti punya pilihan siap pakai yang tetap bisa diubah. |

### Pertanyaan terbuka

1. **Logo.** Logo belum ada. Sampai ada, "Hayatun" ditulis dengan Outfit 700 berwarna rose tua sebagai logo teks. Apakah logo nanti juga harus bisa tampil kecil (misalnya 32 px untuk ikon tab browser)?
2. **Isi halaman detail produk.** Selain foto, nama, harga, dan deskripsi, apa yang perlu ditampilkan per jenis produk? Misalnya contoh halaman e-book, tangkapan layar atau tautan demo aplikasi, isi paket template, atau ukuran dan berat barang fisik.
3. **Foto produk.** Berapa foto per produk (satu sampul atau beberapa foto)? Bila beberapa, halaman detail perlu galeri.
4. **Kalimat pembuka beranda.** Teks final untuk kalimat di bagian atas beranda.
5. **Halaman legal.** Tampilan halaman kebijakan privasi serta syarat dan ketentuan mengikuti gaya Invoice (dokumen bersih), tapi teksnya belum ada (SPEC, pertanyaan terbuka 9).
