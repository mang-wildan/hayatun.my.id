#!/bin/bash
# Pemeriksa tepi (Nginx) dari luar, untuk situs yang sedang berjalan (T57; N1, N5, N30).
# Pemakaian: ops/check-edge.sh [--insecure] [--http-port=N] https://hayatun.my.id
#   --insecure   terima sertifikat swa-tanda-tangan (hanya untuk tes lokal)
#   --http-port  port HTTP untuk uji pengalihan (bawaan 80)
# Hanya GET/HEAD dan POST berukuran besar yang pasti ditolak Nginx (413) sebelum sampai ke aplikasi; tidak mengubah apa pun.
# Keluar 0 bila tidak ada yang GAGAL, 1 bila ada, 2 bila argumen salah.
set -u

INSECURE=0; HTTP_PORT=80; URL=""
for a in "$@"; do
  case "$a" in
    --insecure) INSECURE=1 ;;
    --http-port=*) HTTP_PORT="${a#*=}" ;;
    https://*) URL="${a%/}" ;;
    *) ;;
  esac
done
if [ -z "$URL" ]; then
  echo "Pemakaian: ops/check-edge.sh [--insecure] [--http-port=N] https://alamat-situs" >&2
  exit 2
fi
HOSTPORT="${URL#https://}"; HOSTPORT="${HOSTPORT%%/*}"; HOST="${HOSTPORT%%:*}"
CURL=(curl -sS --max-time 30); [ "$INSECURE" = 1 ] && CURL+=(-k)
UUID=00000000-0000-4000-8000-000000000001

lulus=0; gagal=0; manual=0
ok()      { printf 'LULUS    %-20s %s\n' "$1" "$2"; lulus=$((lulus + 1)); }
bad()     { printf 'GAGAL    %-20s %s: %s\n' "$1" "$2" "$3"; gagal=$((gagal + 1)); }
manualc() { printf 'PERIKSA  %-20s %s\n' "$1" "$2"; manual=$((manual + 1)); }
code()    { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
header()  { "${CURL[@]}" -s -D - -o /dev/null "$2" 2>/dev/null | tr -d '\r' | awk -F': ' -v k="$(printf '%s' "$1" | tr 'A-Z' 'a-z')" 'tolower($1) == k { print substr($0, index($0, ": ") + 2); exit }'; }
big_post() { head -c "$1" /dev/zero | "${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary @- "$2" 2>/dev/null; }

# ---- TLS ----
t12="$(code --tlsv1.2 --tls-max 1.2 "$URL/api/health")"; t13="$(code --tlsv1.3 "$URL/api/health")"
if [ "$t12" != 000 ] && [ "$t13" != 000 ]; then ok tls-baru "TLS 1.2 dan 1.3 diterima"; else bad tls-baru "TLS 1.2 dan 1.3 diterima" "1.2: ${t12}, 1.3: ${t13} (000 = gagal tersambung)"; fi

# TLS 1.0/1.1 harus ditolak server. Klien OpenSSL modern sering menolak mencobanya sendiri; itu bukan bukti, jadi PERIKSA.
old=""
if command -v openssl >/dev/null 2>&1; then
  for v in tls1 tls1_1; do
    r="$(echo | openssl s_client -connect "$HOSTPORT" -servername "$HOST" -"$v" -cipher 'DEFAULT:@SECLEVEL=0' 2>&1)"
    # diterima = ada sandi nyata (blok SSL-Session tetap mencetak "Protocol : TLSv1" walau jabat tangan ditolak, jadi jangan dipakai)
    if echo "$r" | grep -qE '^New, TLSv1(\.[01])?, Cipher is [^(]'; then old="$old $v-diterima"
    elif echo "$r" | grep -qiE 'alert protocol version|alert handshake failure'; then :   # ditolak oleh server
    else old="$old $v-tidakterbukti"; fi                                                 # klien sendiri tidak bisa mencoba
  done
else
  old=" openssl-tidak-ada"
fi
case "$old" in
  *-diterima*) bad tls-lama "TLS 1.0 dan 1.1 ditolak" "server menerima:$old" ;;
  "") ok tls-lama "TLS 1.0 dan 1.1 ditolak server" ;;
  *) manualc tls-lama "tidak terbukti dari mesin ini ($old); periksa dengan: nmap --script ssl-enum-ciphers -p 443 $HOST" ;;
esac

# ---- HTTP dialihkan ----
red="$("${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST:$HTTP_PORT/produk/uji?a=1" 2>/dev/null)"
if [[ "$red" == "301 https://"* ]]; then ok http-alihkan "HTTP dialihkan 301 ke HTTPS"; else bad http-alihkan "HTTP dialihkan 301 ke HTTPS" "jawaban: ${red:-tidak ada}"; fi

# ---- header di halaman dan API ----
hsts="$(header strict-transport-security "$URL/")"
age="$(printf '%s' "$hsts" | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')"
if [ -n "$age" ] && [ "$age" -ge 31536000 ] && printf '%s' "$hsts" | grep -qi includesubdomains; then ok hsts "HSTS max-age=$age dengan includeSubDomains"; else bad hsts "HSTS minimal 1 tahun dengan includeSubDomains" "header: ${hsts:-tidak ada}"; fi

health="$("${CURL[@]}" -w '\n%{http_code}' "$URL/api/health" 2>/dev/null)"
if [ "${health##*$'\n'}" = 200 ]; then ok api-proxy "/api/health sampai ke API (200)"; else bad api-proxy "/api/health sampai ke API" "status: ${health##*$'\n'}"; fi

rid1="$(header x-request-id "$URL/api/health")"; rid2="$(header x-request-id "$URL/api/health")"
if [[ "$rid1" =~ ^[0-9a-f]{32}$ ]] && [ "$rid1" != "$rid2" ]; then ok request-id "X-Request-Id dibuat per permintaan"; else bad request-id "X-Request-Id dibuat Nginx per permintaan" "dapat: ${rid1:-tidak ada}, ${rid2:-tidak ada}"; fi

missing=""
for u in "$URL/" "$URL/api/health"; do
  [ "$(header x-content-type-options "$u")" = nosniff ] || missing="$missing x-content-type-options"
  [ -n "$(header x-frame-options "$u")" ] || missing="$missing x-frame-options"
  [ -n "$(header referrer-policy "$u")" ] || missing="$missing referrer-policy"
done
if [ -z "$missing" ]; then ok header-keamanan "header keamanan ada di halaman dan API"; else bad header-keamanan "header keamanan ada di halaman dan API" "kurang:$(printf '%s\n' $missing | sort -u | tr '\n' ' ')"; fi

server="$(header server "$URL/")"
if printf '%s' "$server" | grep -q '[0-9]'; then bad server-tokens "versi Nginx tidak ditampilkan" "Server: $server"; else ok server-tokens "versi Nginx tidak ditampilkan (${server:-tanpa header Server})"; fi

# ---- file privat dan berkas tersembunyi ----
# Direktori file internal: bila lokasinya bukan `internal`, nginx menjawab 403 (direktori); bila benar internal, 404.
internal="$(code "$URL/_internal/files/")"
if [ "$internal" = 404 ]; then ok file-internal "/_internal/files/ tidak bisa dibuka dari luar"; else bad file-internal "/_internal/files/ tidak bisa dibuka dari luar" "status: $internal (seharusnya 404)"; fi

hidden=""
for p in /.env /.git/config; do [ "$(code "$URL$p")" = 404 ] || hidden="$hidden $p"; done
if [ -z "$hidden" ]; then ok berkas-tersembunyi ".env dan .git tidak dilayani"; else bad berkas-tersembunyi ".env dan .git tidak dilayani (404)" "tidak 404:$hidden"; fi

# ---- batas unggah: ditolak Nginx (413) sebelum sampai ke aplikasi ----
proof="$(big_post 7340032 "$URL/api/orders/$UUID/proof")"
if [ "$proof" = 413 ]; then ok batas-unggah "unggahan 7 MB ke bukti bayar ditolak (413)"; else bad batas-unggah "unggahan 7 MB ke bukti bayar ditolak" "status: $proof (seharusnya 413)"; fi
general="$(big_post 1048576 "$URL/api/cart/items")"
if [ "$general" = 413 ]; then ok batas-umum "isi 1 MB ke rute biasa ditolak (413)"; else bad batas-umum "isi 1 MB ke rute biasa ditolak" "status: $general (seharusnya 413)"; fi

echo
summary="Hasil: $lulus lulus, $gagal gagal"
[ "$manual" -gt 0 ] && summary="$summary, $manual perlu dicek manual"
echo "$summary"
[ "$gagal" -eq 0 ]
