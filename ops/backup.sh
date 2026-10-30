#!/bin/bash
# Cadangan harian terenkripsi ke luar server (T59; ARCHITECTURE bagian 8, N23, N29). Dijalankan cron setiap malam sebagai pengguna hayatun.
#   pg_dump database + arsip folder file -> satu arsip dienkripsi dengan KUNCI PUBLIK age -> unggah ke penyimpanan S3 lewat rclone
#   -> verifikasi ukuran -> hapus cadangan lebih tua dari 30 hari (hanya bila unggahan terbukti baik).
# Kunci privat age tidak pernah ada di server. Kunci enkripsi aplikasi (DATA_ENCRYPTION_KEYS, BLIND_INDEX_KEY) SENGAJA tidak ikut dicadangkan.
# Konfigurasi di shared/.env: DATABASE_MIGRATION_URL, BACKUP_TARGET_{ENDPOINT,BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY}, BACKUP_ENCRYPTION_PUBLIC_KEY
# Hasil terakhir ada di shared/backup-status ("ok <waktu> <nama> <byte>" atau "gagal <waktu> <langkah>") untuk pemantauan (T60).
# Kode keluar: 0 berhasil, 1 gagal, 2 konfigurasi atau prasyarat, 3 cadangan lain sedang berjalan.
set -u -o pipefail
umask 077

ROOT="${HAYATUN_ROOT:-/srv/hayatun}"
SHARED="$ROOT/shared"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STATUS="$SHARED/backup-status"

now() { date -u +%FT%TZ; }
note() { printf '%s %s\n' "$(now)" "$*" >> "$SHARED/backup.log" 2>/dev/null; }
fail() { # langkah pesan [kode]
  echo "GAGAL pada $1: $2" >&2
  printf 'gagal %s %s\n' "$(now)" "$1" > "$STATUS" 2>/dev/null
  note "gagal pada $1: $2"
  exit "${3:-1}"
}

[ -r "$SHARED/.env" ] || fail konfigurasi "$SHARED/.env tidak ada atau tidak terbaca" 2
mode="$(stat -c %a "$SHARED/.env" 2>/dev/null)"
[[ "$mode" =~ 00$ ]] || fail konfigurasi "$SHARED/.env terlalu terbuka (mode $mode, seharusnya 600)" 2
set -a; . "$SHARED/.env"; set +a

for v in DATABASE_MIGRATION_URL BACKUP_TARGET_ENDPOINT BACKUP_TARGET_BUCKET BACKUP_TARGET_ACCESS_KEY_ID BACKUP_TARGET_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PUBLIC_KEY; do
  [ -n "${!v:-}" ] || fail konfigurasi "$v belum diatur di shared/.env" 2
done
# Hanya kunci PUBLIK age yang diterima; tanpa itu tidak ada cadangan tak terenkripsi yang pernah dibuat.
[[ "$BACKUP_ENCRYPTION_PUBLIC_KEY" =~ ^age1[a-z0-9]+$ ]] || fail konfigurasi "BACKUP_ENCRYPTION_PUBLIC_KEY bukan kunci publik age (age1...)" 2
for c in pg_dump tar age rclone sha256sum flock; do command -v "$c" >/dev/null 2>&1 || fail konfigurasi "perintah $c tidak terpasang" 2; done

FILES="${HAYATUN_FILES_DIR:-${STORAGE_DIR:-$ROOT/files}}"
[ -d "$FILES" ] || fail konfigurasi "folder file $FILES tidak ada" 2

exec 9>"$SHARED/backup.lock"
flock -n 9 || { echo "Cadangan lain sedang berjalan (kunci $SHARED/backup.lock)." >&2; exit 3; }

mkdir -p -m 700 "$SHARED/tmp"
tmp="$(mktemp -d -p "$SHARED/tmp")" || fail persiapan "tidak bisa membuat folder sementara"
trap 'rm -rf "$tmp"' EXIT # dump dan arsip tak terenkripsi tidak pernah tersisa, apa pun yang terjadi

# postgres://user:pass@host:port/db -> variabel PG*; kata sandi lewat lingkungan, bukan argumen (tidak terlihat di `ps`)
pg_env() {
  local u="$1"
  [[ "$u" =~ ^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]] || return 1
  export PGUSER="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}" PGDATABASE="${BASH_REMATCH[8]}"
  local pw="${BASH_REMATCH[4]:-}"; export PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
}

name="hayatun-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
echo "Cadangan $name"

( pg_env "$DATABASE_MIGRATION_URL" && pg_dump --format=custom --no-owner ) > "$tmp/db.dump" 2>"$tmp/pg_dump.err" || fail pg_dump "pg_dump gagal"
[ "$(head -c 5 "$tmp/db.dump")" = "PGDMP" ] || fail pg_dump "hasil pg_dump kosong atau bukan format kustom"
tar -C "$FILES" -cf "$tmp/files.tar" . || fail arsip-file "tidak bisa mengarsipkan $FILES"

{
  echo "waktu: $(now)"
  echo "jumlah_file: $(tar -tf "$tmp/files.tar" | grep -vc '/$')"
  (cd "$tmp" && sha256sum db.dump files.tar)
} > "$tmp/MANIFEST"

tar -C "$tmp" -c db.dump files.tar MANIFEST | age -r "$BACKUP_ENCRYPTION_PUBLIC_KEY" -o "$tmp/$name" || fail enkripsi "age gagal"
rm -f "$tmp/db.dump" "$tmp/files.tar" "$tmp/MANIFEST" # yang tak terenkripsi dibuang segera
(cd "$tmp" && sha256sum "$name" > "$name.sha256") || fail sha256 "tidak bisa menghitung sha256"
bytes="$(stat -c %s "$tmp/$name")"

# rclone dikonfigurasi lewat lingkungan; kredensial tidak pernah ada di argumen atau berkas konfigurasi
export RCLONE_CONFIG_HAYATUNBACKUP_TYPE=s3 RCLONE_CONFIG_HAYATUNBACKUP_PROVIDER=Other RCLONE_CONFIG_HAYATUNBACKUP_ENV_AUTH=false
export RCLONE_CONFIG_HAYATUNBACKUP_ENDPOINT="$BACKUP_TARGET_ENDPOINT" RCLONE_CONFIG_HAYATUNBACKUP_ACCESS_KEY_ID="$BACKUP_TARGET_ACCESS_KEY_ID" RCLONE_CONFIG_HAYATUNBACKUP_SECRET_ACCESS_KEY="$BACKUP_TARGET_SECRET_ACCESS_KEY"
REMOTE="hayatunbackup:$BACKUP_TARGET_BUCKET/hayatun"

rclone copyto "$tmp/$name" "$REMOTE/$name" || fail unggah "rclone gagal mengunggah arsip"
rclone copyto "$tmp/$name.sha256" "$REMOTE/$name.sha256" || fail unggah "rclone gagal mengunggah sidecar sha256"
remote_bytes="$(rclone lsjson "$REMOTE/$name" 2>/dev/null | grep -o '"Size":[0-9]*' | head -n1 | cut -d: -f2)"
[ "$remote_bytes" = "$bytes" ] || fail verifikasi "ukuran di penyimpanan ${remote_bytes:-tidak terbaca} tidak sama dengan lokal $bytes"

# Pemangkasan hanya sesudah unggahan terbukti baik, supaya cadangan lama tidak habis tanpa pengganti (N29: data terhapus hilang dari cadangan paling lama 30 hari)
warn=""
rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d" || warn=" (peringatan: pemangkasan cadangan lama gagal)"

printf 'ok %s %s %s%s\n' "$(now)" "$name" "$bytes" "$warn" > "$STATUS"
note "ok $name $bytes$warn"
echo "Selesai: $name ($bytes byte)$warn"
