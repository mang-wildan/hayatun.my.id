# Migrasi server ke AlmaLinux 9 atau Rocky Linux 9 (T63)

CentOS Stream 9 berhenti mendapat pembaruan pada **31 Mei 2027** (ARCHITECTURE K10). Sesudah itu tidak ada patch keamanan, dan menjalankan toko di atasnya melanggar N34. Dokumen ini memindahkan Hayatun ke AlmaLinux 9 atau Rocky Linux 9 (keduanya sekelas RHEL 9, didukung hingga 2032) dengan mengikuti prosedur pasang ulang dan pulih yang sudah ada.

> **Status: ditulis dari dokumentasi dan dari skrip repo ini; belum pernah dijalankan.** Tidak ada langkah di sini yang sudah terbukti di servermu, dan prosedur pulih (T59, T62) belum pernah dipakai di server kosong. **Migrasi ini bisa menjadi pemulihan sungguhan pertamamu: latih dulu** (langkah 2) supaya hari pemindahan bukan hari pertama kamu mencoba.

## Pengingat otomatis

- `sudo ops/check-server.sh` mencetak `PERIKSA os-didukung` dengan sisa hari selama masih CentOS Stream 9 sebelum batas, `GAGAL` sesudah 31 Mei 2027, dan `LULUS` di AlmaLinux/Rocky/RHEL 9 ke atas.
- `ops/check-alerts.sh` (cron tiap jam) mengirim email `PERINGATAN: os` mulai **90 hari sebelum batas (2 Maret 2027)**, diulang tiap 24 jam, dan email `PULIH` setelah kamu pindah. Itu alarm terakhir, bukan jadwalmu: **targetkan selesai paling lambat akhir Februari 2027**, dan mulailah persiapan (langkah 0-2) paling lambat Januari.

## Jalur yang dipilih: server baru berdampingan

Pasang server AlmaLinux/Rocky baru di samping yang lama, pulihkan data ke sana, alihkan DNS, dan biarkan server lama sebagai jalan kembali. Kelebihannya: server lama tidak disentuh sampai kamu yakin, dan jalan kembali hanya mengembalikan DNS.

Pembaruan di tempat (mengubah CentOS Stream menjadi AlmaLinux di server yang sama) **tidak dianjurkan**: tidak ada jalan kembali yang bersih bila gagal di tengah, dan alat konversinya tidak dibahas atau diuji di sini.

## Langkah 0. Periksa dulu (jangan beli atau ubah apa pun sebelum ini lengkap)

| Periksa | Kalau tidak |
|---|---|
| aaPanel yang kamu pakai mendukung AlmaLinux/Rocky 9 (cek halaman pemasang dan dokumentasi aaPanel untuk versi yang berlaku, **saya tidak bisa memastikannya dari sini**) | berhenti dan putuskan: panel lain, atau pasang Nginx tanpa panel (sesuaikan `docs/nginx.md`) |
| Cadangan malam jalan dan `shared/backup-status` berisi `ok` | perbaiki dulu (`docs/operasi.md`) |
| Kamu punya, di luar server: salinan `shared/.env` terbaru (termasuk semua `DATA_ENCRYPTION_KEYS` dan `BLIND_INDEX_KEY`), kunci privat age, kunci akses bucket cadangan | kumpulkan dulu; tanpa kunci aplikasi data di cadangan tidak terbaca |
| Akses DNS `hayatun.my.id` | tanpa itu tidak bisa dialihkan |
| Server baru: spesifikasi sama atau lebih baik dari yang lama, di wilayah yang sama | |
| Layanan luar yang membatasi alamat IP (SMTP, penyedia ongkir) | daftarkan IP server baru sebelum pindah |

Turunkan **TTL DNS** record `hayatun.my.id` (A/AAAA) menjadi 300 detik paling lambat 48 jam sebelum hari pemindahan (TTL lama harus lewat dulu).

## Langkah 1. Pasang server baru

Ikuti [Memasang ulang dari nol](operasi.md#memasang-ulang-dari-nol) langkah 1-6, dengan OS AlmaLinux 9 atau Rocky Linux 9. Beberapa hal yang bisa berbeda dari CentOS Stream 9:

- nama paket dan repositori PostgreSQL 16 (repositori resmi PostgreSQL), dan `age` serta `rclone` (sebagian ada di EPEL: `dnf install epel-release`; kalau tidak, unduh rilis resmi dan periksa checksum-nya);
- zona waktu: `sudo timedatectl set-timezone Asia/Jakarta`;
- SELinux harus tetap `enforcing`, termasuk konteks folder `/srv/hayatun/files` agar Nginx bisa mengirim file lewat X-Accel-Redirect (`docs/server-hardening.md` bagian 3);
- sertifikat TLS: DNS belum menunjuk ke server baru, jadi sertifikat Let's Encrypt lewat validasi HTTP belum bisa terbit. Pilih satu: terbitkan lewat validasi DNS, atau salin sertifikat dan kuncinya dari server lama, atau terbitkan sesudah DNS dialihkan (langkah 3, ada jeda singkat dengan peringatan sertifikat).

Jangan alihkan DNS dulu. Periksa server baru dengan `sudo ops/check-server.sh`: `os-didukung` harus `LULUS` dan tidak ada `GAGAL`.

## Langkah 2. Latihan pulih di server baru (wajib)

Latih pemulihan cadangan terbaru di server baru **ke database dan folder percobaan**, bukan yang akan dipakai produksi. Buat database kosong `hayatun_latihan` (pemilik `hayatun_migrate`), salin `shared/.env` ke `/tmp/latihan.env` dan ubah `DATABASE_MIGRATION_URL`/`DATABASE_URL` agar menunjuk ke `hayatun_latihan`, lalu:

```bash
ops/restore-test.sh --identity /tmp/kunci-cadangan.txt --env-file /tmp/latihan.env --files-dir /srv/hayatun/files-latihan --api-port 4100
```

Catat **lama totalnya**: itu perkiraan waktu henti hari pemindahan (ditambah cadangan akhir dan DNS). Lulus berarti pemulihan selesai dan API sehat dalam batas RTO; itu **belum** membuktikan kunci aplikasi benar. Bukti kunci benar ada di langkah 3.3 (membuka satu bukti bayar). Setelah selesai, hapus `hayatun_latihan`, `/srv/hayatun/files-latihan`, `/tmp/latihan.env`, dan `/tmp/kunci-cadangan.txt`.

## Langkah 3. Hari pemindahan

Pilih jam sepi dan umumkan jendela singkat. Catat waktu mulai tiap langkah.

1. **Hentikan penulisan di server lama**: toko berhenti menerima pesanan dan unggahan.
   ```bash
   sudo -u hayatun pm2 stop hayatun-web hayatun-api
   ```
2. **Cadangan akhir di server lama** dan pastikan sukses:
   ```bash
   sudo -u hayatun /srv/hayatun/repo/ops/backup.sh
   cat /srv/hayatun/shared/backup-status
   ```
   Harus `ok ...`. Kalau `gagal`, jangan lanjut; nyalakan lagi server lama (`pm2 start`) dan perbaiki.
3. **Pulihkan di server baru** ke database dan folder yang kosong, dengan cadangan akhir itu (`--name latest` atau nama yang tercetak di `backup-status`), lalu deploy: [Memasang ulang dari nol](operasi.md#memasang-ulang-dari-nol) langkah 7. Periksa `curl -fsS http://127.0.0.1:4000/api/health`, lalu lewat berkas `hosts` di laptopmu (arahkan `hayatun.my.id` ke IP server baru, **hanya di laptopmu**): masuk sebagai admin, buka daftar pesanan, **buka satu bukti bayar** (membuktikan kunci enkripsi benar; kalau tidak terbuka, `DATA_ENCRYPTION_KEYS` di `.env` salah, perbaiki sebelum DNS dialihkan), unduh satu file produk, dan kirim email uji (`ops/check-alerts.sh --test-email`).
4. **Alihkan DNS**: ubah A/AAAA `hayatun.my.id` ke IP server baru. Tunggu TTL (300 detik). Kalau sertifikat belum ada, terbitkan sekarang.
5. **Periksa dari luar**: `ops/check-edge.sh https://hayatun.my.id`, `sudo ops/check-server.sh`, dan buka toko dari ponsel di jaringan seluler: beranda, produk, masuk, riwayat pesanan.
6. **Pasang jadwal di server baru**: cron cadangan, cron peringatan, logrotate, dan sesuaikan monitor uptime luar bila memakai IP (`docs/operasi.md` langkah 8, `docs/pemantauan.md`). Jalankan satu cadangan dengan tangan dan pastikan `ok`.

Waktu henti = langkah 2 + 3 + TTL DNS. Selama jendela itu pembeli melihat toko tidak tersedia; pesanan tidak hilang karena penulisan sudah dihentikan sebelum cadangan akhir.

## Jalan kembali

| Keadaan | Tindakan |
|---|---|
| Gagal sebelum DNS dialihkan | Nyalakan lagi server lama (`sudo -u hayatun pm2 start hayatun-web hayatun-api`). Tidak ada yang berubah. |
| Gagal sesudah DNS dialihkan, **belum ada pesanan baru** di server baru | Kembalikan DNS ke server lama dan nyalakan aplikasinya. |
| Sudah ada pesanan atau unggahan di server baru | **Jangan kembali**: data baru itu tidak ada di server lama. Perbaiki ke depan di server baru. |

Server lama tetap hidup dengan aplikasi mati (jangan dihapus) selama **14 hari**, supaya ada salinan terakhir dan jalan kembali pada jam-jam pertama.

## Langkah 4. Setelah pindah

- **Hari pertama dan ketiga**: cadangan malam di server baru `ok`; email peringatan uji sampai; monitor luar hijau; catatan aktivitas dan antrean normal.
- Email `PULIH: os` tiba (peringatan akhir dukungan hilang); `PERIKSA os-didukung` berubah `LULUS`.
- Naikkan kembali TTL DNS ke nilai biasa.
- Perbarui `docs/ARCHITECTURE.md` (baris Sistem operasi dan K10) dan `docs/server-hardening.md` bila ada langkah yang ternyata berbeda.
- Setelah 14 hari: matikan server lama. **Putuskan aksesnya dulu**: cabut kunci SSH dan kunci akses bucket cadangan yang dipakai server lama (buat yang baru untuk server baru), lalu hapus diskusnya lewat penyedia. Cadangan yang sudah ada di bucket tetap berlaku.
- Catat lama pemindahan sebenarnya di catatan uji pulih (N23).

## Yang tidak dicakup

Pembaruan versi besar PostgreSQL, Node, atau aplikasi sekaligus: jangan digabung dengan migrasi OS. Pindahkan dengan versi yang sama dulu; ubah satu hal per waktu.
