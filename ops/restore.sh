#!/bin/bash
# Pulihkan cadangan (T59; N23). Pemakaian:
#   ops/restore.sh --identity KUNCI_PRIVAT_AGE --database postgres://... --files-dir FOLDER [--name hayatun-...tar.age | --name latest]
# Tujuan harus KOSONG (database tanpa tabel, folder file kosong atau belum ada); skrip menolak menimpa apa pun.
# Kunci privat age diberikan saat pemulihan, tidak disimpan di server. Konfigurasi penyimpanan dibaca dari shared/.env.
# Kode keluar: 0 berhasil, 1 gagal (arsip rusak, kunci salah, pulih gagal), 2 pemakaian atau prasyarat.
set -u -o pipefail
umask 077

ROOT="${HAYATUN_ROOT:-/srv/hayatun}"
SHARED="$ROOT/shared"
IDENTITY=""; DATABASE=""; FILES=""; NAME="latest"
usage() { echo "Pemakaian: ops/restore.sh --identity BERKAS_KUNCI --database postgres://... --files-dir FOLDER [--name latest|hayatun-<stempel>.tar.age]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --database) DATABASE="${2:-}"; shift 2 ;;
    --files-dir) FILES="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$IDENTITY" ] && [ -n "$DATABASE" ] && [ -n "$FILES" ] || usage
[ -r "$IDENTITY" ] || { echo "Berkas kunci privat $IDENTITY tidak ada atau tidak terbaca." >&2; exit 2; }
[[ "$NAME" == latest || "$NAME" =~ ^hayatun-[0-9]{8}T[0-9]{6}Z\.tar\.age$ ]] || { echo "Nama arsip tidak sah: harus latest atau hayatun-<stempel>.tar.age" >&2; exit 2; }
for c in age rclone pg_restore psql tar sha256sum; do command -v "$c" >/dev/null 2>&1 || { echo "Perintah $c tidak terpasang." >&2; exit 2; }; done

[ -r "$SHARED/.env" ] || { echo "$SHARED/.env tidak ada atau tidak terbaca (butuh pengaturan penyimpanan cadangan)." >&2; exit 2; }
set -a; . "$SHARED/.env"; set +a
for v in BACKUP_TARGET_ENDPOINT BACKUP_TARGET_BUCKET BACKUP_TARGET_ACCESS_KEY_ID BACKUP_TARGET_SECRET_ACCESS_KEY; do [ -n "${!v:-}" ] || { echo "$v belum diatur." >&2; exit 2; }; done
export RCLONE_CONFIG_HAYATUNBACKUP_TYPE=s3 RCLONE_CONFIG_HAYATUNBACKUP_PROVIDER=Other RCLONE_CONFIG_HAYATUNBACKUP_ENV_AUTH=false
export RCLONE_CONFIG_HAYATUNBACKUP_ENDPOINT="$BACKUP_TARGET_ENDPOINT" RCLONE_CONFIG_HAYATUNBACKUP_ACCESS_KEY_ID="$BACKUP_TARGET_ACCESS_KEY_ID" RCLONE_CONFIG_HAYATUNBACKUP_SECRET_ACCESS_KEY="$BACKUP_TARGET_SECRET_ACCESS_KEY"
REMOTE="hayatunbackup:$BACKUP_TARGET_BUCKET/hayatun"

pg_env() {
  local u="$1"
  [[ "$u" =~ ^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]] || return 1
  export PGUSER="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}" PGDATABASE="${BASH_REMATCH[8]}"
  local pw="${BASH_REMATCH[4]:-}"; export PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
}
pg_env "$DATABASE" || { echo "Alamat database tidak sah (postgres://user:sandi@host:port/nama)." >&2; exit 2; }

# ---- pilih arsip ----
listing="$(rclone lsf "$REMOTE/" 2>/dev/null | grep -E '^hayatun-[0-9]{8}T[0-9]{6}Z\.tar\.age$' | sort)"
[ -n "$listing" ] || { echo "Belum ada cadangan di penyimpanan ($REMOTE)." >&2; exit 2; }
if [ "$NAME" = latest ]; then NAME="$(printf '%s\n' "$listing" | tail -n1)"
else printf '%s\n' "$listing" | grep -qxF "$NAME" || { echo "Arsip $NAME tidak ada di penyimpanan." >&2; exit 2; }; fi

# ---- tujuan harus kosong, diperiksa sebelum mengunduh apa pun ----
tables="$(psql -Atq -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')" 2>/dev/null)" || { echo "Tidak bisa terhubung ke database tujuan." >&2; exit 2; }
[ "$tables" = 0 ] || { echo "Database tujuan tidak kosong ($tables tabel). Pakai database baru." >&2; exit 2; }
if [ -d "$FILES" ] && [ -n "$(ls -A "$FILES")" ]; then echo "Folder file tujuan $FILES tidak kosong." >&2; exit 2; fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "Memulihkan $NAME"
rclone copyto "$REMOTE/$NAME" "$tmp/$NAME" || { echo "Gagal mengunduh arsip." >&2; exit 1; }
rclone copyto "$REMOTE/$NAME.sha256" "$tmp/$NAME.sha256" || { echo "Gagal mengunduh sidecar sha256." >&2; exit 1; }
(cd "$tmp" && sha256sum -c "$NAME.sha256" >/dev/null 2>&1) || { echo "sha256 arsip tidak cocok: arsip rusak atau berubah. Tidak ada yang dipulihkan." >&2; exit 1; }

mkdir "$tmp/x"
age -d -i "$IDENTITY" "$tmp/$NAME" 2>"$tmp/age.err" | tar -x -C "$tmp/x" || { echo "Dekripsi gagal (kunci privat salah?). Tidak ada yang dipulihkan." >&2; exit 1; }
[ -s "$tmp/x/db.dump" ] && [ -s "$tmp/x/files.tar" ] && [ -s "$tmp/x/MANIFEST" ] || { echo "Isi arsip tidak lengkap." >&2; exit 1; }
(cd "$tmp/x" && grep -E ' (db\.dump|files\.tar)$' MANIFEST | sha256sum -c >/dev/null 2>&1) || { echo "MANIFEST tidak cocok dengan isi arsip." >&2; exit 1; }

pg_restore --no-owner --exit-on-error --single-transaction -d "$PGDATABASE" "$tmp/x/db.dump" || { echo "pg_restore gagal; database tetap kosong (satu transaksi)." >&2; exit 1; }
mkdir -p "$FILES" && tar -x -C "$FILES" -f "$tmp/x/files.tar" || { echo "Database sudah pulih tetapi file gagal diekstrak ke $FILES." >&2; exit 1; }

echo "Selesai: database dan $(find "$FILES" -type f | wc -l) file dipulihkan dari $NAME"
