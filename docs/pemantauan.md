# Pemantauan dan peringatan (T60)

Tiga lapis, karena tiap lapis buta terhadap kegagalan lapis lainnya:

| Lapis | Alat | Menangkap |
| --- | --- | --- |
| Dari luar server | Pemantau uptime (UptimeRobot, Better Stack, atau sejenisnya; pilihan pemilik) | Server mati, jaringan putus, Nginx mati, sertifikat sudah kedaluwarsa |
| Dari dalam server | `ops/check-alerts.sh` tiap jam lewat cron | Disk, cadangan, sertifikat segera habis, tugas dan email gagal, API atau web tidak sehat |
| Jejak | `logrotate` 90 hari | Bahan penyelidikan setelah kejadian |

`check-alerts.sh` tidak bisa memberi tahu bahwa servernya sendiri mati. Pemantau luar itu wajib, bukan tambahan.

## 1. Pemantau uptime dari luar (dipasang pemilik)

Buat dua monitor HTTPS, interval 1 menit:

- `https://hayatun.my.id/` (beranda, harus 200)
- `https://hayatun.my.id/api/health` (harus 200)

Atur peringatan setelah **3 kegagalan berturut-turut** (sekitar 3 menit, supaya satu paket hilang tidak membangunkan siapa pun) ke email atau ponsel pemilik. Aktifkan juga peringatan kedaluwarsa sertifikat (14 hari) bila penyedianya punya. Alamat tujuan sebaiknya BUKAN email di domain `hayatun.my.id` sendiri, supaya tetap terbaca saat surel server mati.

## 2. Peringatan dari dalam server

Tambahkan di `shared/.env` (mode 600):

```
ADMIN_ALERT_EMAIL=pemilik@contoh.id   # penerima peringatan; pakai alamat di luar domain Hayatun
```

Skrip memakai SMTP aplikasi yang sama (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`), `DATABASE_MIGRATION_URL` (baca saja `pgboss.job`), dan `APP_URL` (domain untuk pemeriksaan TLS; dilewati bila bukan `https://`).

Cron untuk pengguna `hayatun` (`crontab -e`):

```
0 * * * * /srv/hayatun/repo/ops/check-alerts.sh >> /srv/hayatun/shared/logs/alerts.cron.log 2>&1
```

Yang diperiksa dan batasnya:

| Id | Peringatan bila | Cara memperbaiki |
| --- | --- | --- |
| `disk` | pemakaian > 80% di `/srv/hayatun` atau `/` | hapus berkas besar; log dirotasi 90 hari |
| `cadangan` | status `gagal`, tidak ada status, atau sukses terakhir > 26 jam | `shared/backup.log`, jalankan `ops/backup.sh` |
| `tls` | sertifikat habis < 14 hari atau tidak terbaca | perpanjang di aaPanel |
| `tugas-gagal` | ada tugas pg-boss (selain email) gagal dalam satu jam terakhir, atau database tidak terhubung | `pm2 logs hayatun-api`, tabel `pgboss.job` |
| `email-gagal` | lebih dari 5 email gagal dalam satu jam | periksa SMTP |
| `api`, `web` | `/api/health` di 127.0.0.1:4000 atau :3000 tidak 200 | `pm2 status`, pertimbangkan `ops/deploy.sh --rollback` |

Perilaku pengiriman:

- **Satu email per masalah**, subjek `[Hayatun] PERINGATAN: <id> ...`. Selama masalah masih ada, diulang tiap 24 jam; saat hilang, satu email `[Hayatun] PULIH: <id>`. Status ada di `shared/alerts.state`.
- Bila SMTP sendiri gagal, kegagalannya dicatat di `shared/alerts.log`, status tidak diubah, dan pemeriksaan berikutnya mencoba lagi. Skrip keluar dengan kode 1.
- `email-gagal` ikut bisu bila SMTP yang rusak: peringatannya memakai jalur yang sama. Itulah alasan pemantau luar (bagian 1) dan `alerts.log` ada. Pertimbangkan saluran kedua (ntfy atau Telegram) kalau satu jalur dirasa kurang; belum dibuat.
- Kode keluar: 0 baik, 1 ada masalah atau surel gagal, 2 konfigurasi salah (mis. `ADMIN_ALERT_EMAIL` kosong, `.env` mode 644).

### Menguji

```
/srv/hayatun/repo/ops/check-alerts.sh --test-email   # satu surel berjudul "UJI"; tidak mengubah status
/srv/hayatun/repo/ops/check-alerts.sh                # semua pemeriksaan, cetak LULUS/MASALAH
```

Uji peringatan nyata sekali setelah dipasang: hentikan sementara web (`pm2 stop hayatun-web`), jalankan skrip, pastikan email PERINGATAN tiba, lalu `pm2 start hayatun-web` dan jalankan lagi untuk menerima email PULIH.

## 3. Rotasi log 90 hari

```
sudo install -m 644 /srv/hayatun/repo/ops/logrotate/hayatun /etc/logrotate.d/hayatun
sudo logrotate -d /etc/logrotate.d/hayatun    # uji kering, tidak mengubah apa pun
```

Mencakup `shared/logs/*.log` (PM2, `copytruncate`) dan log Nginx di `/www/wwwlogs/hayatun.my.id*.log` (mode 0640, `kill -USR1` ke Nginx setelah rotasi). Harian, 90 berkas, dikompres. Sesuaikan jalur Nginx dan berkas pid bila aaPanel di servermu berbeda. `error_log` Nginx memuat baris permintaan lengkap, jadi hasil rotasinya tidak boleh dibuka untuk umum (lihat `docs/nginx.md`).
