# Pemindaian keamanan: OWASP ZAP baseline dan audit dependensi (T61)

Memenuhi N7 (0 temuan tinggi/kritis sebelum rilis tahap 1) dan N34 (komponen pihak ketiga tinggi/kritis dipasang ≤ 30 hari).

## Yang dicakup dan yang tidak

ZAP baseline hanya mengamati secara **pasif**: merayapi tautan dari beranda dan memeriksa jawaban (header, cookie, isi) tanpa menyerang. Ia **tidak** mencakup:

- halaman yang butuh login (pembeli, admin): dicakup tes otorisasi dan e2e (T51), bukan ZAP;
- serangan aktif (injeksi, XSS yang dicoba dengan data): tidak dijalankan, dan tidak boleh dijalankan ke produksi tanpa sepengetahuan pemilik;
- logika bisnis (mis. pesanan orang lain): tes otorisasi.

Jadi "ZAP bersih" berarti tidak ada kelemahan pasif tingkat tinggi, bukan "aman".

## Menjalankan

Butuh `docker` dan `jq` (`dnf install jq`).

```
ops/zap-baseline.sh https://staging.hayatun.my.id
```

Hanya `hayatun.my.id`, `www.`, `staging.` (https), dan `127.0.0.1`/`localhost` (http) yang diterima, supaya skrip tidak bisa dipakai memindai situs orang lain. Laporan ada di `./zap-report/zap.html` dan `zap.json` (atur dengan `ZAP_REPORT_DIR`).

Kode keluar: `0` tidak ada temuan tinggi, `1` ada, `2` galat (Docker/jq tidak ada, ZAP galat, laporan hilang atau rusak). Galat tidak pernah dihitung lulus.

Keluaran: `TINGGI` menggagalkan; `SEDANG` tidak menggagalkan tetapi harus dibaca dan, bila nyata, dicatat di TODO; `DIABAIKAN` adalah temuan tinggi yang diterima di `ops/zap-ignore.txt`.

## Dua tempat berjalan

| Tempat | Sasaran | Mencakup |
| --- | --- | --- |
| CI, job `zap` (tiap PR) | aplikasi produksi di runner, `http://127.0.0.1:3000` | header aplikasi, cookie, isi halaman; **tidak** HTTPS/HSTS |
| Staging atau produksi (dijalankan pemilik sebelum rilis tahap 1) | `https://staging.hayatun.my.id` lewat Nginx sungguhan | semuanya di atas, plus HTTPS, HSTS, header Nginx |

Pemindaian staging adalah yang dihitung untuk N7. Simpan `zap.html` hasilnya bersama catatan rilis.

## Mengabaikan temuan

`ops/zap-ignore.txt`, satu baris per temuan: `<id plugin ZAP> <alasan, tanggal, siapa yang memeriksa>`. Alasan wajib (skrip menolak baris tanpa alasan) dan hanya berlaku untuk temuan tinggi. Pakai hanya untuk positif palsu yang sudah diperiksa, bukan untuk menunda perbaikan. Berkas ini kosong saat ini.

## Citra ZAP

`ops/zap-baseline.sh` memakai citra `ghcr.io/zaproxy/zaproxy` yang **dikunci dengan digest**, supaya tag `stable` yang berpindah tidak mengubah hasil diam-diam. Akibatnya aturan ZAP lama lama-kelamaan tertinggal: perbarui digest tiap kuartal (`docker buildx imagetools inspect ghcr.io/zaproxy/zaproxy:stable`), jalankan ulang, lalu periksa temuan baru. Untuk mencoba citra lain tanpa mengubah skrip: `ZAP_IMAGE=... ops/zap-baseline.sh ...`.

## Audit dependensi (N34)

```
npm audit --audit-level=high
```

Berjalan di CI pada job `test` dan memblokir PR bila ada temuan tinggi/kritis. Keadaan saat ini: 0 tinggi/kritis; 4 temuan sedang pada `esbuild` lewat `drizzle-kit` (alat pengembangan; `npm audit --omit=dev` melaporkan 0 temuan). Perbaikannya butuh pembaruan besar `drizzle-kit` dan tidak diwajibkan N34 (hanya tinggi/kritis); dipantau, bukan diabaikan.
