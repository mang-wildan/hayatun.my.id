#!/bin/bash
# Pemeriksa keamanan server (T56, ARCHITECTURE bagian 6). Hanya membaca; tidak mengubah apa pun.
# Jalankan di server: sudo ops/check-server.sh
# Keluar 0 bila tidak ada yang GAGAL, 1 bila ada, 2 bila bukan root.
# Variabel untuk pengujian (ops/check-server.test.ts): HAYATUN_PSQL, HAYATUN_AAPANEL_PORT_FILE, HAYATUN_FILES_DIR.
set -u

APP_USER=hayatun
APP_DB_ROLE=hayatun_app
FILES_DIR="${HAYATUN_FILES_DIR:-/srv/hayatun/files}"
PANEL_PORT_FILE="${HAYATUN_AAPANEL_PORT_FILE:-/www/server/panel/data/port.pl}"
read -ra PSQL <<< "${HAYATUN_PSQL:-sudo -u postgres psql}"

if [ "$(id -u 2>/dev/null)" != "0" ]; then
  echo "Jalankan dengan sudo: sudo ops/check-server.sh (butuh akses root untuk membaca konfigurasi)." >&2
  exit 2
fi

lulus=0; gagal=0; manual=0
ok()     { printf 'LULUS    %-22s %s\n' "$1" "$2"; lulus=$((lulus + 1)); }
bad()    { printf 'GAGAL    %-22s %s: %s\n' "$1" "$2" "$3"; gagal=$((gagal + 1)); }
manualc() { printf 'PERIKSA  %-22s %s\n' "$1" "$2"; manual=$((manual + 1)); }
have()   { command -v "$1" >/dev/null 2>&1; }
# nilai satu kunci dari keluaran `sshd -T` (huruf kecil semua)
ssh_val() { printf '%s\n' "$SSHD_OUT" | awk -v k="$1" '$1 == k { print $2; exit }'; }
# satu nilai dari PostgreSQL; kosong bila gagal
pg() { "${PSQL[@]}" -X -Atqc "$1" 2>/dev/null | head -n1; }

# ---- SSH ----
if have sshd; then SSHD_OUT="$(sshd -T 2>/dev/null)"; else SSHD_OUT=""; fi
ssh_check() { # id deskripsi kunci nilai-yang-wajib
  local v; v="$(ssh_val "$3")"
  if [ -z "$SSHD_OUT" ]; then bad "$1" "$2" "sshd tidak ditemukan atau tidak bisa dibaca"
  elif [ "$v" = "$4" ]; then ok "$1" "$2"
  else bad "$1" "$2" "$3 = ${v:-tidak ada}, seharusnya $4"; fi
}
ssh_check ssh-password "SSH menolak login dengan password" passwordauthentication no
ssh_check ssh-root     "SSH menolak login root" permitrootlogin no
ssh_check ssh-kunci    "SSH menerima login dengan kunci" pubkeyauthentication yes
SSH_PORT="$(ssh_val port)"; SSH_PORT="${SSH_PORT:-22}"

# ---- firewalld ----
if have firewall-cmd && [ "$(firewall-cmd --state 2>/dev/null)" = "running" ]; then
  ok firewall-aktif "firewalld berjalan"
  services=" $(firewall-cmd --list-services 2>/dev/null) "; ports=" $(firewall-cmd --list-ports 2>/dev/null) "
  problems=""
  for need in http https; do
    case "$services" in *" $need "*) ;; *) case "$ports" in *" $([ $need = http ] && echo 80 || echo 443)/tcp "*) ;; *) problems="$problems $need-tertutup" ;; esac ;; esac
  done
  if [ "$SSH_PORT" = 22 ]; then
    case "$services$ports" in *" ssh "*|*" 22/tcp "*) ;; *) problems="$problems ssh-tertutup" ;; esac
  else
    case "$ports" in *" $SSH_PORT/tcp "*) ;; *) problems="$problems ssh-$SSH_PORT-tertutup" ;; esac
  fi
  for s in $services; do case "$s" in ssh|http|https|dhcpv6-client) ;; *) problems="$problems layanan-$s" ;; esac; done
  for p in $ports; do case "$p" in 80/tcp|443/tcp|"$SSH_PORT"/tcp) ;; *) problems="$problems port-$p" ;; esac; done
  if [ -z "$problems" ]; then ok firewall-port "hanya SSH ($SSH_PORT), 80, dan 443 yang terbuka"
  else bad firewall-port "hanya SSH, 80, dan 443 yang boleh terbuka" "bermasalah:$problems"; fi
else
  bad firewall-aktif "firewalld berjalan" "firewall-cmd tidak ditemukan atau firewalld tidak berjalan"
  bad firewall-port  "hanya SSH, 80, dan 443 yang terbuka" "firewalld tidak bisa diperiksa"
fi

# ---- SELinux ----
mode="$(have getenforce && getenforce 2>/dev/null)"
if [ "$mode" = "Enforcing" ]; then ok selinux "SELinux enforcing"; else bad selinux "SELinux enforcing" "mode saat ini: ${mode:-tidak terbaca}"; fi
bool="$(have getsebool && getsebool httpd_can_network_connect 2>/dev/null)"
case "$bool" in *" on") ok selinux-nginx "Nginx boleh meneruskan ke port lokal (httpd_can_network_connect)";; *) bad selinux-nginx "Nginx boleh meneruskan ke port lokal" "httpd_can_network_connect: ${bool:-tidak terbaca}";; esac

# ---- port lokal: tidak boleh terbuka ke luar ----
LISTEN="$(have ss && ss -H -tln 2>/dev/null)"
listen_check() { # id port deskripsi
  local addrs outside
  addrs="$(printf '%s\n' "$LISTEN" | awk -v p=":$2" '$4 ~ p"$" { print $4 }')"
  outside="$(printf '%s\n' "$addrs" | grep -vE '^(127\.0\.0\.1|\[::1\]):' | grep . | tr '\n' ' ')"
  if ! have ss; then bad "$1" "$3" "perintah ss tidak ditemukan"
  elif [ -n "$outside" ]; then bad "$1" "$3" "mendengarkan di ${outside}(seharusnya 127.0.0.1)"
  elif [ -z "$addrs" ]; then ok "$1" "$3 (tidak berjalan, jadi tidak terbuka)"
  else ok "$1" "$3 hanya di 127.0.0.1"; fi
}
listen_check dengar-3000 3000 "Next.js (3000)"
listen_check dengar-4000 4000 "Express (4000)"
listen_check dengar-5432 5432 "PostgreSQL (5432)"

# ---- pengguna sistem hayatun ----
entry="$(have getent && getent passwd "$APP_USER" 2>/dev/null)"
if [ -n "$entry" ]; then ok pengguna-hayatun "pengguna $APP_USER ada"; else bad pengguna-hayatun "pengguna $APP_USER ada" "tidak ditemukan"; fi
shell="${entry##*:}"
if [ -z "$entry" ] || [[ "$shell" == */nologin || "$shell" == */false ]]; then ok pengguna-shell "$APP_USER tanpa shell login"; else bad pengguna-shell "$APP_USER tanpa shell login" "shell: $shell"; fi
groups="$(id -nG "$APP_USER" 2>/dev/null)"
case " $groups " in *" wheel "*|*" sudo "*) bad pengguna-sudo "$APP_USER tanpa hak sudo" "anggota grup: $groups";; *) ok pengguna-sudo "$APP_USER tanpa hak sudo";; esac
info="$(stat -c '%U %G %a' "$FILES_DIR" 2>/dev/null)"
owner="${info%% *}"; perm="${info##* }"; other="${perm: -1}"
if [ "$owner" = "$APP_USER" ]; then ok file-pemilik "$FILES_DIR dimiliki $APP_USER"; else bad file-pemilik "$FILES_DIR dimiliki $APP_USER" "pemilik: ${owner:-tidak terbaca}"; fi
if [ -n "$info" ] && [ "$other" = 0 ]; then ok file-mode "$FILES_DIR tertutup untuk pengguna lain (mode $perm)"; else bad file-mode "$FILES_DIR tertutup untuk pengguna lain" "mode: ${perm:-tidak terbaca}"; fi

# ---- PostgreSQL ----
pg_expect() { # id deskripsi query nilai-yang-wajib
  local v; v="$(pg "$3")"
  if [ -z "$v" ]; then bad "$1" "$2" "tidak bisa menjalankan psql atau tidak ada jawaban"
  elif [ "$v" = "$4" ]; then ok "$1" "$2"
  else bad "$1" "$2" "jawaban: $v, seharusnya $4"; fi
}
pg_expect pg-superuser "peran $APP_DB_ROLE bukan superuser" "select rolsuper from pg_roles where rolname='$APP_DB_ROLE'" f
pg_expect pg-audit-ubah "$APP_DB_ROLE tidak bisa UPDATE audit_logs" "select has_table_privilege('$APP_DB_ROLE','audit_logs','UPDATE')" f
pg_expect pg-audit-hapus "$APP_DB_ROLE tidak bisa DELETE audit_logs" "select has_table_privilege('$APP_DB_ROLE','audit_logs','DELETE')" f
pg_expect pg-audit-kosongkan "$APP_DB_ROLE tidak bisa TRUNCATE audit_logs" "select has_table_privilege('$APP_DB_ROLE','audit_logs','TRUNCATE')" f
pg_expect pg-trust "pg_hba.conf tanpa metode trust" "select count(*) from pg_hba_file_rules where auth_method='trust'" 0
pg_expect pg-luar "pg_hba.conf tanpa sambungan dari luar" "select count(*) from pg_hba_file_rules where type <> 'local' and coalesce(address,'') not in ('127.0.0.1','::1','samehost','localhost')" 0
listen="$(pg 'show listen_addresses')"
if [ -z "$listen" ]; then bad pg-dengar "listen_addresses hanya lokal" "tidak bisa menjalankan psql atau tidak ada jawaban"
elif [ -z "$(printf '%s' "$listen" | tr ',' '\n' | tr -d ' ' | grep -vxE 'localhost|127\.0\.0\.1|::1')" ]; then ok pg-dengar "listen_addresses hanya lokal ($listen)"
else bad pg-dengar "listen_addresses hanya lokal" "nilai: $listen"; fi

# ---- pembaruan keamanan otomatis (N34) ----
if have systemctl && { [ "$(systemctl is-enabled dnf-automatic.timer 2>/dev/null)" = enabled ] || [ "$(systemctl is-enabled dnf-automatic-install.timer 2>/dev/null)" = enabled ]; }; then
  ok pembaruan-otomatis "pembaruan otomatis (dnf-automatic) aktif"
else
  bad pembaruan-otomatis "pembaruan otomatis (dnf-automatic) aktif" "timer dnf-automatic tidak aktif"
fi

# ---- aaPanel ----
if [ -r "$PANEL_PORT_FILE" ]; then
  panel="$(tr -d '[:space:]' < "$PANEL_PORT_FILE")"
  if [ "$panel" = 8888 ]; then bad aapanel-port "port panel bukan bawaan" "masih 8888"; else ok aapanel-port "port panel bukan bawaan ($panel)"; fi
else
  manualc aapanel-port "berkas port panel tidak ditemukan ($PANEL_PORT_FILE); periksa port panel bukan 8888"
fi

echo
echo "Periksa manual di aaPanel (tidak bisa dibaca skrip dengan andal):"
echo "  - verifikasi dua langkah (2FA) panel aktif"
echo "  - akses panel dibatasi ke IP pemilik atau lewat terowongan SSH"
echo "  - aaPanel dan Nginx sudah versi terbaru"
echo
summary="Hasil: $lulus lulus, $gagal gagal"
[ "$manual" -gt 0 ] && summary="$summary, $manual perlu dicek manual"
echo "$summary"
[ "$gagal" -eq 0 ]
