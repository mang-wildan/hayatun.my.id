# TODO — Toko Hayatun

Sumber: [`docs/SPEC.md`](docs/SPEC.md) (F#, N#) · [`docs/DESIGN.md`](docs/DESIGN.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Rencana rinci: [`docs/superpowers/plans/`](docs/superpowers/plans/)

**Aturan item**

- Satu item = satu sesi kerja = satu PR.
- Kerjakan berurutan dari atas ke bawah. Item hanya bergantung pada item di atasnya.
- Item selesai bila perintah **Selesai jika** berhasil (exit 0) dan CI hijau. Item fase 1 sudah punya langkah rinci di [Rencana 1](docs/superpowers/plans/2026-10-26-01-fondasi-dan-akun.md). Item fase 2–8 akan dirinci di rencananya masing-masing sebelum dikerjakan.

**Saran model dan effort**

| Label | Model | Effort | Dipakai untuk |
|-------|-------|--------|---------------|
| **A** | Opus 5.5 | high | Keamanan, uang, stok, konkurensi, privasi, pengamanan server. Kesalahan di sini mahal dan sulit terlihat. |
| **B** | Sonnet 5.5 | medium | Fitur biasa: API CRUD, halaman, email, tes e2e. |
| **C** | Sonnet 5.5 | low | Kerangka, konfigurasi, dokumen, perubahan mekanis. |

Reviewer setiap PR memakai **Opus 5.5 / high**. Review akhir per fase juga memakai Opus 5.5, dengan effort **xhigh** untuk fase 1, 3, 4, dan 7.

---

## Fase 1 — Fondasi dan akun

- [x] **T01 Monorepo dan formatter Rupiah/WIB** — N33 · **C**
  Selesai jika: `npx vitest run --project shared && npm run typecheck`
- [x] **T02 Skema validasi akun dengan pesan santai** — F1, N3, N10 · **C**
  Selesai jika: `npx vitest run packages/shared/src/schemas/auth.test.ts`
- [x] **T03 Kerangka API: config, log tersamar, error, health, database, antrean, hak database audit** — N22, N30, F15.4 · **B**
  Selesai jika: `npm -w apps/api run db:migrate && npx vitest run apps/api/src/config.test.ts apps/api/src/logger.test.ts apps/api/src/modules/health apps/api/src/db/roles.test.ts`
- [x] **T04 Enkripsi field, rotasi kunci, blind index** — F12.1, N2 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/crypto`
- [x] **T05 Password Argon2id dan daftar password umum** — N3 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/password.test.ts`
- [x] **T06 Token sekali pakai dan log aktivitas dasar** — F1.3, F1.7, F15.3 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/tokens.test.ts apps/api/src/modules/audit`
- [x] **T07 Sesi server, diam 30 menit untuk admin, pemeriksa akses** — N4, N6, F15.5 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/sessions.test.ts`
- [x] **T08 Email lewat antrean dengan retry** — F11.4, N20 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/notifications apps/api/src/jobs`
- [x] **T09 Daftar dan verifikasi email** — F1.1, F1.2, F1.6, F1.7 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/register.test.ts`
- [x] **T10 Login, logout, penguncian 5×/15 menit** — F1.8, N4 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/login.test.ts`
- [x] **T11 Lupa dan reset password** — F1.3, F1.7 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/reset.test.ts`
- [x] **T12 TOTP: opsional pembeli, wajib admin** — F1.4, F15.2 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/auth/totp.test.ts`
- [x] **T13 Admin pertama lewat undangan** — F15.1 · **B**
  Selesai jika: `npx vitest run apps/api/src/scripts/bootstrap-admin.test.ts`
- [x] **T14 Token desain, bar atas toko, kerangka admin** — N11, N12, N13, N16 · **B**
  Selesai jika: `npm run test:e2e -- a11y session`
- [x] **T15 Halaman daftar, masuk, kode, reset, keamanan, undangan admin** — F1, N14, N15 · **B**
  Selesai jika: `npm run test:e2e -- auth admin`
- [x] **T16 CI dan Dependabot** — N33, N34 · **C**
  Selesai jika: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e && npm audit --audit-level=high`

## Fase 2 — Katalog dan produk

- [x] **T17 Penyimpanan file privat dan pemeriksaan jenis file dari isinya** — N5 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/storage`
- [x] **T18 API kelola produk: berat wajib, tanpa hapus permanen, harga** — F9.1, F9.2, F9.6, F9.8, F9.9 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/products/products.test.ts`
- [x] **T19 Stok, kode lisensi massal, tolak duplikat, angka tersedia/ditahan/terjual** — F9.3, F9.4, F9.7 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/products/stock.test.ts`
- [x] **T20 Email peringatan stok rendah (≤ 3)** — F9.5, F11.2 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/products/low-stock.test.ts`
- [x] **T21 API katalog publik dan status Habis** — F2.1, F2.2, F2.3 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/catalog`
- [x] **T22 Halaman admin produk: formulir, sampul, file, kode lisensi** — F9, N15 · **B**
  Selesai jika: `npm run test:e2e -- admin-products`
- [x] **T23 Halaman katalog dan detail produk: kisi 2/3/4, sampul 4:5** — F2, N11, N17 · **B**
  Selesai jika: `npm run test:e2e -- catalog a11y`

## Fase 3 — Keranjang, ongkir, checkout, invoice

- [ ] **T24 Keranjang: API dan halaman, item nonaktif atau habis ditandai** — F2.4, F3.1 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/cart && npm run test:e2e -- cart`
- [x] **T25 Mesin status pesanan dan enum bersama** — N33, N36 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/orders/state-machine.test.ts --coverage` dengan cakupan cabang 100% untuk `state-machine.ts`
- [ ] **T26 Adaptor ongkir dan tiruannya: batas 5 detik, wilayah tidak dilayani, data terbatas** — F3.2, F3.6, F3.7, N19, N27 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/shipping`
- [ ] **T27 Alamat pembeli terenkripsi, tidak diminta untuk keranjang digital** — F3.3, F12.1, N27 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/addresses`
- [ ] **T28 Checkout: kunci harga, tahan stok dan lisensi, wajib email terverifikasi, uji bersamaan** — F1.1, F1.2, F3.4, F3.5, F3.8, F3.9, N24 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/checkout`
- [ ] **T29 Nomor invoice berurutan per bulan dan data invoice tanpa PPN, akses hanya pemilik/admin** — F6.1, F6.2, F6.3, F6.5, F6.6 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/invoices`
- [ ] **T30 Halaman checkout: Keranjang → Pengiriman → Bayar, maksimal 5 layar** — F3, N8 · **B**
  Selesai jika: `npm run test:e2e -- checkout`
- [ ] **T31 Halaman invoice siap cetak** — F6.4 · **B**
  Selesai jika: `npm run test:e2e -- invoice`

## Fase 4 — Pembayaran manual dan verifikasi

- [ ] **T32 Instruksi bayar: rekening, total, batas 24 jam** — F4.1, F4.2 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/payments-manual/instructions.test.ts`
- [ ] **T33 Unggah bukti: maks. 5 MB, JPG/PNG/PDF dari isi file, dienkripsi, tolak bila kedaluwarsa** — F4.3, F4.7, F4.8, N21 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/payments-manual/upload.test.ts`
- [ ] **T34 Kedaluwarsa otomatis, pengingat 3 jam, batal oleh pembeli, mengejar tugas tertinggal** — F4.4, F4.5, F4.6, N25 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/jobs/expiry.test.ts`
- [ ] **T35 API verifikasi: terima/tolak, alasan wajib, tambahan 24 jam, dua admin bersamaan, pembukaan bukti dicatat** — F5.1–F5.7, N24, N28 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/payments-manual/verify.test.ts`
- [ ] **T36 Halaman instruksi bayar dan unggah bukti, nomor bisa disalin** — F4, N8, N21 · **B**
  Selesai jika: `npm run test:e2e -- payment`
- [ ] **T37 Halaman antrean verifikasi: layar penuh di HP, panel samping di PC** — F5, N9 · **B**
  Selesai jika: `npm run test:e2e -- admin-verify`
- [ ] **T38 Email pesanan ke pembeli dan bukti baru ke admin, tanpa data sensitif** — F11.1, F11.2, F11.3 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/notifications/order-emails.test.ts`

## Fase 5 — Pengiriman dan pengelolaan pesanan

- [ ] **T39 Penetapan lisensi saat lunas dan lisensi tertunda** — F7.1, F7.5, F7.7 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/fulfillment-digital/licenses.test.ts`
- [ ] **T40 Token unduh 15 menit, terikat akun, dikirim lewat X-Accel-Redirect, token tidak tercatat di log** — F7.2, F7.3, F7.4, F7.6, N5, N30 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/fulfillment-digital/downloads.test.ts`
- [ ] **T41 Halaman pesanan saya dan detail: garis waktu, unduh, lisensi, resi** — F7, F8, N14 · **B**
  Selesai jika: `npm run test:e2e -- orders`
- [ ] **T42 Resi isi/ubah, email, konfirmasi diterima, Diterima otomatis 14 hari** — F8.1–F8.5 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/fulfillment-physical && npm run test:e2e -- admin-shipping`
- [ ] **T43 Pembatalan/pengembalian oleh admin, cabut akses unduh, stok kembali bila belum dikirim** — F10.1–F10.4, F7.8 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/admin-orders/cancel.test.ts`
- [ ] **T44 Daftar pesanan admin dengan filter dan ringkasan bulanan** — F13.1, F13.2 · **B**
  Selesai jika: `npx vitest run apps/api/src/modules/admin-orders/list.test.ts && npm run test:e2e -- admin-orders`

## Fase 6 — Privasi, admin, dan pengaturan

- [ ] **T45 Hapus akun: anonimkan dalam 3×24 jam, tunda bila ada pesanan aktif, invoice tetap 10 tahun** — F1.5, F12.2, F12.5, N29 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/privacy/delete-account.test.ts`
- [ ] **T46 Hapus otomatis bukti bayar setelah 1 tahun** — F12.3, N29 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/jobs/proof-retention.test.ts`
- [ ] **T47 Halaman kebijakan privasi serta syarat dan ketentuan** — F12.4, N31 · **C**
  Selesai jika: `npm run test:e2e -- legal`
- [ ] **T48 Pengaturan toko dan rekening, email ke semua admin saat rekening berubah** — F13.3, F15.7, N32 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/settings && npm run test:e2e -- admin-settings`
- [ ] **T49 Undang dan nonaktifkan admin, sesi dicabut ≤ 1 menit, admin terakhir tidak bisa menonaktifkan diri, admin bisa mematikan TOTP pembeli yang kehilangan HP (dicatat di log aktivitas)** — F15.1, F15.5, F15.6 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/admins`
- [ ] **T50 Log aktivitas lengkap untuk semua aksi admin dan pembukaan data pribadi, plus halaman log** — F15.3, F15.4, N28 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/audit && npm run test:e2e -- admin-audit`
- [ ] **T51 Uji matriks otorisasi untuk semua rute** — N6 · **A**
  Selesai jika: `npx vitest run apps/api/src/test/authorization-matrix.test.ts` (tes gagal bila ada rute terdaftar yang tidak masuk matriks)

## Fase 7 — Kualitas, operasi, dan rilis

- [ ] **T52 Aksesibilitas semua halaman di 360/768/1280 px dan alur keyboard penuh** — N11, N12, N13, N14, N15, N16 · **B**
  Selesai jika: `npm run test:e2e -- a11y keyboard`
- [ ] **T53 Uji kegunaan dengan 5 orang (checkout dan verifikasi admin)** — N8, N9 · **C**
  Selesai jika: `npm run test:e2e -- usability-steps && grep -Eq "Berhasil tanpa bantuan: [45]/5" docs/uji-kegunaan.md`
- [ ] **T54 Anggaran performa: Lighthouse CI dan uji beban 50 pengguna** — N17, N18, N20 · **B**
  Selesai jika: `npx lhci autorun && npm -w apps/api run load-test` (p95 ≤ 500 ms)
- [ ] **T55 Ketahanan saat layanan luar mati: katalog, akun, dan unduhan tetap jalan** — N26 · **A**
  Selesai jika: `npx vitest run apps/api/src/test/third-party-outage.test.ts`
- [ ] **T56 Pengamanan server: aaPanel, SSH, firewalld, SELinux, pengguna `hayatun`, PostgreSQL lokal** — N7, N34 · **A**
  Selesai jika: `sudo ops/check-server.sh` (di server)
- [ ] **T57 Nginx: TLS 1.2+, HSTS, rute `/api`, lokasi internal file, batas unggah, log tanpa query string** — N1, N5, N30 · **A**
  Selesai jika: `sudo nginx -t && ops/check-edge.sh https://hayatun.my.id`
- [ ] **T58 PM2, skrip deploy dengan health check dan rollback** — N22, N36 · **B**
  Selesai jika: `ops/deploy.sh --dry-run && curl -fsS https://hayatun.my.id/api/health`
- [ ] **T59 Cadangan harian terenkripsi ke luar server, simpan 30 hari, uji pulih** — N23, N29 · **A**
  Selesai jika: `ops/restore-test.sh` (pulih ke server kosong, lalu `/api/health` OK, dalam ≤ 8 jam)
- [ ] **T60 Logrotate 90 hari, pemantau uptime, peringatan tugas gagal, disk, dan TLS** — N22, N25, N30 · **B**
  Selesai jika: `sudo logrotate -d /etc/logrotate.d/hayatun && ops/check-alerts.sh`
- [ ] **T61 Pemindaian OWASP ZAP baseline dan audit dependensi bersih** — N7, N34 · **A**
  Selesai jika: `ops/zap-baseline.sh https://staging.hayatun.my.id && npm audit --audit-level=high`
- [ ] **T62 Panduan operasi: pasang ulang, pulihkan cadangan, ganti kunci enkripsi** — N35 · **A**
  Selesai jika: `npx vitest run apps/api/src/scripts/rotate-keys.test.ts && ops/restore-test.sh --from-docs`
- [ ] **T63 Migrasi server ke AlmaLinux 9 atau Rocky Linux 9 sebelum 31 Mei 2027** (ARCHITECTURE K10) — N34 · **A**
  Selesai jika: `grep -Eq 'AlmaLinux|Rocky' /etc/os-release && ops/check-server.sh && curl -fsS https://hayatun.my.id/api/health`

## Fase 8 — Payment gateway (tahap 2)

- [ ] **T64 Adaptor gateway dan pilihan bayar di checkout** — F14.1 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/gateway/create.test.ts && npm run test:e2e -- checkout-gateway`
- [ ] **T65 Webhook: tanda tangan, sekali proses, cek nominal, datang setelah kedaluwarsa, batas waktu** — F14.2–F14.7, N24, N36 · **A**
  Selesai jika: `npx vitest run apps/api/src/modules/gateway/webhook.test.ts`

---

## Cek cakupan

| SPEC | Item |
|------|------|
| F1 | T02, T09–T12, T15, T28, T45 |
| F2 | T21, T23, T24 |
| F3 | T24, T26–T28, T30 |
| F4 | T32–T34, T36 |
| F5 | T35, T37 |
| F6 | T29, T31 |
| F7 | T39–T41, T43 |
| F8 | T41, T42 |
| F9 | T18–T20, T22 |
| F10 | T43 |
| F11 | T08, T20, T38 |
| F12 | T04, T27, T45–T47 |
| F13 | T44, T48 |
| F14 | T64, T65 |
| F15 | T03, T06, T07, T12, T13, T48–T50 |
| N1 | T57 |
| N2, N3 | T04, T05 |
| N4 | T07, T10 |
| N5 | T17, T40, T57 |
| N6 | T07, T51 |
| N7 | T56, T61 |
| N8 | T30, T36, T53 |
| N9 | T37, T53 |
| N10 | T02 |
| N11–N16 | T14, T15, T23, T41, T52 |
| N17, N18 | T23, T54 |
| N19 | T26 |
| N20 | T08, T54 |
| N21 | T33, T36 |
| N22 | T03, T58, T60 |
| N23 | T59 |
| N24 | T28, T35, T65 |
| N25 | T34, T60 |
| N26 | T55 |
| N27 | T26, T27 |
| N28 | T35, T50 |
| N29 | T45, T46, T59 |
| N30 | T03, T40, T57, T60 |
| N31 | T47 |
| N32 | T48 |
| N33 | T01, T16, T25 |
| N34 | T16, T56, T61, T63 |
| N35 | T62 |
| N36 | T25, T58, T65 |
