#!/bin/bash
# Uji pulih (T59; N23: pemulihan <= 8 jam, diuji tiap 3 bulan): pulihkan ke database dan folder kosong, jalankan API terhadapnya,
# periksa /api/health, lalu bandingkan lama total dengan batas RTO. Jalankan di server kosong (atau cadangan terbaru di mesin uji).
#   ops/restore-test.sh --identity KUNCI_PRIVAT --env-file BERKAS_ENV --files-dir FOLDER [--name latest] [--api-port 4000]
# BERKAS_ENV memuat konfigurasi aplikasi lengkap termasuk kunci enkripsi (yang TIDAK ada di cadangan; dari penyimpanan terpisah milik pemilik).
#   ops/restore-test.sh --from-docs   periksa docs/operasi.md terhadap skrip (bagian wajib, perintah, opsi); TIDAK memulihkan apa pun
# Kode keluar: 0 lulus, 1 gagal (pulih gagal, tidak sehat, atau melebihi RTO; atau panduan menyimpang dari skrip), 2 pemakaian atau prasyarat.
set -u -o pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
RTO_SECONDS="${RTO_SECONDS:-28800}"; HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
IDENTITY=""; ENVFILE=""; FILES=""; NAME="latest"; PORT="4000"

# Panduan yang menyimpang dari skrip adalah panduan yang gagal saat dibutuhkan (N35). Periksa tiap perintah ops/*.sh dan npm di blok bash.
check_docs() {
  local doc="${HAYATUN_DOCS_FILE:-$REPO/docs/operasi.md}" ops="${HAYATUN_OPS_DIR:-$HERE}" pass=0 bad=0 title="" cmd="" inblock=0 checked=0 line
  local -a required=("Memasang ulang dari nol" "Memulihkan" "Uji pulih" "Mengganti kunci enkripsi")
  declare -A blocks=()
  [ -r "$doc" ] || { echo "Panduan $doc tidak ada atau tidak terbaca." >&2; exit 2; }
  ok() { echo "LULUS    $*"; pass=$((pass + 1)); }
  no() { echo "GAGAL    $*"; bad=$((bad + 1)); }
  check_cmd() { # satu perintah utuh (sambungan backslash sudah digabung)
    local words w script flag name
    read -ra words <<< "$1"
    while [ "${words[0]:-}" = sudo ] || [ "${words[0]:-}" = "-u" ] || [ "${words[0]:-}" = hayatun ]; do words=("${words[@]:1}"); done
    if [[ "${words[0]:-}" =~ ^(/srv/hayatun/(repo|current)/|\./)?ops/([A-Za-z0-9_-]+\.sh)$ ]]; then
      name="${BASH_REMATCH[3]}"; script="$ops/$name"
      if [ ! -e "$script" ]; then no "perintah ops/$name: skrip tidak ada di $ops"; return; fi
      if [ ! -x "$script" ]; then no "perintah ops/$name: tidak bisa dijalankan (chmod +x)"; return; fi
      local fails=0
      for w in "${words[@]:1}"; do
        [[ "$w" =~ ^--[a-z][a-z0-9-]*$ ]] || continue
        flag="$w"; grep -qE -- "(^|[^A-Za-z0-9-])$flag([^A-Za-z0-9-]|$)" "$script" || { no "perintah ops/$name: opsi $flag tidak dikenal skrip"; fails=1; }
      done
      [ "$fails" = 0 ] && ok "perintah ops/$name"
    elif [ "${words[0]:-}" = npm ] && [ "${words[1]:-}" = -w ] && [ "${words[2]:-}" = apps/api ] && [ "${words[3]:-}" = run ]; then
      grep -qF "\"${words[4]:-}\":" "$REPO/apps/api/package.json" && ok "perintah npm run ${words[4]}" || no "perintah npm run ${words[4]:-}: skrip tidak ada di apps/api/package.json"
    fi
  }
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$inblock" = 0 ]; then
      [[ "$line" =~ ^##[[:space:]]+(.+)$ ]] && title="${BASH_REMATCH[1]}"
      if [[ "$line" =~ ^[[:space:]]*\`\`\`(bash|sh)[[:space:]]*$ ]]; then inblock=1; checked=1; blocks["$title"]=1; elif [[ "$line" =~ ^[[:space:]]*\`\`\` ]]; then inblock=1; checked=0; fi
    elif [[ "$line" =~ ^[[:space:]]*\`\`\` ]]; then inblock=0
    elif [ "$checked" = 1 ]; then
      if [[ "$line" =~ \\[[:space:]]*$ ]]; then cmd+="${line%\\} "; continue; fi
      cmd+="$line"; [ -n "${cmd// }" ] && check_cmd "$cmd"; cmd=""
    fi
  done < "$doc"
  local t found
  for t in "${required[@]}"; do
    found=0; for title in "${!blocks[@]}"; do [[ "$title" == "$t"* ]] && found=1; done
    [ "$found" = 1 ] && ok "bagian \"$t\"" || no "bagian \"$t\": tidak ada, atau tidak berisi blok perintah"
  done
  echo; echo "Hasil: $pass lulus, $bad gagal"
  [ "$bad" -eq 0 ]
  exit
}
[ "${1:-}" = "--from-docs" ] && [ $# -eq 1 ] && check_docs

usage() { echo "Pemakaian: ops/restore-test.sh --identity BERKAS_KUNCI --env-file BERKAS_ENV --files-dir FOLDER [--name latest] [--api-port 4000]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --env-file) ENVFILE="${2:-}"; shift 2 ;;
    --files-dir) FILES="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --api-port) PORT="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$IDENTITY" ] && [ -n "$ENVFILE" ] && [ -n "$FILES" ] || usage
[ -r "$ENVFILE" ] || { echo "Berkas env $ENVFILE tidak ada atau tidak terbaca." >&2; exit 2; }
for c in curl setsid npm; do command -v "$c" >/dev/null 2>&1 || { echo "Perintah $c tidak terpasang." >&2; exit 2; }; done

target_db="$(set -a; . "$ENVFILE"; printf '%s' "${DATABASE_MIGRATION_URL:-}")"
[ -n "$target_db" ] || { echo "DATABASE_MIGRATION_URL tidak ada di $ENVFILE." >&2; exit 2; }

hms() { printf '%02d:%02d:%02d' $(($1 / 3600)) $(($1 % 3600 / 60)) $(($1 % 60)); }
start="$(date +%s)"
echo "== 1. Pulihkan database dan file"
"$HERE/restore.sh" --identity "$IDENTITY" --database "$target_db" --files-dir "$FILES" --name "$NAME" || { code=$?; echo "Pemulihan gagal (kode $code). API tidak dijalankan."; exit $((code == 2 ? 2 : 1)); }

echo "== 2. Jalankan API terhadap hasil pulih (port $PORT)"
log="$(mktemp)"; api_pid=""
stop_api() { [ -n "$api_pid" ] && kill -- "-$api_pid" 2>/dev/null; rm -f "$log"; }
trap stop_api EXIT
setsid bash -c "set -a; . '$ENVFILE'; set +a; export API_PORT='$PORT' STORAGE_DIR='$FILES'; cd '$REPO' && exec npm -w apps/api run start" >"$log" 2>&1 &
api_pid=$!

healthy=0
for ((i = 0; i < HEALTH_TIMEOUT_SECONDS; i++)); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  kill -0 "$api_pid" 2>/dev/null || break # API sudah mati sendiri
  sleep 1
done
elapsed=$(($(date +%s) - start))

echo "== 3. Hasil"
if [ "$healthy" = 1 ]; then echo "Cek /api/health: OK (sehat)"; else echo "Cek /api/health: GAGAL (tidak sehat dalam ${HEALTH_TIMEOUT_SECONDS} detik)"; tail -n 5 "$log" | sed 's/^/  api: /'; fi
echo "Lama pemulihan: $(hms "$elapsed") (batas RTO $(hms "$RTO_SECONDS"))"
if [ "$elapsed" -gt "$RTO_SECONDS" ]; then echo "RTO: GAGAL (melebihi batas)"; rto=1; else echo "RTO: LULUS"; rto=0; fi
[ "$healthy" = 1 ] && [ "$rto" = 0 ]
