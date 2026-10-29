# Uji kegunaan (T53, N8 dan N9)

Status: **belum dilakukan**. Dokumen ini berisi naskah dan lembar catatan. Hasil diisi setelah 5 orang mencoba; tidak boleh diisi dari perkiraan.

## Tujuan

- **N8.** Pembeli baru bisa dari halaman produk sampai instruksi bayar dalam 5 layar atau kurang dan 5 menit atau kurang. Minimal 4 dari 5 peserta berhasil tanpa bantuan.
- **N9.** Admin bisa memverifikasi satu bukti bayar (buka, periksa, terima atau tolak) dalam 1 menit atau kurang dan 3 klik atau kurang dari antrean.

Bagian otomatisnya (jumlah layar, klik, dan waktu ukur mesin) dijaga oleh `npm run test:e2e -- usability-steps`. Uji dengan orang mengukur hal yang tidak bisa diukur mesin: apakah orang paham tanpa dijelaskan.

## Persiapan

- Lingkungan uji dengan data contoh: satu e-book (digital), satu produk fisik, rekening tujuan sudah diisi, dan 5 bukti bayar menunggu di antrean (satu per peserta admin).
- Peserta pembeli: orang yang pernah belanja online, belum pernah memakai toko ini. Jangan beri petunjuk apa pun. Peserta admin: orang yang akan mengelola toko, atau yang mirip, belum pernah melihat panel.
- Pewawancara hanya mengamati dan mencatat. Satu pertanyaan "apa yang kamu pikirkan?" boleh diajukan; petunjuk berarti peserta dihitung **dibantu**.
- Layar: setiap peserta memakai HP-nya sendiri, minimal 2 dari 5 peserta pembeli.

## Naskah pembeli (N8)

> Kamu ingin membeli e-book "[nama produk]" dari toko ini. Mulai dari halaman produknya. Lanjutkan sampai kamu tahu ke mana harus mentransfer uangnya. Kamu tidak perlu benar-benar mentransfer.

Berhenti saat peserta menunjukkan rekening tujuan dan total. Catat per peserta:

| Peserta | Perangkat | Berhasil tanpa bantuan (ya/tidak) | Layar | Waktu (menit:detik) | Bagian yang membingungkan | Kutipan |
|---|---|---|---|---|---|---|
| P1 | | | | | | |
| P2 | | | | | | |
| P3 | | | | | | |
| P4 | | | | | | |
| P5 | | | | | | |

## Naskah admin (N9)

> Seorang pembeli baru mengunggah bukti transfer. Periksa bukti itu dan terima pembayarannya.

Dan pada putaran kedua: "Bukti yang ini buram. Tolak dan beri tahu pembeli apa yang salah." Catat per peserta:

| Peserta | Terima: klik | Terima: detik | Tolak: klik | Tolak: detik | Berhasil tanpa bantuan (ya/tidak) | Bagian yang membingungkan |
|---|---|---|---|---|---|---|
| A1 | | | | | | |
| A2 | | | | | | |
| A3 | | | | | | |
| A4 | | | | | | |
| A5 | | | | | | |

## Hasil

Diisi setelah semua peserta selesai. Baris di bawah ini dipakai pemeriksa T53; isi hanya dengan hitungan dari tabel di atas.

- Pembeli (N8), berhasil tanpa bantuan: _ dari 5 → **Berhasil tanpa bantuan: _/5** (belum diuji)
- Admin (N9), berhasil tanpa bantuan: _ dari 5

## Temuan dan perbaikan

Tulis tiap kesulitan yang dialami dua orang atau lebih, perbaikan yang dipilih, dan tautan PR-nya. Kosong sampai uji dilakukan.
