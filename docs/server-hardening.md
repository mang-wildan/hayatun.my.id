# Pengamanan server (T56)

Langkah memasang pengamanan di server CentOS Stream 9 dengan aaPanel, sesuai ARCHITECTURE bagian 6. Pemeriksa: `sudo ops/check-server.sh`.

> **Status: belum diuji di server sungguhan.** Perintah di bawah ditulis dari dokumentasi CentOS Stream 9, firewalld, SELinux, dan PostgreSQL, tetapi belum dijalankan di server pemilik. Jalankan satu bagian demi satu, dan setelah tiap bagian jalankan `sudo ops/check-server.sh` untuk melihat apakah pemeriksa setuju. Kirim keluarannya bila ada yang berbeda dari dugaan di sini.

## Urutan yang aman

Mulai dari yang tidak bisa mengunci kamu keluar, dan simpan satu sesi SSH lama terbuka sampai bagian SSH dan firewall terbukti bisa dimasuki dari sesi baru. Bila terkunci, masuk lewat konsol web dari penyedia VPS.

1. Pengguna `hayatun` dan folder file
2. PostgreSQL lokal
3. SELinux
4. Pembaruan keamanan otomatis
5. SSH
6. firewalld
7. aaPanel

## 1. Pengguna `hayatun` dan folder file (N5)

```bash
useradd --system --create-home --shell /sbin/nologin hayatun
install -d -o hayatun -g hayatun -m 750 /srv/hayatun/files
usermod -aG hayatun www            # Nginx (pengguna www di aaPanel) membaca file lewat X-Accel-Redirect
semanage fcontext -a -t httpd_sys_content_t '/srv/hayatun/files(/.*)?'
restorecon -Rv /srv/hayatun/files
```

Pengguna `hayatun` tidak boleh punya shell login dan tidak boleh anggota `wheel`. Proses API dan web berjalan sebagai pengguna ini.

## 2. PostgreSQL lokal (N2, F15.4)

Pasang dari paket resmi PostgreSQL 16. Di `postgresql.conf`:

```
listen_addresses = 'localhost'
```

Di `pg_hba.conf`, hanya sambungan lokal dengan kata sandi (tanpa `trust`, tanpa alamat selain loopback):

```
local   all   postgres                 peer
local   all   all                      scram-sha-256
host    all   all   127.0.0.1/32       scram-sha-256
host    all   all   ::1/128            scram-sha-256
```

Buat peran dan database produksi dengan kata sandi acak panjang (jangan pakai `ops/postgres-init.sql`: itu untuk pengembangan dan CI, berkata sandi `hayatun` dan membuat database uji):

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE hayatun_migrate LOGIN PASSWORD '<kata-sandi-migrasi>';
CREATE ROLE hayatun_app LOGIN PASSWORD '<kata-sandi-aplikasi>';
CREATE DATABASE hayatun OWNER hayatun_migrate;
SQL
systemctl reload postgresql-16
```

Setelah migrasi dijalankan, `hayatun_app` tidak punya hak UPDATE, DELETE, atau TRUNCATE pada `audit_logs` (migrasi 0001). Pemeriksa memastikan itu.

## 3. SELinux tetap `enforcing`

```bash
setenforce 1
sed -i 's/^SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config
setsebool -P httpd_can_network_connect on     # Nginx boleh meneruskan ke 127.0.0.1:3000 dan :4000
```

Jangan mematikan SELinux untuk memecahkan masalah izin. Cari penolakan dengan `ausearch -m avc -ts recent` dan buat aturan khusus.

## 4. Pembaruan keamanan otomatis (N34)

```bash
dnf install -y dnf-automatic
sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer
```

Kernel dan layanan yang diperbarui perlu dimulai ulang; jadwalkan `needs-restarting -r` dalam perawatan bulanan.

## 5. SSH: hanya kunci, tanpa root

1. Pasang kunci publikmu untuk pengguna admin biasa (bukan root) dan **buktikan login dengan kunci berhasil dari sesi baru**.
2. Buat `/etc/ssh/sshd_config.d/01-hayatun.conf` (awalan `01-` supaya menang atas berkas lain; sshd memakai nilai pertama yang ditemukan, dan image cloud sering membawa `50-cloud-init.conf` yang menyalakan password):

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

3. Uji lalu muat ulang, tanpa memutus sesi yang ada:

```bash
sshd -t && systemctl reload sshd
sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication) '
```

Bila mengganti port SSH, ubah juga firewalld (bagian 6) **sebelum** memuat ulang sshd, dan SELinux: `semanage port -a -t ssh_port_t -p tcp <port>`.

## 6. firewalld: hanya SSH, 80, dan 443

```bash
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https
firewall-cmd --permanent --remove-service=cockpit
# buang layanan dan port lain yang terdaftar: lihat firewall-cmd --list-all
firewall-cmd --reload
```

Port 3000, 4000, dan 5432 tidak boleh dibuka; ketiganya hanya mendengarkan di 127.0.0.1. aaPanel punya modul firewall sendiri; hindari membuka port lewat sana tanpa mengulang pemeriksaan.

Port panel aaPanel dibatasi ke IP pemilik dengan aturan kaya, bukan dibuka untuk umum:

```bash
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<IP-kamu>/32" port port="<port-panel>" protocol="tcp" accept'
firewall-cmd --reload
```

Aturan kaya tidak dihitung sebagai port terbuka oleh pemeriksa. Alternatifnya akses panel hanya lewat terowongan SSH: `ssh -L 28888:127.0.0.1:<port-panel> pengguna@server`.

## 7. aaPanel

Ini dilakukan di panel; pemeriksa hanya bisa memastikan portnya bukan 8888 dan mengingatkan sisanya.

- Ganti port panel dari 8888 (Settings, Panel port).
- Aktifkan verifikasi dua langkah (Google Authenticator) untuk akun panel.
- Aktifkan batasan IP yang berhak masuk (Authorized IP) atau gunakan terowongan SSH.
- Perbarui aaPanel dan Nginx rutin. Panel server adalah sasaran serangan yang umum.

## Memeriksa

```bash
sudo ops/check-server.sh
```

Tiap baris `LULUS`, `GAGAL`, atau `PERIKSA`. Skrip hanya membaca, tidak mengubah apa pun, dan keluar dengan kode 1 bila ada yang `GAGAL`. Baris `PERIKSA` adalah hal manual di aaPanel. Jalankan ulang setiap kali server diubah dan setelah pembaruan besar.

Skripnya diuji dengan perintah sistem palsu (`npx vitest run ops`), jadi logikanya teruji, tetapi format keluaran perintah asli di servermu belum.
