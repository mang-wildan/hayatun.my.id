# Cadangan dan pemulihan (T59)

Cadangan harian terenkripsi ke penyimpanan di luar server, disimpan 30 hari, dan prosedur pulih ke server kosong. Memenuhi N23 (RPO <= 24 jam, RTO <= 8 jam, uji pulih tiap 3 bulan) dan N29 (data terhapus hilang dari cadangan paling lama 30 hari).

> **Status: diuji dengan `age`, `pg_dump`, `pg_restore`, dan PostgreSQL sungguhan, tetapi `rclone` ditiru** (`npx vitest run ops/backup.test.ts`). Unggahan ke penyedia penyimpanan sungguhan dan pemulihan di servermu belum terbukti. Lakukan uji pulih pertama sebelum toko dibuka.

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

## Mengganti kunci

- **Kunci cadangan age:** buat pasangan baru, pasang kunci publik baru di `.env`. Cadangan lama tetap butuh kunci privat lama sampai kedaluwarsa; simpan keduanya selama 30 hari.
- **Kunci aplikasi:** prosedur rotasi lewat ID kunci ada di ARCHITECTURE (N2, N35). Setelah rotasi, perbarui salinan kunci di penyimpanan terpisah sebelum cadangan berikutnya dibuat.
