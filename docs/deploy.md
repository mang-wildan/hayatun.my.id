# Deploy dengan PM2 (T58)

`ops/deploy.sh` memasang satu rilis (tag git) di server, memigrasi database, mengalihkan, memeriksa kesehatan, dan mengembalikan rilis lama bila gagal. `ops/ecosystem.config.cjs` mendefinisikan dua proses PM2.

> **Status: diuji dengan perintah palsu (`git`, `npm`, `pm2`, `curl`) di atas folder sungguhan** (`npx vitest run ops/deploy.test.ts`). Belum dijalankan di servermu. Mulai dengan `--dry-run`.

## Tata letak (`/srv/hayatun`)

```
repo/                salinan git (clone sekali)
releases/<tag>/      satu folder per rilis
current -> releases/<tag>   rilis aktif (tautan simbolik, dipindah atomik)
shared/.env          konfigurasi dan rahasia, chmod 600, tidak ada di repo
shared/logs/         log PM2
shared/previous      nama rilis sebelumnya (untuk rollback)
shared/deploy.log    riwayat deploy (tanpa rahasia)
shared/deploy.lock   kunci: satu deploy pada satu waktu
```

Semua dimiliki pengguna `hayatun` (lihat `docs/server-hardening.md`). Node dan PM2 berjalan sebagai `hayatun`, bukan root; skrip menolak dijalankan sebagai root atau pengguna lain.

## Pemasangan pertama

```bash
sudo -u hayatun git clone <url-repo> /srv/hayatun/repo
sudo -u hayatun mkdir -p /srv/hayatun/{releases,shared/logs}
sudo -u hayatun install -m 600 /dev/null /srv/hayatun/shared/.env   # lalu isi dari .env.example
sudo -u hayatun pm2 startup                                         # ikuti perintah yang dicetaknya
```

Nilai di `shared/.env` dibaca dua cara: skrip deploy memuatnya sebagai shell (`set -a; . .env`) untuk build dan migrasi, dan `ecosystem.config.cjs` mem-parsingnya sebagai `KEY=nilai`. Karena itu: satu `KEY=nilai` per baris, nilai yang berisi spasi atau karakter khusus diberi tanda kutip, tanpa komentar di akhir baris. API menerima seluruh isinya; web hanya menerima `API_INTERNAL_URL`.

## Memakai

```bash
sudo -u hayatun /srv/hayatun/current/ops/deploy.sh --dry-run          # prasyarat saja
sudo -u hayatun /srv/hayatun/repo/ops/deploy.sh --dry-run v1.2.0       # + rencana langkah
sudo -u hayatun /srv/hayatun/repo/ops/deploy.sh v1.2.0                 # deploy
sudo -u hayatun /srv/hayatun/repo/ops/deploy.sh --rollback             # kembali ke rilis sebelumnya
```

Langkah deploy: ambil tag, `npm ci`, build, migrasi, alihkan `current`, `pm2 startOrReload` API lalu web, cek `/api/health` di 4000 dan 3000 (30 kali, jeda 2 detik). Bila salah satu langkah sebelum pengalihan gagal, rilis setengah jadi dibuang dan tidak ada yang berubah. Bila setelah pengalihan tidak sehat, `current` dikembalikan, PM2 di-reload lagi, rilis yang gagal disimpan sebagai `releases/<tag>.failed`, dan skrip keluar dengan kode 1.

Kode keluar: 0 berhasil, 1 gagal (sudah dikembalikan), 2 pemakaian atau prasyarat, 3 deploy lain berjalan, 4 KRITIS (rollback pun tidak sehat: periksa `pm2 logs` segera).

## Aturan migrasi

Rollback hanya mengembalikan kode, bukan data. Karena migrasi dijalankan sebelum pengalihan, **setiap migrasi harus kompatibel dengan kode rilis sebelumnya** (tambah kolom/tabel dulu, hapus di rilis berikutnya). Migrasi yang menghapus atau mengganti nama kolom yang masih dipakai rilis lama membuat rollback tidak sehat.

## Catatan

- `tsx` adalah devDependency yang dipakai API di produksi (`npm run start`), jadi deploy memakai `npm ci` penuh.
- Deploy otomatis dari CI lewat SSH belum dibuat; deploy dijalankan manual.
- `--dry-run` memeriksa tag di remote (`git ls-remote`) tanpa mengambil kode.
- Hanya 5 rilis terbaru yang disimpan, ditambah rilis aktif dan sebelumnya; rilis `.failed` 2 terbaru.
