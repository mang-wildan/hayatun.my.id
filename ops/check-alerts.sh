#!/bin/bash
# Pemeriksa dan pengirim peringatan di server (T60; ARCHITECTURE bagian 8; N22, N23, N25, F11.4). Jalankan tiap jam lewat cron:
#   0 * * * * /srv/hayatun/repo/ops/check-alerts.sh >> /srv/hayatun/shared/logs/alerts.cron.log 2>&1
# Memeriksa: disk, cadangan terakhir (T59), sertifikat TLS, tugas pg-boss gagal, email gagal, dan /api/health API dan web dari dalam server.
# Mengirim SATU email per masalah ke ADMIN_ALERT_EMAIL lewat SMTP aplikasi (curl); diulang tiap 24 jam selama masih bermasalah, dan satu email PULIH.
# Pemantau uptime dari LUAR server tetap diperlukan: skrip ini tidak bisa memberi tahu bahwa servernya sendiri mati (docs/pemantauan.md).
#   ops/check-alerts.sh --test-email   kirim satu surel uji untuk memastikan jalur SMTP berfungsi
# Kode keluar: 0 tidak ada masalah, 1 ada masalah (atau surel gagal terkirim), 2 konfigurasi.
set -u
umask 077

ROOT="${HAYATUN_ROOT:-/srv/hayatun}"
SHARED="$ROOT/shared"
STATE="$SHARED/alerts.state"
DISK_MAX_PCT="${DISK_MAX_PCT:-80}"; BACKUP_MAX_HOURS="${BACKUP_MAX_HOURS:-26}"; TLS_MIN_DAYS="${TLS_MIN_DAYS:-14}"
EMAIL_FAIL_MAX="${EMAIL_FAIL_MAX:-5}"; REPEAT_SECONDS="${REPEAT_SECONDS:-86400}"
TEST_EMAIL=0
case "${1:-}" in --test-email) TEST_EMAIL=1 ;; "") ;; *) echo "Pemakaian: ops/check-alerts.sh [--test-email]" >&2; exit 2 ;; esac

die() { echo "$*" >&2; exit 2; }
[ -r "$SHARED/.env" ] || die "$SHARED/.env tidak ada atau tidak terbaca."
mode="$(stat -c %a "$SHARED/.env" 2>/dev/null)"
[[ "$mode" =~ 00$ ]] || die "$SHARED/.env terlalu terbuka (mode $mode, seharusnya 600)."
set -a; . "$SHARED/.env"; set +a
[ -n "${ADMIN_ALERT_EMAIL:-}" ] || die "ADMIN_ALERT_EMAIL belum diatur di shared/.env (alamat yang menerima peringatan)."
[ -n "${SMTP_HOST:-}" ] && [ -n "${EMAIL_FROM:-}" ] || die "SMTP_HOST dan EMAIL_FROM harus diatur di shared/.env."

mkdir -p -m 700 "$SHARED/tmp"
tmp="$(mktemp -d -p "$SHARED/tmp")"; trap 'rm -rf "$tmp"' EXIT
now="$(date +%s)"

# ---- kirim surel (curl SMTP); kata sandi lewat berkas netrc sementara, tidak di argumen ----
send_mail() { # subjek isi
  local msg="$tmp/pesan.eml" scheme=smtp args rc
  { printf 'From: %s\nTo: %s\nSubject: %s\nDate: %s\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\n%s\n' "$EMAIL_FROM" "$ADMIN_ALERT_EMAIL" "$1" "$(date -R)" "$2"; } > "$msg"
  [ "${SMTP_PORT:-}" = 465 ] && scheme=smtps
  args=(--silent --show-error --max-time 30 --url "$scheme://$SMTP_HOST:${SMTP_PORT:-25}" --mail-from "$EMAIL_FROM" --mail-rcpt "$ADMIN_ALERT_EMAIL" --upload-file "$msg")
  if [ -n "${SMTP_USER:-}" ]; then
    printf 'machine %s login %s password %s\n' "$SMTP_HOST" "$SMTP_USER" "${SMTP_PASSWORD:-}" > "$tmp/netrc"
    args+=(--netrc-file "$tmp/netrc" --ssl-reqd)
  fi
  curl "${args[@]}"; rc=$?
  rm -f "$tmp/netrc" "$msg"
  return $rc
}

if [ "$TEST_EMAIL" = 1 ]; then
  if send_mail "[Hayatun] UJI: peringatan email berfungsi" "Ini surel uji dari ops/check-alerts.sh di $(hostname). Bila kamu membacanya, jalur peringatan lewat SMTP berfungsi."; then echo "Surel uji terkirim ke $ADMIN_ALERT_EMAIL"; exit 0; fi
  echo "Gagal mengirim surel uji lewat SMTP $SMTP_HOST:${SMTP_PORT:-25}." >&2; exit 1
fi

exec 8>"$SHARED/alerts.lock"; flock -n 8 || { echo "Pemeriksaan lain sedang berjalan."; exit 0; }

# postgres://user:pass@host:port/db -> PG*; kata sandi lewat lingkungan, bukan argumen
pg_query() { # sql -> hasil, kode keluar 0 bila kueri berhasil
  (
    [[ "${DATABASE_MIGRATION_URL:-}" =~ ^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]] || exit 3
    export PGUSER="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}" PGDATABASE="${BASH_REMATCH[8]}"
    pw="${BASH_REMATCH[4]:-}"; export PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
    psql -X -Atq -F ' ' -c "$1" 2>/dev/null
  )
}

IDS=(disk cadangan tls tugas-gagal email-gagal api web)
declare -A PROBLEM HINT
ok_id() { PROBLEM[$1]=""; }
bad_id() { PROBLEM[$1]="$2"; HINT[$1]="$3"; }

# ---- disk ----
detail=""
for p in "$ROOT" /; do
  pct="$(df -P "$p" 2>/dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
  [[ "$pct" =~ ^[0-9]+$ ]] || { detail="$detail $p: tidak terbaca;"; continue; }
  [ "$pct" -gt "$DISK_MAX_PCT" ] && detail="$detail $p terpakai ${pct}% (batas ${DISK_MAX_PCT}%);"
done
if [ -n "$detail" ]; then bad_id disk "disk:$detail" "Hapus berkas besar atau perbesar disk. Periksa: du -sh /srv/hayatun/* /var/log/*; log lama dirotasi 90 hari (ops/logrotate/hayatun)."; else ok_id disk; fi

# ---- cadangan ----
read -r b_status b_time b_rest < "$SHARED/backup-status" 2>/dev/null || b_status=""
if [ -z "$b_status" ]; then bad_id cadangan "belum ada status cadangan (cadangan belum pernah berjalan?)" "Jalankan ops/backup.sh dengan tangan dan periksa cron (docs/operasi.md)."
elif [ "$b_status" = gagal ]; then bad_id cadangan "cadangan terakhir gagal ($b_time) pada langkah: ${b_rest:-?}" "Lihat $SHARED/backup.log dan jalankan ops/backup.sh dengan tangan."
else
  age_h=$(( (now - $(date -d "$b_time" +%s 2>/dev/null || echo 0)) / 3600 ))
  if [ "$age_h" -gt "$BACKUP_MAX_HOURS" ]; then bad_id cadangan "cadangan sukses terakhir $age_h jam lalu (batas $BACKUP_MAX_HOURS jam)" "Periksa cron cadangan dan $SHARED/backup.log."; else ok_id cadangan; fi
fi

# ---- sertifikat TLS ----
host="${APP_URL:-}"; host="${host#*://}"; host="${host%%/*}"; host="${host%%:*}"
if [[ "${APP_URL:-}" != https://* ]] || [[ "$host" == localhost || "$host" == 127.* ]]; then ok_id tls
else
  end="$(echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
  end_s="$(date -d "$end" +%s 2>/dev/null)"
  if [ -z "$end" ] || [ -z "$end_s" ]; then bad_id tls "sertifikat TLS tidak bisa diperiksa (gagal tersambung ke $host:443)" "Periksa situs dan Nginx; lalu perpanjang sertifikat di aaPanel."
  else
    days=$(( (end_s - now) / 86400 ))
    if [ "$days" -lt "$TLS_MIN_DAYS" ]; then bad_id tls "sertifikat TLS habis dalam $days hari (batas $TLS_MIN_DAYS hari)" "Perpanjang sertifikat Let's Encrypt di aaPanel (perpanjangan otomatis mungkin gagal)."; else ok_id tls; fi
  fi
fi

# ---- antrean pg-boss ----
jobs="$(pg_query "select name || ' (' || count(*) || ')' from pgboss.job where state = 'failed' and name <> 'email.send' and completed_on > now() - interval '65 minutes' group by name order by name")"; rc_jobs=$?
if [ "$rc_jobs" -ne 0 ]; then bad_id tugas-gagal "tidak bisa memeriksa antrean (database tidak terhubung atau skema pgboss tidak ada)" "Periksa PostgreSQL dan DATABASE_MIGRATION_URL di shared/.env."
elif [ -n "$jobs" ]; then bad_id tugas-gagal "tugas gagal setelah semua percobaan ulang dalam satu jam terakhir: $(echo "$jobs" | tr '\n' ' ')" "Lihat log API (pm2 logs hayatun-api) dan tabel pgboss.job (state = 'failed')."
else ok_id tugas-gagal; fi

nfail="$(pg_query "select count(*) from pgboss.job where name = 'email.send' and state = 'failed' and completed_on > now() - interval '60 minutes'")"; rc_mail=$?
if [ "$rc_mail" -ne 0 ] || ! [[ "$nfail" =~ ^[0-9]+$ ]]; then bad_id email-gagal "tidak bisa memeriksa antrean email (database tidak terhubung)" "Periksa PostgreSQL dan DATABASE_MIGRATION_URL di shared/.env."
elif [ "$nfail" -gt "$EMAIL_FAIL_MAX" ]; then bad_id email-gagal "$nfail email gagal terkirim dalam 1 jam terakhir (batas $EMAIL_FAIL_MAX)" "Periksa SMTP (SMTP_HOST, kredensial) dan pm2 logs hayatun-api. Perhatikan: peringatan ini ikut gagal bila SMTP yang bermasalah."
else ok_id email-gagal; fi

# ---- kesehatan layanan dari dalam server ----
if curl -fsS --max-time 5 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then ok_id api; else bad_id api "API (127.0.0.1:4000/api/health) tidak sehat" "pm2 status; pm2 logs hayatun-api; pertimbangkan ops/deploy.sh --rollback."; fi
if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok_id web; else bad_id web "web (127.0.0.1:3000/api/health) tidak sehat" "pm2 status; pm2 logs hayatun-web; pertimbangkan ops/deploy.sh --rollback."; fi

# ---- laporan, dedup, dan pengiriman ----
declare -A FIRST LAST
if [ -r "$STATE" ]; then while read -r sid sfirst slast; do [ -n "$sid" ] && FIRST[$sid]="$sfirst" && LAST[$sid]="$slast"; done < "$STATE"; fi
mail_failed=0; problems=0
for id in "${IDS[@]}"; do
  if [ -n "${PROBLEM[$id]}" ]; then
    problems=$((problems + 1)); printf 'MASALAH  %-12s %s\n' "$id" "${PROBLEM[$id]}"
    if [ -z "${FIRST[$id]:-}" ] || [ $((now - ${LAST[$id]:-0})) -ge "$REPEAT_SECONDS" ]; then
      body="Server: $(hostname)
Waktu: $(date -R)
Masalah: ${PROBLEM[$id]}

Yang perlu dilakukan: ${HINT[$id]}

Peringatan ini dikirim sekali, lalu diulang tiap 24 jam selama masalahnya ada, dan satu email PULIH saat hilang."
      if send_mail "[Hayatun] PERINGATAN: $id - ${PROBLEM[$id]:0:60}" "$body"; then FIRST[$id]="${FIRST[$id]:-$now}"; LAST[$id]="$now"
      else mail_failed=1; printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$id" "${PROBLEM[$id]}" >> "$SHARED/alerts.log"; fi
    fi
  else
    printf 'LULUS    %-12s baik\n' "$id"
    if [ -n "${FIRST[$id]:-}" ]; then
      if send_mail "[Hayatun] PULIH: $id" "Server: $(hostname)
Waktu: $(date -R)
Masalah \"$id\" sudah hilang. Tidak ada tindakan lagi."; then unset 'FIRST[$id]' 'LAST[$id]'; else mail_failed=1; fi
    fi
  fi
done
: > "$STATE"; for id in "${!FIRST[@]}"; do printf '%s %s %s\n' "$id" "${FIRST[$id]}" "${LAST[$id]:-0}" >> "$STATE"; done

echo
echo "Hasil: $(( ${#IDS[@]} - problems )) baik, $problems masalah"
[ "$mail_failed" = 1 ] && echo "PERINGATAN: ada email yang gagal terkirim lewat SMTP; dicatat di $SHARED/alerts.log dan dicoba lagi pada pemeriksaan berikutnya." >&2
[ "$problems" -eq 0 ] && [ "$mail_failed" -eq 0 ]
