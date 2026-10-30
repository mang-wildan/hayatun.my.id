# Nginx di depan Hayatun (T57)

Konfigurasi tepi untuk aaPanel/Nginx: TLS 1.2+, HSTS, rute `/api`, file privat lewat `X-Accel-Redirect`, batas unggah, batas laju untuk akun, dan log yang aman (N1, N5, N30). Pemeriksa dari luar: `ops/check-edge.sh`.

> **Status: diuji dengan nginx 1.24 (Ubuntu) di mesin pembangunan, belum di servermu.** `ops/nginx.test.ts` menjalankan nginx sungguhan dengan berkas ini. aaPanel membangun Nginx sendiri dan membuat vhost sendiri; urutan sisipan dan modul bisa berbeda. Kriteria selesai T57 adalah `sudo nginx -t && ops/check-edge.sh https://hayatun.my.id` di servermu.

## Berkas

| Berkas | Disisipkan di | Isi |
|---|---|---|
| `ops/nginx/hayatun-http.conf` | konteks `http` (sebelum vhost) | upstream web (3000) dan API (4000), TLS 1.2/1.3, `server_tokens off`, format log `hayatun`, zona batas laju |
| `ops/nginx/hayatun-server.conf` | di dalam `server { }` HTTPS | header keamanan, proxy, `X-Request-Id`, file internal, batas unggah, rute |
| `ops/nginx/hayatun-redirect.conf` | di dalam `server { }` port 80 | alihkan ke HTTPS (tanpa log) |

## Memasang di aaPanel

1. Salin `ops/nginx/` ke server, misalnya `/etc/nginx/hayatun/`. Buat folder file privat (lihat `docs/server-hardening.md`).
2. Di aaPanel buat situs `hayatun.my.id` dan pasang sertifikat Let's Encrypt (aaPanel mengurus perpanjangan).
3. Sisipkan `hayatun-http.conf` di konteks `http` (berkas konfigurasi utama Nginx aaPanel, atau `include` di `/www/server/nginx/conf/nginx.conf`).
4. Buka vhost situs (Site, Config) lalu:
   - **hapus** baris `ssl_protocols ...` milik vhost (yang di tingkat server menimpa TLS 1.2+ dari langkah 3; aaPanel kadang menyalakan TLS 1.1),
   - **hapus** blok `location` dan `proxy` bawaan yang bentrok (`location /`, `location ~ .*\.(...)$`, dan `try_files`), supaya `/` dan `/api/` tidak ganda,
   - ganti `access_log` dan `error_log` menjadi:
     ```
     access_log /www/wwwlogs/hayatun.my.id.log hayatun;
     error_log  /www/wwwlogs/hayatun.my.id.error.log error;
     ```
   - tambahkan `include /etc/nginx/hayatun/hayatun-server.conf;` di dalam blok `server` HTTPS,
   - di blok `server` port 80 ganti isinya dengan `include /etc/nginx/hayatun/hayatun-redirect.conf;` (sisakan `listen` dan `server_name`).
5. Di lingkungan API atur `STORAGE_INTERNAL_PREFIX=/_internal/files` dan `STORAGE_DIR=/srv/hayatun/files`.
6. Periksa lalu muat ulang tanpa memutus layanan:
   ```bash
   sudo nginx -t && sudo nginx -s reload
   ops/check-edge.sh https://hayatun.my.id
   ```

Kalau `nginx -t` menolak karena direktif ganda (`ssl_protocols`, `add_header`, `client_max_body_size`, `location /`), berarti masih ada sisa vhost bawaan aaPanel; hapus yang ganda, jangan kedua-duanya.

## Yang dijaga

- **TLS 1.2+ saja, HSTS 1 tahun dengan `includeSubDomains`.** Header dari hulu (helmet, Next.js) disembunyikan supaya klien menerima satu set milik Nginx.
- **File privat:** `/_internal/files/` bertanda `internal`. Hanya jawaban API ber-`X-Accel-Redirect` yang bisa mencapainya; folder `/srv/hayatun/files` dimiliki `hayatun` dan tidak berada di root web (N5).
- **Batas unggah:** bukti bayar 6 MB (API menolak > 5 MB), sampul 6 MB, file produk 512 MB (samakan dengan `PRODUCT_FILE_MAX_MB`; jika diubah di API, ubah juga di `hayatun-server.conf`), selebihnya 100 KB.
- **Batas laju:** 10 permintaan per menit per IP (burst 5) untuk masuk, daftar, lupa dan atur ulang password, kirim ulang verifikasi. Ini lapis kedua; batas per akun (F1.8) ada di aplikasi.
- **`X-Request-Id`:** dibuat Nginx per permintaan, diteruskan ke Next.js dan Express, dan dikembalikan ke klien. Kiriman klien diabaikan.
- **Log akses** (`hayatun`): alamat, waktu, id permintaan, metode, path **tanpa query string**, status, ukuran, lama. Token di `/api/downloads/<token>` tertulis `[disamarkan]`. Cookie, `Authorization`, referer, user agent, dan isi permintaan tidak dicatat (N30).
- **Berkas tersembunyi** (`/.env`, `/.git/...`) dijawab 404; `/.well-known/` tetap lewat untuk sertifikat.

## Risiko sisa yang perlu kamu tahu

- **`error_log` Nginx memuat baris permintaan lengkap** (termasuk query string dan token unduhan) saat terjadi galat hulu atau galat klien. Formatnya tidak bisa disamarkan seperti `access_log`. Karena itu `error_log` diatur ke tingkat `error`, berkasnya milik root dengan mode 640, dan dirotasi pendek (misalnya 7 hari lewat logrotate). Token unduhan berlaku singkat dan terikat pada sesi pembeli (T40), sehingga kebocoran di sana tidak bisa dipakai orang lain, tetapi jangan menyalin `error_log` ke tempat lain.
- aaPanel bisa menulis ulang vhost saat sertifikat diperbarui atau setelan situs diubah. Setelah itu jalankan `ops/check-edge.sh` lagi.
- Pengalihan port 80 tidak mencatat log sama sekali (supaya query string tidak ikut tercatat); permintaan HTTP biasa baru terlihat setelah dialihkan ke HTTPS.

## Memeriksa

```bash
ops/check-edge.sh https://hayatun.my.id
```

Memeriksa dari luar: TLS 1.2/1.3 diterima, TLS 1.0/1.1 ditolak, HTTP dialihkan, HSTS, `/api/health`, `X-Request-Id`, header keamanan, versi Nginx tidak bocor, `/_internal/files/` 404, `.env` dan `.git` 404, serta unggahan 7 MB (bukti bayar) dan 1 MB (rute biasa) ditolak 413. Pemeriksaan TLS 1.0/1.1 menjadi `PERIKSA` bila klien OpenSSL mesin itu tidak bisa mencobanya; periksa dengan `nmap --script ssl-enum-ciphers -p 443 hayatun.my.id`.

Skrip hanya mengirim GET/HEAD dan dua POST besar yang ditolak Nginx sebelum sampai ke aplikasi; tidak mengubah apa pun di situs.
