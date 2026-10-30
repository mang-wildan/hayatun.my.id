#!/bin/bash
# Deploy Hayatun (T58; ARCHITECTURE bagian 7, N22). Dijalankan sebagai pengguna `hayatun`, bukan root:
#   ops/deploy.sh vX.Y.Z              deploy tag itu
#   ops/deploy.sh --dry-run [vX.Y.Z]  periksa prasyarat dan cetak rencana; tidak mengubah apa pun
#   ops/deploy.sh --rollback          kembali ke rilis sebelumnya
# Tata letak (HAYATUN_ROOT, bawaan /srv/hayatun): repo/ (salinan git), releases/<tag>/, current -> rilis aktif, shared/{.env,logs,previous,deploy.log,deploy.lock}
# Kode keluar: 0 berhasil, 1 gagal (sudah dikembalikan), 2 pemakaian atau prasyarat, 3 deploy lain berjalan, 4 KRITIS (rollback pun tidak sehat).
# Migrasi database harus kompatibel dengan kode rilis sebelumnya, karena rollback hanya mengembalikan kode, bukan data.
set -u

ROOT="${HAYATUN_ROOT:-/srv/hayatun}"
REPO="$ROOT/repo"; RELEASES="$ROOT/releases"; SHARED="$ROOT/shared"; CURRENT="$ROOT/current"
KEEP=5
RETRIES="${HEALTH_RETRIES:-30}"; INTERVAL="${HEALTH_INTERVAL:-2}"
MIN_FREE_KB="${HAYATUN_MIN_FREE_KB:-1048576}"
API_HEALTH="http://127.0.0.1:4000/api/health"; WEB_HEALTH="http://127.0.0.1:3000/api/health"
TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'

usage() { echo "Pemakaian: ops/deploy.sh vX.Y.Z | --dry-run [vX.Y.Z] | --rollback" >&2; exit 2; }

DRY=0; ROLLBACK=0; TAG=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --rollback) ROLLBACK=1 ;;
    -*) usage ;;
    *) [ -z "$TAG" ] || usage; TAG="$a" ;;
  esac
done
if [ -n "$TAG" ] && ! [[ "$TAG" =~ $TAG_RE ]]; then echo "Nama tag tidak sah: harus berbentuk vX.Y.Z" >&2; exit 2; fi
if [ "$ROLLBACK" = 0 ] && [ "$DRY" = 0 ] && [ -z "$TAG" ]; then usage; fi
if [ "$ROLLBACK" = 1 ] && { [ "$DRY" = 1 ] || [ -n "$TAG" ]; }; then usage; fi

if [ "${HAYATUN_ALLOW_ANY_USER:-0}" != 1 ] && [ "$(id -un)" != hayatun ]; then
  echo "Jalankan sebagai pengguna hayatun, bukan root atau pengguna lain: sudo -u hayatun ops/deploy.sh ..." >&2
  exit 2
fi

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$SHARED/deploy.log"; }
say() { printf '%s\n' "$*"; }
current_name() { [ -L "$CURRENT" ] && basename "$(readlink "$CURRENT")"; }

# ---- prasyarat ----
problems=()
for c in git npm pm2 curl flock; do command -v "$c" >/dev/null 2>&1 || problems+=("perintah $c tidak terpasang"); done
[ -d "$REPO" ] || problems+=("salinan repo $REPO tidak ada")
if [ ! -r "$SHARED/.env" ]; then problems+=("berkas $SHARED/.env tidak ada atau tidak terbaca")
else
  mode="$(stat -c %a "$SHARED/.env" 2>/dev/null)"
  [[ "$mode" =~ 00$ ]] || problems+=("berkas $SHARED/.env terlalu terbuka (mode $mode, seharusnya 600)")
fi
free="$(df -Pk "$ROOT" 2>/dev/null | awk 'NR==2 { print $4 }')"
[ "${free:-0}" -ge "$MIN_FREE_KB" ] || problems+=("ruang disk kurang: ${free:-?} KB bebas, butuh minimal $MIN_FREE_KB KB")
if [ -n "$TAG" ] && [ "${#problems[@]}" -eq 0 ]; then
  git -C "$REPO" rev-parse --verify --quiet "refs/tags/$TAG^{commit}" >/dev/null 2>&1 || git -C "$REPO" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 || problems+=("tag $TAG tidak ada")
fi
if [ -n "$TAG" ] && [ -e "$RELEASES/$TAG" ]; then problems+=("rilis $TAG sudah ada di $RELEASES; pakai tag baru atau --rollback"); fi
if [ "${#problems[@]}" -gt 0 ]; then
  say "Prasyarat gagal:"; for p in "${problems[@]}"; do say "  - $p"; done
  [ "$ROLLBACK" = 1 ] && [ "${#problems[@]}" -eq 0 ] || exit 2
fi

# ---- dry-run: cetak rencana saja ----
if [ "$DRY" = 1 ]; then
  say "Prasyarat: semua lulus (lingkungan $ROOT, rilis aktif: $(current_name || echo belum ada))"
  if [ -n "$TAG" ]; then
    prev="$(current_name || true)"
    say "[dry-run] Ambil kode $TAG ke $RELEASES/$TAG (git fetch --tags, git worktree add)"
    say "[dry-run] npm ci di $RELEASES/$TAG"
    say "[dry-run] npm run build"
    say "[dry-run] Migrasi database (db:migrate) sebelum pengalihan; harus kompatibel dengan rilis ${prev:-sebelumnya}"
    say "[dry-run] Alihkan current ke $RELEASES/$TAG (sekarang: ${prev:-belum ada})"
    say "[dry-run] pm2 startOrReload hayatun-api"
    say "[dry-run] pm2 startOrReload hayatun-web"
    say "[dry-run] Cek kesehatan $API_HEALTH dan $WEB_HEALTH (sampai $RETRIES kali, jeda ${INTERVAL}s); bila gagal: rollback ke ${prev:-(tidak ada)}"
    say "[dry-run] Simpan $KEEP rilis terbaru"
  else
    say "Tidak ada tag: hanya prasyarat yang diperiksa."
  fi
  exit 0
fi

# ---- kunci: satu deploy pada satu waktu ----
exec 9>"$SHARED/deploy.lock"
flock -n 9 || { say "Deploy lain sedang berjalan (kunci $SHARED/deploy.lock). Coba lagi nanti."; exit 3; }

healthy() { # kedua layanan menjawab sehat dalam batas percobaan
  local url i
  for url in "$API_HEALTH" "$WEB_HEALTH"; do
    for ((i = 1; i <= RETRIES; i++)); do
      curl -fsS --max-time 5 "$url" >/dev/null 2>&1 && continue 2
      [ "$i" -lt "$RETRIES" ] && sleep "$INTERVAL"
    done
    say "Tidak sehat: $url tidak menjawab setelah $RETRIES percobaan"
    return 1
  done
}
switch_to() { ln -sfn "$RELEASES/$1" "$CURRENT.new" && mv -T "$CURRENT.new" "$CURRENT"; }
reload() { # API dulu, lalu web
  pm2 startOrReload "$CURRENT/ops/ecosystem.config.cjs" --only hayatun-api --update-env &&
  pm2 startOrReload "$CURRENT/ops/ecosystem.config.cjs" --only hayatun-web --update-env &&
  pm2 save >/dev/null
}
in_release() { ( cd "$RELEASES/$TAG" && set -a && . "$SHARED/.env" && set +a && "$@" ); }
discard() { git -C "$REPO" worktree remove --force "$RELEASES/$TAG" >/dev/null 2>&1; rm -rf "$RELEASES/$TAG"; git -C "$REPO" worktree prune >/dev/null 2>&1; }

# ---- rollback manual ----
if [ "$ROLLBACK" = 1 ]; then
  cur="$(current_name || true)"; prev="$(cat "$SHARED/previous" 2>/dev/null || true)"
  if [ -z "$prev" ] || [ ! -d "$RELEASES/$prev" ]; then say "Tidak ada rilis sebelumnya yang tersedia untuk rollback."; exit 2; fi
  say "Rollback dari ${cur:-?} ke $prev"
  switch_to "$prev"; reload
  if healthy; then echo "$cur" > "$SHARED/previous"; log "rollback manual ke $prev (dari $cur) ok"; say "Selesai: rilis aktif $prev"; exit 0; fi
  log "rollback manual ke $prev gagal"; say "KRITIS: rollback manual ke $prev tidak sehat. Periksa pm2 logs dan /srv/hayatun/shared/logs."; exit 4
fi

# ---- deploy ----
prev="$(current_name || true)"
fail() { say "Gagal pada langkah: $1"; log "$TAG gagal: $1"; discard; exit 1; }
say "Deploy $TAG (rilis aktif: ${prev:-belum ada})"
git -C "$REPO" fetch --tags --prune origin || fail "git fetch"
git -C "$REPO" rev-parse --verify --quiet "refs/tags/$TAG^{commit}" >/dev/null || { say "Tag $TAG tidak ada."; log "$TAG gagal: tag tidak ada"; exit 2; }
git -C "$REPO" worktree add "$RELEASES/$TAG" "$TAG" --detach || fail "git worktree add"
in_release npm ci || fail "npm ci"
in_release npm run build || fail "build"
in_release npm -w apps/api run db:migrate || fail "migrasi database"

switch_to "$TAG" || fail "pengalihan current"
if reload && healthy; then
  echo "${prev:-}" > "$SHARED/previous"
  log "$TAG ok (sebelumnya: ${prev:-tidak ada})"
  # rotasi: simpan $KEEP rilis terbaru ditambah yang aktif dan sebelumnya; rilis .failed hanya 2 terbaru
  keep=" $TAG ${prev:-} "
  n=0; for r in $(ls -1t "$RELEASES" | grep -v '\.failed$'); do n=$((n + 1)); [ "$n" -le "$KEEP" ] && keep="$keep$r "; done
  for r in $(ls -1t "$RELEASES" | grep -v '\.failed$'); do case "$keep" in *" $r "*) ;; *) rm -rf "${RELEASES:?}/$r" ;; esac; done
  for r in $(ls -1t "$RELEASES" | grep '\.failed$' | tail -n +3); do rm -rf "${RELEASES:?}/$r"; done
  git -C "$REPO" worktree prune >/dev/null 2>&1
  say "Selesai: rilis aktif $TAG"
  exit 0
fi

# ---- tidak sehat: kembali ke rilis sebelumnya ----
say "Rilis $TAG tidak sehat."
if [ -z "$prev" ]; then
  log "$TAG gagal: tidak sehat, tidak ada rilis sebelumnya"
  say "Tidak ada rilis sebelumnya untuk rollback. Rilis $TAG tetap terpasang; periksa pm2 logs."; exit 1
fi
say "Rollback ke $prev"
switch_to "$prev"; reload || say "Peringatan: pm2 gagal me-reload saat rollback; yang menentukan adalah pemeriksaan kesehatan."
rm -rf "$RELEASES/$TAG.failed"; mv "$RELEASES/$TAG" "$RELEASES/$TAG.failed"
if healthy; then log "$TAG gagal: tidak sehat, rollback ke $prev ok"; say "Rollback selesai: rilis aktif $prev. Rilis yang gagal disimpan di $RELEASES/$TAG.failed"; exit 1; fi
log "$TAG gagal: tidak sehat, rollback ke $prev juga tidak sehat"
say "KRITIS: rollback ke $prev pun tidak sehat. Periksa pm2 logs dan layanan segera."
exit 4
