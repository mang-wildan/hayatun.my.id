# Panduan operasi (T59, T62)

Satu pintu untuk tiga pekerjaan yang harus bisa dilakukan pembangun lain tanpa bertanya ke pembangun asli (N35): **memasang ulang dari nol**, **memulihkan cadangan**, dan **mengganti kunci enkripsi**. Di antaranya ada cadangan harian dan uji pulih (N23, N29).

| Pekerjaan | Bagian |
|---|---|
| Server baru atau server hilang | [Memasang ulang dari nol](#memasang-ulang-dari-nol), lalu [Memulihkan](#memulihkan) |
| Cadangan malam, kunci age, penyimpanan | [Apa yang dicadangkan](#apa-yang-dicadangkan-dan-apa-yang-tidak), [Pemasangan](#pemasangan) |
| Latihan pulih tiap 3 bulan | [Uji pulih](#uji-pulih-tiap-3-bulan-n23) |
| Kunci enkripsi bocor atau diganti berkala | [Mengganti kunci enkripsi](#mengganti-kunci-enkripsi) |

Dokumen pendamping: `docs/server-hardening.md` (pengamanan server), `docs/nginx.md` (tepi), `docs/deploy.md` (deploy dan rollback), `docs/pemantauan.md` (peringatan dan log), `docs/zap.md` (pemindaian keamanan).

`ops/restore-test.sh --from-docs` memeriksa panduan ini terhadap skrip: setiap perintah `ops/*.sh` dan `npm run` di blok `bash` harus ada, bisa dijalankan, dan memakai opsi yang dikenal skripnya. Ia **tidak** memulihkan apa pun dan tidak membuktikan bahwa langkahnya benar di servermu; itu hanya terbukti kalau seseorang mengikutinya di server kosong.

## Memasang ulang dari nol

Untuk server kosong (server baru, atau yang lama hilang). Urutannya penting: berhenti dan periksa di setiap tahap sebelum lanjut.

**Siapkan dulu, dari penyimpanan di luar server (kalau tidak ada, berhenti: lihat catatan di bawah):**

| Bahan | Untuk apa |
|---|---|
| Salinan `shared/.env` terbaru, **khususnya** `DATA_ENCRYPTION_KEYS` dan `BLIND_INDEX_KEY` | membuka data pribadi di cadangan; kunci baru tidak bisa membuka data lama |
| Kunci privat age (`kunci-cadangan.txt`) | membuka cadangan |
| Kunci akses bucket cadangan | mengunduh cadangan |
| Akses DNS `hayatun.my.id` dan kunci SSH | mengarahkan domain, masuk server |

> Tanpa `DATA_ENCRYPTION_KEYS`/`BLIND_INDEX_KEY` yang lama, toko bisa dipasang ulang tetapi **data pembeli di cadangan tidak terbaca** (nama, email, telepon, alamat, bukti bayar). Itu risiko yang sudah diterima (ARCHITECTURE K5); makanya kunci disimpan terpisah.

1. **Amankan server** dengan urutan di `docs/server-hardening.md` (pengguna `hayatun`, PostgreSQL lokal, SELinux enforcing, pembaruan otomatis, SSH hanya kunci, firewalld 22/80/443, aaPanel terkunci). Periksa: `sudo ops/check-server.sh` harus tanpa GAGAL. Target OS: AlmaLinux 9 atau Rocky Linux 9 (CentOS 7 sudah tidak didukung; ARCHITECTURE K10).
2. **Pasang perangkat**: Node 24, PM2, git, jq, curl, `age`, `rclone`, `logrotate`, klien PostgreSQL 16, dan Nginx dari aaPanel.
3. **Buat peran dan database** (hanya yang produksi; `ops/postgres-init.sql` untuk pengembangan dan CI, jangan dipakai di produksi karena membuat database uji). Ganti kedua kata sandi dengan nilai acak panjang:
   ```bash
   sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
   CREATE ROLE hayatun_migrate LOGIN PASSWORD '<kata-sandi-migrasi>';
   CREATE ROLE hayatun_app LOGIN PASSWORD '<kata-sandi-aplikasi>';
   CREATE DATABASE hayatun OWNER hayatun_migrate;
   SQL
   ```
4. **Pasang kode dan tata letak** (lihat `docs/deploy.md`):
   ```bash
   sudo -u hayatun git clone <url-repo> /srv/hayatun/repo
   sudo -u hayatun mkdir -p /srv/hayatun/{releases,shared/logs,shared/tmp}
   sudo -u hayatun install -m 600 /dev/null /srv/hayatun/shared/.env
   ```
5. **Isi `shared/.env`** (mode 600; daftar variabel di `.env.example` dan ARCHITECTURE bagian 9).
   - **Toko yang sudah ada (pulih):** pakai salinan `.env` dari penyimpanan terpisah apa adanya, termasuk semua kunci di `DATA_ENCRYPTION_KEYS`. Ubah hanya yang memang berbeda di server baru (kata sandi database, `DATABASE_*`).
   - **Toko baru:** buat rahasia dengan `openssl rand -base64 32` (satu per nilai): `SESSION_SECRET`, `BLIND_INDEX_KEY`, dan `DATA_ENCRYPTION_KEYS=k1:<base64>` dengan `DATA_ENCRYPTION_ACTIVE_KEY_ID=k1`. **Simpan salinan `.env` di penyimpanan terpisah saat itu juga**, sebelum ada data.
6. **Nginx dan TLS**: ikuti `docs/nginx.md`, lalu periksa dari luar: `ops/check-edge.sh https://hayatun.my.id` (semua LULUS). Arahkan DNS lebih dulu supaya sertifikat Let's Encrypt bisa terbit.
7. **Deploy pertama** (menjalankan migrasi dan memeriksa kesehatan):
   ```bash
   sudo -u hayatun /srv/hayatun/repo/ops/deploy.sh --dry-run v1.0.0
   sudo -u hayatun /srv/hayatun/repo/ops/deploy.sh v1.0.0
   ```
   Ganti `v1.0.0` dengan tag rilis terakhir (`git tag --sort=-v:refname | head`). Setelah itu `curl -fsS http://127.0.0.1:4000/api/health` harus OK.
8. **Data**:
   - toko baru: buat admin pertama (undangan dikirim ke `ADMIN_BOOTSTRAP_EMAIL`):
     ```bash
     sudo -u hayatun -i
     set -a; . /srv/hayatun/shared/.env; set +a
     cd /srv/hayatun/current
     npm -w apps/api run admin:bootstrap
     ```
   - pulih dari cadangan: lanjut ke [Memulihkan](#memulihkan) **sebelum** toko dibuka. Database harus masih kosong (selain hasil migrasi deploy: lihat catatan di sana).
9. **Jadwal dan pemantauan**: pasang cron cadangan ([Pemasangan](#pemasangan) langkah 6), cron peringatan dan monitor luar (`docs/pemantauan.md`), dan rotasi log:
   ```bash
   sudo install -m 644 /srv/hayatun/repo/ops/logrotate/hayatun /etc/logrotate.d/hayatun
   sudo logrotate -d /etc/logrotate.d/hayatun
   sudo -u hayatun /srv/hayatun/repo/ops/check-alerts.sh --test-email
   ```
10. **Periksa menyeluruh**: `sudo ops/check-server.sh`, `ops/check-edge.sh https://hayatun.my.id`, jalankan satu cadangan dengan tangan (`ops/backup.sh`), dan buka toko dari ponsel: beranda, produk, daftar, masuk.

Waktu untuk seluruh urutan ini termasuk dalam RTO 8 jam (N23); catat lamanya setiap kali dilatih.

> **Status cadangan: diuji dengan `age`, `pg_dump`, `pg_restore`, dan PostgreSQL sungguhan, tetapi `rclone` ditiru** (`npx vitest run ops/backup.test.ts`). Unggahan ke penyedia penyimpanan sungguhan dan pemulihan di servermu belum terbukti. Lakukan uji pulih pertama sebelum toko dibuka.

## Apa yang dicadangkan, dan apa yang TIDAK

| Isi arsip | Keterangan |
|---|---|
| `db.dump` | `pg_dump` format kustom: seluruh database termasuk hak akses tabel (`audit_logs` tetap tak bisa diubah oleh role aplikasi) dan antrean pg-boss |
| `files.tar` | seluruh `/srv/hayatun/files` (bukti bayar terenkripsi dan file produk) |
| `MANIFEST` | waktu, jumlah file, dan sha256 `db.dump` dan `files.tar` |

**Tidak ikut: `shared/.env`, khususnya `DATA_ENCRYPTION_KEYS` dan `BLIND_INDEX_KEY`.** Memasukkannya berarti siapa pun yang memegang cadangan yang sudah didekripsi juga memegang kuncinya, dan itu melanggar pemisahan kunci dan data (N2). Akibatnya **kamu harus menyimpan kunci aplikasi di tempat terpisah dari cadangan** (pengelola kata sandi, brankas fisik). Tanpa kunci itu, kolom terenkripsi di cadangan (nama, email, telepon, alamat, bukti bayar) tidak bisa dibaca, dan akun tidak bisa dicari (indeks buta). Simpan juga salinan `shared/.env` lengkap di tempat yang sama dengan kunci itu, diperbarui tiap berubah.

## Pemasangan

1. Pasang alat di server: `age` dan `rclone` (paket resmi `dnf install age`; rclone dari rclone.org atau `dnf install rclone`), serta klien PostgreSQL 16.
2. Buat pasangan kunci **di mesinmu sendiri, bukan di server**:
   ```bash
   age-keygen -o kunci-cadangan.txt     # cetak: Public key: age1...
   ```
   Simpan `kunci-cadangan.txt` (kunci **privat**) di luar server dan terpisah dari kunci aplikasi, misalnya di pengelola kata sandi dan satu salinan cetak. **Kunci privat hilang berarti semua cadangan tidak bisa dibuka.** Hanya kunci **publik** (`age1...`) yang dipasang di server.
3. Siapkan bucket penyimpanan S3 di luar server (penyedia bebas; semua yang kompatibel S3). Buat kunci akses yang hanya boleh menulis dan menghapus di bucket itu. Pertimbangkan versi objek atau penguncian objek di sisi penyedia agar penyerang yang membobol server tidak bisa menghapus cadangan.
4. Tambahkan ke `/srv/hayatun/shared/.env` (chmod 600):
   ```
   DATABASE_MIGRATION_URL=postgres://hayatun_migrate:...@127.0.0.1:5432/hayatun
   BACKUP_TARGET_ENDPOINT=https://s3.contoh-penyedia.com
   BACKUP_TARGET_BUCKET=nama-bucket
   BACKUP_TARGET_ACCESS_KEY_ID=...
   BACKUP_TARGET_SECRET_ACCESS_KEY=...
   BACKUP_ENCRYPTION_PUBLIC_KEY=age1...
   ```
5. Jalankan sekali dengan tangan lalu periksa: `sudo -u hayatun /srv/hayatun/repo/ops/backup.sh` dan `cat /srv/hayatun/shared/backup-status`.
6. Jadwalkan tiap malam (aaPanel, Cron, atau crontab pengguna `hayatun`), misalnya pukul 02:10:
   ```
   10 2 * * * /srv/hayatun/repo/ops/backup.sh >> /srv/hayatun/shared/logs/backup.cron.log 2>&1
   ```

`ops/backup.sh` menulis hasil terakhir ke `shared/backup-status` (`ok <waktu> <nama> <byte>` atau `gagal <waktu> <langkah>`). Pemantauan dan peringatan atas berkas ini dikerjakan di T60 (gagal, atau tidak ada cadangan baru dalam 26 jam).

## Yang dilakukan skrip cadangan

1. `pg_dump` database dan arsip folder file, lalu satu arsip dienkripsi dengan **kunci publik** age. Bahan yang belum terenkripsi dibuang segera, dan folder sementara (`shared/tmp`, mode 700) dibersihkan apa pun hasilnya.
2. Unggah arsip dan `.sha256` ke `bucket/hayatun/` lewat rclone. Kredensial hanya lewat lingkungan, tidak pernah di argumen atau berkas konfigurasi.
3. Verifikasi ukuran objek di penyimpanan sama dengan yang lokal.
4. **Baru sesudah itu** hapus cadangan lebih tua dari 30 hari (`RETENTION_DAYS`). Bila unggahan atau verifikasi gagal, tidak ada yang dihapus.

Kode keluar: 0 berhasil, 1 gagal, 2 konfigurasi atau prasyarat, 3 cadangan lain berjalan. Skrip menolak jalan bila kunci publik kosong atau bukan kunci age: tidak pernah ada cadangan tak terenkripsi.

## Memulihkan

Pemulihan selalu ke tujuan **kosong**; skrip menolak menimpa.

```bash
# di server kosong: pasang aplikasi (docs/deploy.md), siapkan shared/.env berisi BACKUP_TARGET_*, lalu
ops/restore.sh --identity kunci-cadangan.txt \
  --database postgres://hayatun_migrate:...@127.0.0.1:5432/hayatun \
  --files-dir /srv/hayatun/files            # [--name hayatun-20261030T021000Z.tar.age]
```

Skrip memeriksa tujuan kosong, mengunduh, mencocokkan sha256, mendekripsi, mencocokkan MANIFEST, `pg_restore` dalam satu transaksi, lalu mengekstrak file. Setelah itu pasang kunci aplikasi dari penyimpanan terpisah ke `shared/.env`, jalankan `ops/deploy.sh` (atau `pm2 start`), dan periksa `/api/health`.

## Uji pulih (tiap 3 bulan, N23)

Di server kosong atau mesin uji, dengan berkas env aplikasi lengkap (termasuk kunci aplikasi) dan kunci privat age:

```bash
ops/restore-test.sh --identity kunci-cadangan.txt --env-file aplikasi.env --files-dir /srv/hayatun/files-uji --api-port 4100
```

Memulihkan ke database kosong, menjalankan API terhadapnya, memeriksa `/api/health`, dan mencetak lama total dibanding batas RTO 8 jam (`RTO_SECONDS`). Keluar 0 hanya bila API sehat **dan** dalam batas. Tempel hasilnya ke catatan uji triwulan dan catat tanggalnya.

## Menghapus data dari cadangan (N29)

Akun yang dihapus tetap ada di cadangan yang sudah dibuat sampai cadangan itu kedaluwarsa (30 hari). Tidak perlu ditulis ulang; cukup pastikan retensi berjalan (`backup-status` ok dan arsip lama hilang dari bucket).

## Mengganti kunci enkripsi

Dua jenis kunci, perlakuannya berbeda:

- **Kunci cadangan age:** buat pasangan baru di mesinmu, pasang kunci publik baru di `.env` (`BACKUP_ENCRYPTION_PUBLIC_KEY`). Cadangan lama tetap butuh kunci privat lama sampai kedaluwarsa; simpan keduanya 30 hari.
- **Kunci data aplikasi** (`DATA_ENCRYPTION_KEYS`): prosedur di bawah. Yang diputar: nama, email, telepon, dan rahasia 2FA pengguna; kode lisensi; alamat; alamat kirim di pesanan; dan file bukti bayar. File sampul dan file produk memang tidak dienkripsi aplikasi.

Kapan: kunci diduga bocor, orang yang pernah memegangnya tidak lagi bekerja, atau berkala (disarankan setahun sekali). Aman dijalankan saat toko hidup: tiap nilai ditulis hanya bila belum diubah aplikasi di sela-selanya, dan yang terlewat diambil putaran berikutnya.

**Tidak dicakup:** `BLIND_INDEX_KEY` (HMAC untuk login dan cek duplikat) dan `SESSION_SECRET`. Tidak ada alat untuk mengganti `BLIND_INDEX_KEY`: mengubahnya membuat login dengan email dan cek duplikat kode lisensi gagal sampai semua indeks dihitung ulang. Kalau kunci itu bocor, hubungi pembangun; jangan mengubahnya sendiri.

1. **Cadangan dulu**, titik kembali dengan kunci lama: `sudo -u hayatun /srv/hayatun/repo/ops/backup.sh`, lalu `cat /srv/hayatun/shared/backup-status` harus `ok`.
2. **Buat kunci baru**: `openssl rand -base64 32`. Di `shared/.env` **tambahkan** sebagai kunci kedua, jangan ganti yang lama, dan jadikan aktif:
   ```
   DATA_ENCRYPTION_KEYS=k1:<kunci-lama>,k2:<kunci-baru>
   DATA_ENCRYPTION_ACTIVE_KEY_ID=k2
   ```
3. **Simpan salinan `.env` baru di penyimpanan terpisah SEKARANG**, sebelum menjalankan apa pun. Nilai yang sudah diputar hanya terbaca dengan `k2`; kehilangannya sama dengan kehilangan data itu.
4. **Muat ulang aplikasi** supaya menulis dengan `k2` dan tetap bisa membaca `k1`:
   ```bash
   sudo -u hayatun pm2 startOrReload /srv/hayatun/current/ops/ecosystem.config.cjs --update-env
   curl -fsS http://127.0.0.1:4000/api/health
   ```
5. **Putar**. Muat `.env` lalu jalankan; mulai dari `--status` dan `--dry-run`:
   ```bash
   sudo -u hayatun -i
   set -a; . /srv/hayatun/shared/.env; set +a
   cd /srv/hayatun/current
   npm -w apps/api run rotate-keys -- --status
   npm -w apps/api run rotate-keys -- --dry-run
   npm -w apps/api run rotate-keys
   ```
   `--status` menampilkan jumlah nilai per kunci (mis. `Sebelum: k1=1200 k2=15`). Putaran sungguhan mencetak `Sesudah: k2=...`. Kode keluar 0 bila semua berhasil, 1 bila ada yang gagal (baris `GAGAL <kolom> <id>`: kunci tidak dikenal atau data rusak; nilai itu tidak diubah), 2 bila konfigurasi salah.
6. **Ulangi `--status`** sampai tidak ada kunci selain `k2`. Bila `skipped` tidak nol atau ada `GAGAL`, selidiki lalu jalankan ulang; skrip aman diulang.
7. **Cadangan lagi** (`ops/backup.sh`): cadangan ini hanya berisi nilai `k2`.
8. **Lepas kunci lama dengan hati-hati.** Cadangan yang dibuat sebelum langkah 5 (sampai **30 hari** ke belakang) masih berisi nilai `k1`. Karena itu simpan `k1` di penyimpanan terpisah **selama 30 hari sejak langkah 5 selesai**, catat tanggalnya. Menghapus `k1` dari `.env` di server boleh setelah langkah 6 (aplikasi tidak lagi membutuhkannya), tetapi **jangan membuangnya dari penyimpanan terpisah** sebelum tanggal itu; kalau perlu memulihkan cadangan lama, `.env` yang dipakai harus memuat `k1` dan `k2`.

Kalau ada yang tidak beres setelah langkah 4: kembalikan `DATA_ENCRYPTION_ACTIVE_KEY_ID=k1` dan muat ulang. Kedua kunci tetap ada, jadi nilai lama dan baru tetap terbaca. **Jangan pernah menghapus `k2` dari daftar** setelah ada nilai yang ditulis dengannya.

Bila rotasi dilakukan karena kebocoran: cadangan dan dump yang sudah di tangan orang lain tidak bisa ditarik kembali dan tetap terbuka dengan kunci yang bocor sampai kedaluwarsa. Ganti juga kunci age dan kunci akses bucket, dan periksa log aktivitas.
