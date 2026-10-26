# ARCHITECTURE — Toko Hayatun

Versi 1.0 · 2026-10-26 · Status: draf, menunggu persetujuan pemilik
Dokumen terkait: [`SPEC.md`](SPEC.md) (apa yang dibangun: F#, N#) · [`DESIGN.md`](DESIGN.md) (tampilan)

Pemilik memilih **Opsi B**: satu repo, Next.js dan Express sebagai dua proses di satu server, satu domain. Server yang dipakai adalah server milik pemilik sendiri (CentOS Stream 9, aaPanel, Nginx).

---

## 1. Gambaran

```
                 Internet (HTTPS)
                        │
              ┌─────────▼──────────┐
              │ Nginx (aaPanel)    │  TLS, header keamanan, batas ukuran unggah,
              │ hayatun.id         │  batas laju, file statis
              └──┬─────────────┬───┘
     /api/*      │             │      semua path lain
        ┌────────▼───┐     ┌───▼──────────┐
        │ Express 5  │◀────│ Next.js 16   │  halaman toko dan panel admin
        │ apps/api   │ HTTP│ apps/web     │  (mengambil data dari API lewat
        │ 127.0.0.1  │lokal│ 127.0.0.1    │   jaringan lokal)
        │ :4000      │     │ :3000        │
        └──┬──────┬──┘     └──────────────┘
           │      │
   ┌───────▼──┐ ┌─▼──────────────────┐     Layanan luar:
   │PostgreSQL│ │ Disk privat         │     · email transaksional (SMTP)
   │ (lokal)  │ │ /srv/hayatun/files  │     · tarif ongkir (penyedia belum dipilih)
   │ data +   │ │ produk digital +    │     · payment gateway (tahap 2)
   │ antrean  │ │ bukti bayar (enkrip)│     · penyimpanan cadangan di luar server
   │ tugas    │ └────────────────────┘     · pemantau uptime dari luar
   └──────────┘
```

**Pembagian tugas**
- **Express (`apps/api`)** memegang **seluruh logika bisnis dan semua akses data**: autentikasi, otorisasi, perubahan status pesanan, stok, enkripsi, file, email, dan tugas terjadwal. Ini satu-satunya proses yang tersambung ke database dan disk privat.
- **Next.js (`apps/web`)** hanya menampilkan halaman (toko dan admin). Halaman diambil di server Next.js dengan memanggil Express lewat `127.0.0.1`, meneruskan cookie sesi pengguna. Formulir dan tombol di browser memanggil `/api/*` di domain yang sama, yang diteruskan Nginx ke Express.
- **Nginx** menjadi satu-satunya pintu masuk dari internet. Next.js dan Express hanya mendengarkan di `127.0.0.1`.

Skala yang dirancang: sekitar 240 pesanan dan 100 produk per bulan (10 kali target tahun pertama, SPEC bagian 1). Satu server cukup.

---

## 2. Stack dan alasan

| Bagian | Pilihan | Alasan |
|--------|---------|--------|
| Sistem operasi | CentOS Stream 9 (sudah ada) | Server milik pemilik. **Dukungan berakhir 31 Mei 2027**, lihat K10 dan Batasan. |
| Panel server | aaPanel (sudah ada) | Mengelola Nginx, sertifikat TLS, dan proses Node yang sudah dikenal pemilik. Akses panel wajib dikunci (bagian 6). |
| Web server | Nginx (dari aaPanel) | Reverse proxy, TLS, batas unggah, dan pengiriman file privat yang efisien (`X-Accel-Redirect`). |
| Runtime | Node.js 24 LTS | Versi LTS aktif. Memenuhi syarat minimum Next.js 16. |
| Bahasa | TypeScript (mode strict) di semua paket | Satu definisi tipe untuk API dan halaman. |
| Tampilan | **Next.js 16.4.x** (App Router) + React | Permintaan pemilik. Render di server membantu halaman katalog cepat tampil (N17). |
| API | **Express 5.3.x** | Permintaan pemilik. Express 5 menangani error dari fungsi async secara bawaan. |
| Validasi | Zod, di `packages/shared` | Skema yang sama dipakai formulir (pesan error santai, DESIGN bagian 4) dan API (pemeriksaan wajib di server). |
| Database | PostgreSQL 16 di server yang sama | Transaksi dan penguncian baris (`SELECT … FOR UPDATE`, `SKIP LOCKED`) agar stok dan kode lisensi tidak terjual dua kali (N24). |
| Akses database | Drizzle ORM + drizzle-kit (migrasi) | Query bertipe, mendukung penguncian baris secara langsung, dan migrasi berupa file SQL yang bisa dibaca. |
| Tugas terjadwal | pg-boss (antrean di PostgreSQL) | Kedaluwarsa 24 jam, pengingat, retry email, dan hapus bukti 1 tahun tanpa menambah Redis (N25). |
| File | Disk lokal privat di luar folder web | Hanya sekitar 100 produk; disk lokal lebih sederhana dan tanpa biaya. Lihat K4. |
| Email | Nodemailer lewat SMTP ke penyedia email transaksional | Penyedia bisa diganti hanya lewat konfigurasi. |
| Password | Argon2id | Algoritma yang dirancang untuk password (N3). |
| Verifikasi dua langkah | TOTP (aplikasi authenticator) | F1.4, F15.2. |
| Log | Pino (JSON) dengan penyamaran field sensitif | N30. |
| Proses | PM2 (pengelola proyek Node di aaPanel) | Menjalankan ulang proses yang mati, reload saat deploy. |
| Monorepo | npm workspaces | Sudah bawaan npm, tanpa alat tambahan. |
| Tes | Vitest, Supertest, Playwright + axe | Bagian 7. |
| CI | GitHub Actions **[usulan]** | Bagian 7. Bila repo disimpan di tempat lain, alurnya dipindah ke CI tempat itu. |

**Yang sengaja tidak dipakai**: Redis, Docker/Kubernetes, layanan mikro, layanan pencarian, CDN berbayar, dan generator PDF di server. Untuk skala ini semuanya menambah perawatan tanpa manfaat yang terasa.

### Struktur repo

```
hayatun/
├─ apps/
│  ├─ web/          Next.js: halaman toko dan panel admin
│  └─ api/          Express: modul bisnis, database, tugas terjadwal
├─ packages/
│  └─ shared/       Skema Zod, enum status, label status Bahasa Indonesia, format Rupiah/tanggal
├─ ops/             Contoh konfigurasi Nginx, PM2, logrotate, skrip cadangan dan pulih
└─ docs/            SPEC, DESIGN, ARCHITECTURE, panduan operasi (N35)
```

---

## 3. Modul

Semua modul bisnis ada di `apps/api/src/modules/<nama>`. Setiap modul berisi rute, validasi, logika, dan query-nya sendiri. Modul memanggil modul lain lewat fungsi yang diekspor, tidak lewat HTTP.

| Modul | Tanggung jawab | Fitur SPEC |
|-------|----------------|------------|
| `auth` | Daftar, verifikasi email, login, logout, reset password, sesi, verifikasi dua langkah, pembatasan percobaan login | F1.1–F1.4, F1.6–F1.8, F15.2 |
| `catalog` | Daftar dan detail produk aktif, status ketersediaan | F2 |
| `products` (admin) | Kelola produk, foto sampul, file digital, stok, kode lisensi massal, peringatan stok rendah | F9 |
| `cart` | Keranjang per akun, tanda item nonaktif atau habis | F2.4, F3.1 |
| `checkout` | Hitung total, kunci harga, tahan stok fisik dan kode lisensi, buat pesanan dan invoice | F3.3–F3.5, F3.8, F3.9 |
| `shipping` | Adaptor penyedia tarif ongkir, batas waktu 5 detik, pilihan layanan | F3.2, F3.6, F3.7 |
| `orders` | **Mesin status pesanan** (satu-satunya tempat status boleh berubah), riwayat pesanan pembeli, pembatalan oleh pembeli | Diagram status SPEC bagian 3, F4.6 |
| `payments-manual` | Instruksi transfer, unggah bukti, verifikasi (terima/tolak), tambahan waktu setelah ditolak | F4, F5 |
| `invoices` | Penomoran berurutan per bulan, data invoice, halaman siap cetak | F6 |
| `fulfillment-digital` | Penetapan kode lisensi, token unduhan 15 menit, pencabutan akses, lisensi tertunda | F7 |
| `fulfillment-physical` | Antrean kirim, isi atau ubah resi, konfirmasi diterima | F8 |
| `admin-orders` | Daftar dan filter pesanan, pembatalan/pengembalian oleh admin, ringkasan bulanan | F10, F13.1, F13.2 |
| `settings` | Nama toko, kontak, rekening tujuan, email peringatan saat rekening diubah | F13.3, F15.7 |
| `admins` | Undang dan nonaktifkan admin, cegah admin terakhir menonaktifkan diri | F15.1, F15.5, F15.6 |
| `audit` | Mencatat tindakan admin dan setiap pembukaan data pribadi atau bukti bayar | F15.3, F15.4, N28 |
| `privacy` | Hapus akun (anonimkan), tunda bila ada pesanan aktif, data halaman kebijakan privasi | F1.5, F12 |
| `notifications` | Templat email (bahasa santai, DESIGN bagian 4), antrean kirim dan retry | F11 |
| `jobs` | Penjadwal: kedaluwarsa pesanan, pengingat 3 jam, Diterima otomatis 14 hari, hapus bukti 1 tahun, proses hapus akun | F4.4, F4.5, F8.3, F12.2, F12.3, N25 |
| `crypto` | Enkripsi field, blind index email, rotasi kunci | F12.1, N2 |
| `storage` | Simpan, baca, dan hapus file di disk privat; pemeriksaan jenis file dari isinya | F4.3, F4.7, F7, N5 |
| `gateway` | **Tahap 2.** Buat transaksi, terima dan verifikasi webhook, idempoten | F14 |

**Halaman Next.js (`apps/web/app`)**, mengikuti DESIGN bagian 6:

| Kelompok | Halaman | Fitur |
|----------|---------|-------|
| Toko | Beranda/katalog, detail produk, keranjang, checkout (pengiriman, bayar), instruksi bayar dan unggah bukti | F2, F3, F4 |
| Akun | Daftar, login, verifikasi email, reset password, pesanan saya, detail pesanan (unduh, lisensi, resi), invoice, profil, alamat, keamanan, hapus akun | F1, F6, F7, F8, F12 |
| Admin | Verifikasi, pesanan, pengiriman, produk, admin, log aktivitas, pengaturan toko | F5, F8, F9, F10, F13, F15 |
| Legal | Kebijakan privasi, syarat dan ketentuan | F12.4 |

---

## 4. Data model

Semua waktu disimpan dalam UTC dan ditampilkan dalam WIB. Semua uang disimpan sebagai **bilangan bulat Rupiah** (tanpa desimal). Kolom berakhiran `_enc` berisi data terenkripsi (K5). Kunci utama memakai UUID, kecuali disebut lain.

```
users ─┬─< sessions
       ├─< auth_tokens
       ├─< addresses
       ├─< cart_items >── products ─┬─< product_files
       ├─< orders ─┬─< order_items ─┘   └─< license_codes
       │           ├─< payment_proofs
       │           └─< payment_events (tahap 2)
       └─< audit_logs (sebagai pelaku)
invoice_counters · store_settings · pgboss.* (antrean tugas)
```

| Tabel | Kolom penting | Catatan |
|-------|---------------|---------|
| `users` | `role` (buyer/admin), `email_enc`, `email_index` (unik), `name_enc`, `phone_enc`, `password_hash`, `email_verified_at`, `totp_secret_enc`, `totp_enabled`, `status` (active/disabled/deleted), `deleted_at` | `email_index` = HMAC email yang dinormalisasi, untuk login dan cek duplikat tanpa membuka enkripsi. |
| `sessions` | `id_hash`, `user_id`, `created_at`, `last_seen_at`, `expires_at` | Sesi di server. Cookie hanya berisi ID acak; yang disimpan hanya hash-nya. Admin habis setelah 30 menit tidak aktif, pembeli 30 hari (N4). |
| `auth_tokens` | `type` (verify/reset/admin_invite), `token_hash`, `user_id`, `expires_at`, `used_at` | Sekali pakai (F1.3, F1.7). |
| `login_attempts` | `email_index`, `attempted_at`, `success` | Untuk F1.8. Dibersihkan setelah 1 hari. |
| `addresses` | `user_id`, `recipient_enc`, `phone_enc`, `address_enc`, `area_id`, `postal_code` | `area_id` dan `postal_code` tidak dienkripsi karena hanya ini yang dikirim ke penyedia ongkir (N27). |
| `products` | `slug`, `name`, `description`, `type` (digital/physical), `price`, `weight_g`, `stock_qty`, `stock_reserved`, `is_licensed`, `cover_path`, `active` | Tidak pernah dihapus permanen bila sudah pernah dipesan (F9.9). Batasan: `weight_g > 0` untuk fisik (F9.6). |
| `product_files` | `product_id`, `kind` (file/link), `storage_key` atau `url`, `filename`, `size_bytes` | |
| `license_codes` | `product_id`, `code_enc`, `code_index`, `status` (available/reserved/assigned), `order_item_id`, `assigned_at` | Unik pada (`product_id`, `code_index`) untuk menolak duplikat (F9.7). |
| `cart_items` | `user_id`, `product_id`, `qty` | |
| `orders` | `invoice_number` (unik), `user_id`, `status`, `digital_status`, `physical_status`, `payment_method` (manual/gateway), `subtotal`, `shipping_cost`, `total`, `expires_at`, `paid_at`, `verified_by`, `cancel_note`, `ship_recipient_enc`, `ship_phone_enc`, `ship_address_enc`, `ship_area_id`, `courier`, `courier_service`, `tracking_number`, `shipped_at`, `received_at` | Alamat disalin ke pesanan saat checkout supaya invoice lama tidak berubah. |
| `order_items` | `order_id`, `product_id`, `product_type`, `name_snapshot`, `unit_price`, `qty` | Harga dikunci saat checkout (F3.4, F9.8). |
| `payment_proofs` | `order_id`, `storage_key`, `mime`, `size_bytes`, `uploaded_at`, `status` (pending/accepted/rejected), `reject_reason`, `reviewed_by`, `reviewed_at`, `file_deleted_at` | File dihapus setelah 1 tahun; barisnya tetap ada sebagai catatan (F12.3). |
| `invoice_counters` | `period` (YYYYMM, kunci utama), `last_number` | Dikunci per baris saat membuat nomor, sehingga berurutan dan tidak dipakai ulang (F6.1). |
| `store_settings` | `key`, `value` (JSON) | Nama toko, kontak, rekening tujuan (F13.3). |
| `audit_logs` | `id` (bigserial), `actor_id`, `action`, `entity_type`, `entity_id`, `details` (JSON, **tanpa isi data pribadi**), `created_at` | Pengguna database aplikasi hanya diberi hak `INSERT` dan `SELECT`, sehingga log tidak bisa diubah atau dihapus (F15.4). |
| `payment_events` | `gateway_event_id` (unik), `order_id`, `payload`, `received_at`, `processed_at` | **Tahap 2.** Menjamin webhook diproses tepat satu kali (F14.4). |

**Nilai status** (enum di `packages/shared`):
- `orders.status`: `MENUNGGU_PEMBAYARAN`, `MENUNGGU_VERIFIKASI`, `LUNAS`, `KEDALUWARSA`, `DIBATALKAN`, `DIKEMBALIKAN`
- `orders.digital_status`: `TIDAK_ADA`, `MENUNGGU`, `TERKIRIM`, `LISENSI_TERTUNDA`, `DICABUT`
- `orders.physical_status`: `TIDAK_ADA`, `MENUNGGU`, `DIPROSES`, `DIKIRIM`, `DITERIMA`

---

## 5. Alur penting

### 5.1 Checkout dan penahanan stok (F3.4, F3.8, F3.9, N24)
1. API memvalidasi keranjang dan, bila ada produk fisik, mengambil tarif ongkir (batas 5 detik, F3.6).
2. Satu transaksi database:
   1. Kunci baris produk terkait dengan `SELECT … FOR UPDATE`, **diurutkan berdasarkan ID produk** supaya dua checkout bersamaan tidak saling mengunci.
   2. Bila `stock_qty − stock_reserved` kurang untuk salah satu item, transaksi dibatalkan dan API mengembalikan daftar item yang habis (F3.8).
   3. Tambah `stock_reserved` untuk produk fisik. Tandai kode lisensi sebagai `reserved` dengan `SELECT … FOR UPDATE SKIP LOCKED LIMIT n`.
   4. Ambil nomor invoice dari `invoice_counters` (dikunci per baris).
   5. Simpan pesanan dan itemnya dengan harga terkunci, status `MENUNGGU_PEMBAYARAN`, dan `expires_at = sekarang + 24 jam`.
3. Setelah transaksi berhasil, masukkan dua tugas: email "pesanan dibuat" dan pengingat 3 jam sebelum batas waktu.

### 5.2 Unggah bukti bayar (F4.3, F4.7, F4.8)
1. Nginx menolak unggahan lebih dari 6 MB. API menolak lebih dari 5 MB.
2. API memeriksa jenis file dari **isi file** (magic bytes): hanya JPG, PNG, atau PDF.
3. File dienkripsi lalu disimpan di disk privat dengan nama acak. Nama asli tidak dipakai sebagai path.
4. Bila pesanan masih `MENUNGGU_PEMBAYARAN` dan belum kedaluwarsa: simpan `payment_proofs`, ubah status ke `MENUNGGU_VERIFIKASI`, dan antrekan email ke semua admin. Bila sudah kedaluwarsa, file dibuang dan pembeli diminta checkout ulang.

### 5.3 Verifikasi oleh admin (F5, F7.1)
1. Admin membuka bukti. Pembukaan ini dicatat di `audit_logs` (N28), lalu file didekripsi dan dikirim langsung ke admin.
2. **Terima**, dalam satu transaksi:
   1. `UPDATE orders … WHERE id = ? AND status = 'MENUNGGU_VERIFIKASI'`. Bila 0 baris berubah, admin lain sudah memproses pesanan ini lebih dulu (F5.6).
   2. Status menjadi `LUNAS`. Kode lisensi `reserved` menjadi `assigned`. Stok fisik berpindah dari `stock_reserved` ke terjual (`stock_qty` berkurang).
   3. `digital_status` menjadi `TERKIRIM` (atau `LISENSI_TERTUNDA`, F7.7). `physical_status` menjadi `DIPROSES`.
   4. Catat di `audit_logs`.
   5. Setelah transaksi berhasil, antrekan email lunas ke pembeli.
3. **Tolak**: alasan wajib diisi. Status kembali ke `MENUNGGU_PEMBAYARAN`. Bila `expires_at` sudah lewat, `expires_at` diubah menjadi 24 jam sejak penolakan (F5.5). Email ke pembeli.

### 5.4 Kedaluwarsa otomatis (F4.4, N25)
Tugas berkala setiap menit mencari pesanan `MENUNGGU_PEMBAYARAN` dengan `expires_at < sekarang` (`FOR UPDATE SKIP LOCKED`), mengubahnya menjadi `KEDALUWARSA`, melepas `stock_reserved` dan kode lisensi `reserved`, lalu mengantrekan email. Karena tugas ini memilih semua pesanan yang sudah lewat, pesanan yang tertinggal saat server mati ikut terproses ketika server hidup lagi (N25).

### 5.5 Unduh produk digital (F7.2, F7.3, F7.6, N5)
1. Pembeli menekan "Unduh". API memeriksa bahwa pesanan milik pembeli itu dan berstatus `LUNAS` dengan `digital_status` bukan `DICABUT`.
2. API mengembalikan URL `/api/downloads/<token>`. Token adalah HMAC atas (`user_id`, `product_file_id`, kedaluwarsa 15 menit).
3. Saat URL dibuka, API memeriksa token **dan** sesi harus milik pengguna yang sama. Setelah itu API menjawab dengan header `X-Accel-Redirect` ke lokasi `internal` di Nginx, dan Nginx mengirim filenya. File produk tidak pernah bisa diakses lewat alamat publik.
4. Log akses Nginx untuk `/api/downloads/` tidak mencatat token (N30).

### 5.6 Hapus akun (F1.5, F12.2, F12.5)
1. Permintaan disimpan. Bila masih ada pesanan aktif, penghapusan ditunda dan pembeli diberi tahu.
2. Tugas terjadwal memproses permintaan paling lambat 3×24 jam:
   1. Kosongkan `name_enc`, `phone_enc`, dan `addresses`. Ganti `email_enc` dan `email_index` dengan nilai anonim.
   2. Ubah status menjadi `deleted` dan hapus semua sesi.
   3. Data pesanan dan invoice tetap disimpan 10 tahun.
3. Email konfirmasi dikirim **sebelum** alamat email dihapus.

### 5.7 Webhook payment gateway — tahap 2 (F14)
1. Verifikasi tanda tangan webhook (F14.3).
2. Simpan event ke `payment_events`. Bila `gateway_event_id` sudah ada, berhenti (F14.4).
3. Bandingkan nominal dengan total invoice (F14.5) dan cek status pesanan (F14.6).
4. Jalankan transisi `MENUNGGU_PEMBAYARAN → LUNAS` lewat mesin status di `orders`, tanpa jalur baru di diagram (N36).

---

## 6. Keamanan

| N# | Penerapan |
|----|-----------|
| **N1** TLS | Sertifikat TLS lewat aaPanel (Let's Encrypt, perpanjang otomatis). Nginx: hanya TLS 1.2 dan 1.3, HTTP dialihkan ke HTTPS, header HSTS. |
| **N2** Enkripsi saat disimpan | AES-256-GCM per field (`*_enc`) dan per file bukti bayar, di modul `crypto`. Setiap nilai menyimpan ID kunci, sehingga kunci bisa dirotasi tanpa membuka ulang semua data sekaligus (N35). Kunci ada di environment variable, tidak di repo, tidak di database. Cadangan dienkripsi lagi sebelum dikirim keluar server. |
| **N3** Password | Argon2id. Minimal 8 karakter. Ditolak bila ada di daftar password bocor yang disimpan lokal (tanpa mengirim password ke layanan luar). |
| **N4** Login | Batas percobaan per akun (F1.8) disimpan di `login_attempts`, ditambah batas laju per IP di Nginx. Sesi admin 30 menit tidak aktif, pembeli 30 hari. Admin wajib TOTP. Cookie sesi: `HttpOnly`, `Secure`, `SameSite=Lax`, berlaku hanya untuk domain toko. |
| **N5** Akses file | File di `/srv/hayatun/files`, di luar root web Nginx, dimiliki pengguna sistem `hayatun`. Hanya bisa diakses lewat `X-Accel-Redirect` ke lokasi `internal` setelah API memeriksa hak akses. File tidak pernah dijalankan: tidak ada handler PHP atau CGI di lokasi itu. |
| **N6** Otorisasi | Semua pemeriksaan hak akses ada di Express. Next.js tidak pernah membaca database. Setiap rute memakai salah satu pemeriksa: `requireBuyer`, `requireAdmin`, atau `requireOwner(order)`. Uji matriks otorisasi mencakup 100% rute (bagian 7). |
| **N7** Kerentanan | Header keamanan (Helmet di Express dan pengaturan di Next.js), termasuk Content-Security-Policy. Perlindungan CSRF: `SameSite=Lax` ditambah pemeriksaan header `Origin` untuk semua permintaan yang mengubah data. Pemindaian OWASP ZAP baseline sebelum rilis tahap 1. |
| **N27–N31** Privasi | Penyedia ongkir hanya menerima `area_id`, kode pos, dan berat. Pembukaan data pribadi dicatat di `audit_logs` (disimpan 2 tahun). Log teknis disamarkan (bagian 8). |
| **N29** Masa simpan | Tugas terjadwal untuk hapus bukti 1 tahun dan hapus akun 3×24 jam. Cadangan disimpan 30 hari, lalu dihapus otomatis. |

**Pengamanan server** (wajib sebelum go-live):
- **aaPanel**: pakai port non-bawaan, aktifkan verifikasi dua langkah, batasi akses hanya dari IP pemilik atau lewat SSH tunnel, update aaPanel rutin. Panel server adalah sasaran serangan yang umum.
- **SSH**: login hanya dengan kunci, login root dimatikan.
- **firewalld**: hanya port 80, 443, dan SSH yang terbuka. PostgreSQL, Next.js (3000), dan Express (4000) hanya mendengarkan di `127.0.0.1`.
- **SELinux** tetap `enforcing`. Kebijakan yang diperlukan Nginx untuk meneruskan ke port lokal diaktifkan secara eksplisit.
- **Proses**: Node dan PM2 berjalan sebagai pengguna `hayatun`, bukan root. File `.env` hanya bisa dibaca pengguna itu (`chmod 600`).
- **Database**: pengguna database aplikasi bukan superuser, tanpa hak `UPDATE` atau `DELETE` pada `audit_logs`. Pengguna migrasi terpisah.
- **Nginx**: `client_max_body_size` 6 MB untuk `/api/payments/*/proof`. Rute unggah file produk oleh admin diberi batas lebih besar (lihat Batasan 5).

---

## 7. Tes dan CI

### Tes

| Jenis | Alat | Yang diuji | Mengacu |
|-------|------|------------|---------|
| Unit | Vitest | Mesin status (semua transisi sah dan yang ditolak), penomoran invoice, format Rupiah dan tanggal, enkripsi dan rotasi kunci, token unduhan | N33 |
| Integrasi API | Vitest + Supertest + PostgreSQL asli | Setiap rute: jalur berhasil dan semua kriteria "Jika … maka" di SPEC | F1–F15 |
| Konkurensi | Vitest + PostgreSQL asli | Dua checkout bersamaan untuk stok terakhir, dua admin memverifikasi bersamaan, dua webhook kembar (tahap 2). Harus 0 kejadian ganda. | N24, F3.9, F5.6, F14.4 |
| Otorisasi | Vitest + Supertest | Matriks semua rute × (tanpa login, pembeli A, pembeli B, admin, admin nonaktif) | N6 |
| Waktu | Vitest dengan jam palsu | Kedaluwarsa 24 jam, pengingat 3 jam, tambahan 24 jam setelah ditolak, Diterima 14 hari, hapus bukti 1 tahun, tautan unduh 15 menit | F4.4, F4.5, F5.5, F8.3, F12.3, F7.3 |
| End-to-end | Playwright | Daftar → checkout campuran → unggah bukti → admin terima → unduh dan lihat resi. Bukti ditolak → unggah ulang. Pesanan kedaluwarsa. | N8, N9 |
| Aksesibilitas | Playwright + axe-core, lebar 360 / 768 / 1280 px | Halaman utama toko dan admin: 0 pelanggaran WCAG 2.1 AA, tanpa gulir ke samping di 360 px | N11–N16 |
| Performa | Lighthouse CI (katalog, detail produk), uji beban autocannon sebelum rilis | LCP ≤ 2,5 detik, respons p95 ≤ 500 ms pada 50 pengguna | N17, N18 |

Tes tidak memanggil layanan luar sungguhan. Ongkir, email, dan gateway diganti tiruan. Satu tes khusus memastikan tiruan ongkir yang "mati" membuat checkout ditahan, bukan ongkir Rp0 (F3.6).

### CI (GitHub Actions) **[usulan]**

Setiap pull request:
1. `npm ci`
2. Lint dan pemeriksaan tipe di semua paket.
3. Tes unit, integrasi, konkurensi, otorisasi, dan waktu, dengan layanan PostgreSQL 16.
4. Build `apps/web` dan `apps/api`.
5. Tes end-to-end dan aksesibilitas.
6. `npm audit --audit-level=high`. Gagal bila ada temuan tinggi atau kritis (N34).

Rutin: pembaruan dependensi otomatis setiap minggu (Dependabot), dengan pembaruan keamanan diprioritaskan (N34).

### Deploy

Saat ada tag rilis di cabang utama, CI masuk ke server lewat SSH (kunci khusus deploy) dan menjalankan `ops/deploy.sh`:
1. Ambil kode versi tag.
2. `npm ci` dan build.
3. Jalankan migrasi database.
4. `pm2 reload` untuk `api` lalu `web`.
5. Cek `/api/health`. Bila gagal, kembali ke rilis sebelumnya.

Migrasi harus selalu kompatibel dengan versi kode sebelumnya, sehingga rollback tidak merusak data.

---

## 8. Logging dan pemantauan

**Log aplikasi**
- Format JSON (Pino) di `/var/log/hayatun/{api,web}.log`. Dirotasi harian oleh logrotate dan disimpan **90 hari** (N30).
- Field disamarkan otomatis: `password`, `token`, `cookie`, `authorization`, semua field `*_enc` dalam bentuk terbuka, email, nomor HP, alamat, dan kode lisensi.
- Setiap permintaan punya `request_id` yang dibuat Nginx dan diteruskan ke Next.js dan Express, sehingga satu kejadian bisa dilacak di semua log.
- Yang dicatat: rute, status HTTP, durasi, `user_id` (bukan email), dan error dengan stack trace.

**Log Nginx**: format log tanpa query string. Rute `/api/downloads/` tidak mencatat path lengkap.

**Log aktivitas admin**: tabel `audit_logs` (F15.3), bukan file log. Ditampilkan di panel admin.

**Pemantauan**

| Apa | Cara | Batas peringatan | Mengacu |
|-----|------|------------------|---------|
| Toko bisa diakses | Pemantau uptime dari luar server, cek beranda dan `/api/health` setiap 1 menit | Gagal 3 kali berturut-turut, kirim email ke admin | N22 |
| Kesehatan API | `/api/health` mengecek koneksi database dan penulisan ke disk privat | Sama dengan di atas | N22 |
| Tugas terjadwal | Tugas pg-boss yang gagal setelah semua retry | Email ke admin | N25, F11.4 |
| Cadangan harian | Skrip cadangan mengirim email hasilnya | Gagal, atau tidak ada email dalam 26 jam | N23 |
| Disk server | Pengecekan setiap jam | Terpakai lebih dari 80% | — |
| Sertifikat TLS | Pemantau uptime | Sisa kurang dari 14 hari | N1 |
| Email gagal terkirim | Antrean email | Lebih dari 5 kegagalan dalam 1 jam | F11.4 |

**Cadangan** (`ops/backup.sh`, dijalankan setiap malam oleh cron)
1. `pg_dump` database dan arsip `/srv/hayatun/files`.
2. Enkripsi dengan kunci publik cadangan. Kunci privatnya disimpan pemilik di luar server.
3. Kirim ke penyimpanan cadangan **di luar server**.
4. Simpan 30 hari, lalu hapus otomatis (N29).

Uji pulih ke server kosong dilakukan setiap 3 bulan mengikuti `docs/operasi.md` (N23, N35).

---

## 9. Konfigurasi

Disimpan di `.env` di server (tidak masuk repo). `.env.example` di repo berisi nama variabel tanpa nilai.

**Umum**
- `NODE_ENV`
- `APP_URL`
- `APP_TIMEZONE`
- `LOG_LEVEL`
- `LOG_DIR`

**Proses**
- `WEB_PORT`
- `API_PORT`
- `API_INTERNAL_URL`

**Database**
- `DATABASE_URL`
- `DATABASE_MIGRATION_URL`

**Keamanan**
- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEYS`
- `DATA_ENCRYPTION_ACTIVE_KEY_ID`
- `BLIND_INDEX_KEY`
- `DOWNLOAD_TOKEN_SECRET`
- `TOTP_ISSUER`

**File**
- `STORAGE_DIR`
- `STORAGE_INTERNAL_PREFIX`

**Email**
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `EMAIL_FROM`

**Ongkir**
- `SHIPPING_PROVIDER`
- `SHIPPING_API_KEY`
- `SHIPPING_ORIGIN_AREA_ID`
- `SHIPPING_TIMEOUT_MS`

**Admin pertama**
- `ADMIN_BOOTSTRAP_EMAIL`

**Cadangan**
- `BACKUP_TARGET_ENDPOINT`
- `BACKUP_TARGET_BUCKET`
- `BACKUP_TARGET_ACCESS_KEY_ID`
- `BACKUP_TARGET_SECRET_ACCESS_KEY`
- `BACKUP_ENCRYPTION_PUBLIC_KEY`
- `BACKUP_REPORT_EMAIL`

**Tahap 2**
- `PAYMENT_GATEWAY_PROVIDER`
- `PAYMENT_GATEWAY_SERVER_KEY`
- `PAYMENT_GATEWAY_WEBHOOK_SECRET`

---

## 10. Keputusan

### K1. Next.js dan Express sebagai dua proses di satu server
- **Konteks**: pemilik ingin Next.js terbaru dan Express, sudah punya server CentOS Stream 9 dengan aaPanel dan Nginx, dan memilih Opsi B dari tiga opsi.
- **Keputusan**: satu repo (npm workspaces) dengan `apps/web`, `apps/api`, dan `packages/shared`. Keduanya dijalankan PM2 di server yang sama, di belakang Nginx, dengan satu domain.
- **Konsekuensi**: cookie sesi sederhana tanpa CORS dan biaya rendah. Pemilik menanggung perawatan server sendiri: patch, backup, dan pemantauan. Server menjadi satu titik kegagalan (Batasan 1).

### K2. Express memegang seluruh logika bisnis; Next.js hanya tampilan
- **Konteks**: Next.js bisa membaca database sendiri (Server Actions, Route Handlers). Kalau dipakai bersama Express, aturan bisnis dan pemeriksaan hak akses akan tersebar di dua tempat.
- **Keputusan**: hanya Express yang tersambung ke database, disk privat, dan layanan luar. Next.js mengambil data hanya lewat API.
- **Konsekuensi**: satu tempat untuk otorisasi dan mesin status (N6, N33). Halaman server menambah satu panggilan HTTP lokal per halaman, yang tidak terasa di skala ini.

### K3. PostgreSQL dengan penguncian baris; Drizzle ORM
- **Konteks**: stok dan kode lisensi tidak boleh terjual dua kali, termasuk saat ada permintaan bersamaan (N24).
- **Keputusan**: PostgreSQL 16 dengan transaksi, `SELECT … FOR UPDATE`, dan `SKIP LOCKED`. Akses lewat Drizzle, yang mendukung penguncian baris secara langsung.
- **Konsekuensi**: konsistensi dijamin database, bukan kode aplikasi. aaPanel umumnya condong ke MySQL, jadi PostgreSQL dipasang dan dirawat terpisah lewat paket resmi PostgreSQL.

### K4. File di disk lokal privat, dikirim lewat Nginx `X-Accel-Redirect`
- **Konteks**: di opsi awal disebut object storage. Pemilik punya server sendiri, dan jumlah file kecil (sekitar 100 produk).
- **Keputusan**: file produk dan bukti bayar disimpan di `/srv/hayatun/files`, di luar root web. API memeriksa hak akses, lalu Nginx yang mengirim file. Object storage hanya dipakai sebagai tujuan cadangan di luar server.
- **Konsekuensi**: tanpa biaya storage tambahan, dan unduhan efisien. Disk server harus cukup untuk semua file produk. Cadangan harus menyertakan folder file. Bila nanti pindah server, folder ini ikut dipindah.

### K5. Enkripsi per field di aplikasi, dengan blind index untuk email
- **Konteks**: data pribadi wajib dienkripsi (F12.1, N2), dan hanya aplikasi yang boleh membukanya. Login tetap harus bisa mencari pengguna lewat email.
- **Keputusan**: AES-256-GCM per field dengan ID kunci, ditambah HMAC email yang dinormalisasi untuk pencarian dan cek keunikan.
- **Konsekuensi**: dump database yang bocor tidak membuka data pribadi tanpa kunci. Pencarian sebagian, misalnya mencari nama pembeli di admin, tidak bisa dilakukan; admin mencari lewat nomor invoice atau email lengkap. Kunci yang hilang berarti data hilang, sehingga kunci wajib dicadangkan terpisah (N35).

### K6. Sesi di server, bukan JWT
- **Konteks**: admin yang dinonaktifkan harus kehilangan akses dalam 1 menit (F15.5), dan hapus akun mengakhiri semua sesi (F12.2).
- **Keputusan**: tabel `sessions` di PostgreSQL. Cookie hanya berisi ID acak.
- **Konsekuensi**: pencabutan akses langsung berlaku. Ada satu query sesi per permintaan, yang tidak masalah di skala ini.

### K7. Antrean tugas di PostgreSQL (pg-boss), tanpa Redis
- **Konteks**: ada tugas tertunda dan berkala (F4.4, F4.5, F8.3, F12.2, F12.3) serta retry email (F11.4).
- **Keputusan**: pg-boss, berjalan di dalam proses Express.
- **Konsekuensi**: tidak ada layanan baru yang perlu dirawat, dan tugas ikut tercadangkan bersama database. Tugas berhenti selama proses API mati, lalu mengejar yang tertinggal saat hidup lagi (N25).

### K8. Invoice sebagai halaman siap cetak, bukan PDF yang dibuat server
- **Konteks**: F6.4 meminta invoice bisa dilihat, diunduh, dan dicetak. Membuat PDF di server membutuhkan browser headless yang berat untuk server kecil.
- **Keputusan**: halaman invoice dengan gaya cetak khusus (DESIGN bagian 6). Unduh berarti tombol "Simpan sebagai PDF" yang memakai fitur cetak browser.
- **Konsekuensi**: server ringan. Tampilan PDF sedikit bergantung pada browser pembeli. Bila nanti invoice perlu dilampirkan otomatis di email, keputusan ini ditinjau ulang.

### K9. Node.js 24 LTS dijalankan PM2 lewat aaPanel
- **Konteks**: pemilik memakai aaPanel, yang punya pengelola proyek Node berbasis PM2.
- **Keputusan**: dua proses PM2 (`hayatun-api`, `hayatun-web`) dengan file `ops/ecosystem.config.cjs` di repo, masing-masing satu instance.
- **Konsekuensi**: proses otomatis hidup lagi setelah crash atau reboot. Karena hanya satu instance API, batas laju login bisa disimpan di database tanpa penyimpanan bersama tambahan.

### K10. Rencana untuk akhir dukungan CentOS Stream 9
- **Konteks**: CentOS Stream 9 berhenti mendapat pembaruan pada **31 Mei 2027**, sekitar 7 bulan setelah dokumen ini. Setelah itu tidak ada patch keamanan.
- **Keputusan**: aplikasi tidak memakai apa pun yang khusus CentOS. Sebelum Mei 2027, server dipindah ke distribusi yang kompatibel dan masih didukung, misalnya AlmaLinux 9 atau Rocky Linux 9 (didukung hingga 2032), dengan mengikuti prosedur pulih dari cadangan (N23, N35).
- **Konsekuensi**: perlu satu migrasi server terencana dalam tahun pertama. Prosedur pulih yang rutin diuji (N23) menjadi latihan untuk migrasi itu.

---

## 11. Batasan

1. **Satu server.** Bila perangkat keras atau penyedia server bermasalah, toko mati sampai dipulihkan dari cadangan di server lain (target ≤ 8 jam, N23). Target ketersediaan 99,5% (N22) realistis untuk gangguan perangkat lunak, tapi tidak menjamin terhadap kerusakan server.
2. **Akhir dukungan CentOS Stream 9 pada 31 Mei 2027** (K10). Menjalankan toko setelah tanggal itu tanpa migrasi melanggar N34.
3. **aaPanel menambah permukaan serangan.** Pengamanan di bagian 6 wajib, dan pembaruan aaPanel masuk jadwal perawatan.
4. **Tidak bisa ditambah server dengan mudah.** Penjadwal tugas dan batas laju mengandalkan satu instance API. Bila nanti perlu lebih dari satu server, kedua hal ini harus dirancang ulang. Ini tidak diperlukan untuk skala 10 kali target.
5. **Ukuran file produk digital terbesar belum diketahui** (SPEC, pertanyaan terbuka 6). Ini menentukan batas unggah Nginx untuk admin, kebutuhan disk, dan lama proses cadangan.
6. **Penyedia ongkir belum dipilih** (SPEC, pertanyaan terbuka 1). Modul `shipping` dirancang sebagai adaptor; checkout produk fisik baru bisa diuji penuh setelah penyedia dipilih.
7. **Pengiriman email** bergantung pada penyedia SMTP dan pengaturan DNS domain (SPF, DKIM, DMARC). Tanpa itu, email bisa masuk folder spam.
8. **Invoice PDF** dibuat lewat fitur cetak browser (K8), sehingga tampilannya bisa sedikit berbeda antar browser.
9. **Pencarian admin** berdasarkan nama atau nomor HP pembeli tidak tersedia karena data itu terenkripsi (K5). Admin mencari lewat nomor invoice atau email lengkap.
