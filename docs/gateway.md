# Payment gateway (T64, T65)

Pembayaran online (virtual account, e-wallet) sebagai jalur tambahan di samping transfer bank (F14, N36). Jalur transfer manual tidak berubah.

> **Status: hanya penyedia tiruan (`fake`) yang ada dan teruji.** Adaptor untuk gateway sungguhan belum ditulis karena penyedianya belum dipilih (SPEC pertanyaan terbuka 7). Produksi **menolak** `PAYMENT_GATEWAY_PROVIDER=fake`. Selama bawaan `none`, opsi bayar online tidak muncul di mana pun dan rute webhook mengembalikan 404.

## Konfigurasi (`shared/.env`)

| Variabel | Arti |
|---|---|
| `PAYMENT_GATEWAY_PROVIDER` | `none` (bawaan) atau `fake` (hanya pengembangan dan tes) |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | batas waktu membuat tautan bayar, maksimal 5000 |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | rahasia tanda tangan webhook, minimal 32 karakter, wajib bila penyedia bukan `none` |

## Alur

1. **Checkout** dengan `paymentMethod: "gateway"`: pesanan dibuat seperti biasa (stok ditahan, batas bayar 24 jam), lalu tautan bayar `https` diminta dari gateway. Hanya nomor invoice, nominal, batas waktu, id pesanan, dan tautan kembali yang dikirim ke gateway; tidak ada nama, HP, alamat, atau email. Gagal atau lambat: pesanan tetap ada, pembeli bisa **Coba lagi** dari halaman pesanan (`POST /api/orders/:id/payment/gateway`, idempoten).
2. **Webhook** `POST /api/webhooks/gateway` dari gateway: tanda tangan diperiksa lebih dulu, lalu kejadian disimpan dan diproses dalam satu transaksi (`payment_events`, ID kejadian unik = tepat satu kali).

| Kejadian sukses untuk pesanan | Hasil |
|---|---|
| gateway, Menunggu Pembayaran, nominal sama | **Lunas** (kode lisensi, stok terjual, email pembeli); tercatat "Lunas via gateway" di log aktivitas |
| nominal berbeda | tidak Lunas; **ditandai "Perlu diperiksa"** |
| sudah Kedaluwarsa, Dibatalkan, Dikembalikan | tetap; **ditandai**; stok dan kode tidak ditetapkan |
| sudah Lunas (ID kejadian lain) | tidak berubah; **ditandai** (kemungkinan bayar dua kali) |
| pesanan transfer manual | tidak pernah Lunas; **ditandai** |
| referensi tidak dikenal | dicatat, dijawab 200 |
| gagal, kedaluwarsa, tertunda dari gateway | dicatat dan diabaikan; kedaluwarsa ditentukan jam kita sendiri (F14.7) |

Pesanan yang ditandai muncul dengan "Perlu diperiksa" di daftar pesanan admin, dengan alasannya, dan semua admin dikirimi email `Pembayaran gateway perlu diperiksa`. **Tidak ada tombol selesaikan atau refund di aplikasi**: urus uang di dasbor gateway, tangani pesanannya lewat pembatalan admin bila perlu. Tandanya tetap sebagai catatan.

Pesanan yang masih Menunggu Pembayaran saat kejadian sukses tiba diterima walau jam batas sudah lewat dan penyapu belum jalan (stok masih ditahan, pembeli sudah membayar).

## Keamanan webhook

- Satu-satunya pengendali akses adalah **tanda tangan**; tidak ada daftar IP. Rahasianya sepanjang dan seacak kunci lain (`openssl rand -base64 48`) dan disimpan seperti kunci aplikasi lainnya.
- Tanda tangan diperiksa sebelum badan dibaca; perbandingan dengan waktu tetap. Tidak ada jendela waktu (replay): kejadian lama yang sah tidak berbahaya karena ID kejadian unik.
- Hanya empat bidang (`eventId`, `type`, `reference`, `amount`) yang disimpan; data pembeli dari gateway dibuang.
- Rute ini melewati pemeriksaan `Origin` (server ke server). Nginx meneruskannya lewat `/api/` seperti biasa.

## Menambah gateway sungguhan

Satu berkas adaptor yang memenuhi `GatewayProvider` (`modules/gateway/index.ts`): `createTransaction` (buat tautan bayar) dan `verifyWebhook` (periksa tanda tangan dengan skema gateway itu, lalu normalisasi ke `{eventId, type, reference, amount}`), dipilih lewat `PAYMENT_GATEWAY_PROVIDER`. Yang perlu dicek per gateway: aturan kedaluwarsa tautan, bidang wajib (sebagian butuh email pembeli: ini perlu keputusan privasi, N31), cara mencoba ulang webhook, dan sandbox. **Jangan menyalakan penyedia sungguhan sebelum adaptornya ada dan diuji di sandbox gateway.**
