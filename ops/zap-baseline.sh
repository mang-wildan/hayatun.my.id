#!/bin/bash
# Pemindaian OWASP ZAP baseline (pasif) terhadap situs sendiri (T61; N7: 0 temuan tinggi/kritis sebelum rilis tahap 1).
#   ops/zap-baseline.sh https://staging.hayatun.my.id
# Butuh docker dan jq. Laporan: $ZAP_REPORT_DIR/zap.json dan zap.html (bawaan ./zap-report). Aturan diabaikan: ops/zap-ignore.txt.
# Keputusan diambil dari laporan, bukan dari kode keluar ZAP. Kode keluar: 0 tidak ada temuan tinggi, 1 ada, 2 galat (tidak pernah lulus diam-diam).
# Pasif dan tanpa login: halaman pembeli/admin dicakup tes otorisasi (T51), bukan alat ini.
set -u

# Dikunci dengan digest agar tag `stable` yang berpindah tidak mengubah hasil diam-diam; ganti lewat ZAP_IMAGE, perbarui tiap kuartal.
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238}"
REPORT_DIR="${ZAP_REPORT_DIR:-./zap-report}"
IGNORE_FILE="${ZAP_IGNORE_FILE:-$(dirname "$0")/zap-ignore.txt}"

die() { echo "$*" >&2; exit 2; }
[ $# -eq 1 ] || die "Pemakaian: ops/zap-baseline.sh <url>   (contoh: https://staging.hayatun.my.id)"
url="$1"
# Hanya situs sendiri: tanpa userinfo, port, query, atau fragmen yang bisa membelokkan sasaran. http hanya untuk mesin ini (CI).
[[ "$url" =~ ^https://(hayatun\.my\.id|www\.hayatun\.my\.id|staging\.hayatun\.my\.id)(/[^@#?[:space:]]*)?$ ]] \
  || [[ "$url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/[^@#?[:space:]]*)?$ ]] \
  || die "Sasaran ditolak: $url. Hanya hayatun.my.id (https), www., staging., atau 127.0.0.1/localhost (http)."
command -v docker >/dev/null || die "docker tidak terpasang."
command -v jq >/dev/null || die "jq tidak terpasang (dnf install jq)."

declare -A IGNORED
if [ -r "$IGNORE_FILE" ]; then
  n=0
  while IFS= read -r line; do
    n=$((n + 1)); [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^[[:space:]]*([0-9]+)[[:space:]]+(.+)$ ]] || die "$IGNORE_FILE baris $n: formatnya '<id plugin ZAP> <alasan>'; alasan wajib."
    IGNORED[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
  done < "$IGNORE_FILE"
fi

mkdir -p "$REPORT_DIR" && REPORT_DIR="$(realpath "$REPORT_DIR")" || die "Folder laporan tidak bisa dibuat."
rm -f "$REPORT_DIR/zap.json" "$REPORT_DIR/zap.html"
chmod 777 "$REPORT_DIR" # pengguna zap di dalam kontainer bukan pemilik folder ini

docker run --rm --network host -v "$REPORT_DIR:/zap/wrk:rw" "$ZAP_IMAGE" zap-baseline.py -t "$url" -J zap.json -r zap.html -I
rc=$?
# ZAP: 0 bersih, 1 gagal aturan, 2 peringatan (ketiganya sah; keputusan dari laporan). Selain itu ZAP sendiri galat.
case "$rc" in 0|1|2) ;; *) die "ZAP galat (kode $rc); hasilnya tidak dipercaya." ;; esac
[ -s "$REPORT_DIR/zap.json" ] || die "Laporan $REPORT_DIR/zap.json tidak ada setelah ZAP selesai."
alerts="$(jq -r 'if (.site | type) != "array" then error("tanpa daftar site") else .site[] | (.alerts // [])[] | [.pluginid, (.riskcode | tonumber), .alert] | @tsv end' "$REPORT_DIR/zap.json" 2>/dev/null)" \
  || die "Laporan $REPORT_DIR/zap.json tidak bisa dibaca (bukan JSON ZAP)."

high=0; medium=0; ignored=0
while IFS=$'\t' read -r id risk name; do
  [ -n "$id" ] || continue
  if [ "$risk" -ge 3 ] && [ -n "${IGNORED[$id]:-}" ]; then ignored=$((ignored + 1)); printf 'DIABAIKAN %-6s %s - %s\n' "$id" "$name" "${IGNORED[$id]}"
  elif [ "$risk" -ge 3 ]; then high=$((high + 1)); printf 'TINGGI    %-6s %s\n' "$id" "$name"
  elif [ "$risk" -eq 2 ]; then medium=$((medium + 1)); printf 'SEDANG    %-6s %s\n' "$id" "$name"; fi
done <<< "$alerts"

echo
echo "Hasil: $high tinggi, $medium sedang, $ignored diabaikan (laporan lengkap: $REPORT_DIR/zap.html)"
[ "$high" -eq 0 ]
