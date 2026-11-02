import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// ops/check-server.sh memeriksa server lewat perintah sistem (sshd, firewall-cmd, getenforce, ss, psql, dll.).
// Di sini perintah itu ditiru lewat PATH, sehingga logika LULUS/GAGAL teruji tanpa server sungguhan.
const SCRIPT = join(__dirname, "check-server.sh");

type Stubs = Record<string, string>; // nama perintah -> isi badan `case "$*"` atau skrip bash utuh
const SSHD = ["port 22", "permitrootlogin no", "passwordauthentication no", "pubkeyauthentication yes", "kbdinteractiveauthentication no"];
const SS = ["LISTEN 0 511 127.0.0.1:9000 0.0.0.0:*", "LISTEN 0 511 127.0.0.1:9001 0.0.0.0:*", "LISTEN 0 244 127.0.0.1:5432 0.0.0.0:*", "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*", "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*", "LISTEN 0 511 0.0.0.0:443 0.0.0.0:*"];

interface Server {
  uid: string; sshd: string[]; fwState: string; fwServices: string; fwPorts: string; selinux: string; httpdNet: string; ss: string[];
  passwd: string; groups: string; files: string; dnf: string; panelPort: string | null;
  pg: { rolsuper: string; update: string; delete: string; truncate: string; trust: string; remote: string; listen: string };
  osRelease: string | null; today: string; // isi /etc/os-release tiruan (null = berkas tidak ada) dan tanggal "hari ini"
}
const osRelease = (id: string, name: string, version: string) => `NAME="${name}"\nVERSION_ID="${version}"\nID="${id}"\nPRETTY_NAME="${name} ${version}"\n`;
const healthy = (): Server => ({
  uid: "0", sshd: [...SSHD], fwState: "running", fwServices: "ssh http https", fwPorts: "", selinux: "Enforcing", httpdNet: "httpd_can_network_connect --> on", ss: [...SS],
  passwd: "hayatun:x:1001:1001:Hayatun:/home/hayatun:/sbin/nologin", groups: "hayatun", files: "hayatun hayatun 750", dnf: "enabled", panelPort: "28888",
  pg: { rolsuper: "f", update: "f", delete: "f", truncate: "f", trust: "0", remote: "0", listen: "localhost" },
  osRelease: osRelease("almalinux", "AlmaLinux", "9.4"), today: "2026-11-01",
});

function build(s: Server, opts: { drop?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-server-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "dipanggil.log");
  const put = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  const esc = (t: string) => t.replace(/'/g, `'\\''`);
  const stubs: Stubs = {
    id: `case "$*" in "-u") echo ${s.uid};; "-nG hayatun") echo '${esc(s.groups)}';; *) exit 1;; esac`,
    sshd: `[ "$1" = "-T" ] && printf '%s\\n' '${esc(s.sshd.join("\n"))}' || exit 1`,
    "firewall-cmd": `case "$*" in "--state") echo ${s.fwState}; [ "${s.fwState}" = running ] || exit 252;; "--list-services") echo '${esc(s.fwServices)}';; "--list-ports") echo '${esc(s.fwPorts)}';; "--list-rich-rules") ;; *) exit 1;; esac`,
    getenforce: `echo ${s.selinux}`,
    getsebool: `echo '${esc(s.httpdNet)}'`,
    ss: `printf '%s\\n' '${esc(s.ss.join("\n"))}'`,
    getent: `[ "$1 $2" = "passwd hayatun" ] && [ -n '${esc(s.passwd)}' ] && echo '${esc(s.passwd)}' || exit 2`,
    stat: `echo '${esc(s.files)}'`,
    systemctl: `case "$*" in is-enabled\\ dnf-automatic*) echo ${s.dnf}; [ "${s.dnf}" = enabled ] || exit 1;; *) exit 1;; esac`,
    psql: `case "$*" in *rolsuper*) echo ${s.pg.rolsuper};; *"'UPDATE'"*) echo ${s.pg.update};; *"'DELETE'"*) echo ${s.pg.delete};; *"'TRUNCATE'"*) echo ${s.pg.truncate};; *"auth_method"*) echo ${s.pg.trust};; *pg_hba_file_rules*) echo ${s.pg.remote};; *listen_addresses*) echo '${esc(s.pg.listen)}';; *) exit 1;; esac`,
  };
  for (const [name, body] of Object.entries(stubs)) if (!opts.drop?.includes(name)) put(name, body);
  const panel = join(dir, "port.pl");
  if (s.panelPort !== null) writeFileSync(panel, s.panelPort);
  const os = join(dir, "os-release");
  if (s.osRelease !== null) writeFileSync(os, s.osRelease);
  return { dir, bin, log, panel, os };
}

function run(s: Server, opts: { drop?: string[]; env?: Record<string, string> } = {}) {
  const b = build(s, opts);
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { PATH: `${b.bin}:/usr/bin:/bin`, HAYATUN_PSQL: join(b.bin, "psql"), HAYATUN_AAPANEL_PORT_FILE: b.panel, HAYATUN_FILES_DIR: "/www/wwwroot/hayatun.my.id/files", HAYATUN_OS_RELEASE: b.os, HAYATUN_TODAY: s.today, ...opts.env },
  });
  const lines = (r.stdout ?? "").split("\n");
  const status = (id: string) => lines.find((l) => new RegExp(`^(LULUS|GAGAL|PERIKSA)\\s+${id}\\b`).test(l))?.split(/\s+/)[0];
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", status, log: () => (readFileSync(b.log, { encoding: "utf8", flag: "a+" })) };
}

const IDS = ["ssh-password", "ssh-root", "ssh-kunci", "firewall-aktif", "firewall-port", "selinux", "selinux-nginx", "dengar-web", "dengar-api", "dengar-5432", "pengguna-hayatun", "pengguna-shell", "pengguna-sudo", "file-pemilik", "file-mode", "pg-superuser", "pg-audit-ubah", "pg-audit-hapus", "pg-audit-kosongkan", "pg-trust", "pg-luar", "pg-dengar", "pembaruan-otomatis", "aapanel-port", "os-didukung"];

describe("server yang sehat", () => {
  it("semua pemeriksaan LULUS dan skrip keluar dengan kode 0", () => {
    const r = run(healthy());
    expect(r.err).toBe("");
    for (const id of IDS) expect(r.status(id), id).toBe("LULUS");
    expect(r.out).toMatch(/Hasil: 25 lulus, 0 gagal/);
    expect(r.code).toBe(0);
  });

  it("hanya membaca: tidak memanggil perintah yang mengubah apa pun", () => {
    const r = run(healthy());
    const called = r.log();
    expect(called.length).toBeGreaterThan(0);
    expect(called).not.toMatch(/--add|--remove|--permanent|--reload|--set|setenforce|setsebool|useradd|usermod|chmod|chown|enable |disable |start |stop |restart |ALTER|GRANT|REVOKE|DROP|INSERT|DELETE FROM|TRUNCATE TABLE/i);
  });

  it("port SSH kustom yang dibuka di firewall juga LULUS", () => {
    const s = healthy(); s.sshd = s.sshd.map((l) => (l === "port 22" ? "port 2222" : l)); s.fwServices = "http https"; s.fwPorts = "2222/tcp";
    expect(run(s).status("firewall-port")).toBe("LULUS");
  });

  it("layanan lokal yang belum berjalan (9000, 9001) tidak terbuka ke luar, jadi LULUS", () => {
    const s = healthy(); s.ss = s.ss.filter((l) => !/:(9000|9001)\b/.test(l));
    const r = run(s);
    expect(r.status("dengar-web")).toBe("LULUS");
    expect(r.status("dengar-api")).toBe("LULUS");
  });

  it("mode folder file 700 juga LULUS", () => {
    const s = healthy(); s.files = "hayatun hayatun 700";
    expect(run(s).status("file-mode")).toBe("LULUS");
  });
});

// kolom ke-4: pemeriksaan lain yang ikut GAGAL karena tidak bisa diverifikasi (firewalld mati berarti port juga tidak terlindungi)
const BAD: [string, string, (s: Server) => void, string[]?][] = [
  ["login SSH dengan password", "ssh-password", (s) => { s.sshd = s.sshd.map((l) => l.replace("passwordauthentication no", "passwordauthentication yes")); }],
  ["login root lewat SSH", "ssh-root", (s) => { s.sshd = s.sshd.map((l) => l.replace("permitrootlogin no", "permitrootlogin yes")); }],
  ["root boleh masuk dengan kunci (prohibit-password)", "ssh-root", (s) => { s.sshd = s.sshd.map((l) => l.replace("permitrootlogin no", "permitrootlogin prohibit-password")); }],
  ["login dengan kunci dimatikan", "ssh-kunci", (s) => { s.sshd = s.sshd.map((l) => l.replace("pubkeyauthentication yes", "pubkeyauthentication no")); }],
  ["firewalld tidak berjalan", "firewall-aktif", (s) => { s.fwState = "not running"; }, ["firewall-port"]],
  ["layanan tambahan terbuka (cockpit)", "firewall-port", (s) => { s.fwServices = "ssh http https cockpit"; }],
  ["port 9000 terbuka di firewall", "firewall-port", (s) => { s.fwPorts = "9000/tcp"; }],
  ["port 5432 terbuka di firewall", "firewall-port", (s) => { s.fwPorts = "5432/tcp"; }],
  ["HTTP tidak terbuka, bukan hanya SSH", "firewall-port", (s) => { s.fwServices = "ssh https"; }],
  ["SELinux permissive", "selinux", (s) => { s.selinux = "Permissive"; }],
  ["SELinux dimatikan", "selinux", (s) => { s.selinux = "Disabled"; }],
  ["boolean Nginx ke port lokal mati", "selinux-nginx", (s) => { s.httpdNet = "httpd_can_network_connect --> off"; }],
  ["Next.js (9000) mendengarkan di semua antarmuka", "dengar-web", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:9000", "0.0.0.0:9000")); }],
  ["Express (9001) mendengarkan di IPv6 semua antarmuka", "dengar-api", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:9001", "[::]:9001")); }],
  ["Express (9001) mendengarkan di *", "dengar-api", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:9001", "*:9001")); }],
  ["PostgreSQL mendengarkan di semua antarmuka", "dengar-5432", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:5432", "0.0.0.0:5432")); }],
  ["pengguna hayatun tidak ada", "pengguna-hayatun", (s) => { s.passwd = ""; }],
  ["pengguna hayatun punya shell login", "pengguna-shell", (s) => { s.passwd = "hayatun:x:1001:1001:Hayatun:/home/hayatun:/bin/bash"; }],
  ["pengguna hayatun anggota wheel (sudo)", "pengguna-sudo", (s) => { s.groups = "hayatun wheel"; }],
  ["folder file dimiliki root", "file-pemilik", (s) => { s.files = "root root 750"; }],
  ["folder file bisa dibaca pengguna lain (755)", "file-mode", (s) => { s.files = "hayatun hayatun 755"; }],
  ["folder file bisa ditulis pengguna lain (777)", "file-mode", (s) => { s.files = "hayatun hayatun 777"; }],
  ["peran aplikasi PostgreSQL adalah superuser", "pg-superuser", (s) => { s.pg.rolsuper = "t"; }],
  ["peran aplikasi bisa UPDATE audit_logs", "pg-audit-ubah", (s) => { s.pg.update = "t"; }],
  ["peran aplikasi bisa DELETE audit_logs", "pg-audit-hapus", (s) => { s.pg.delete = "t"; }],
  ["peran aplikasi bisa TRUNCATE audit_logs", "pg-audit-kosongkan", (s) => { s.pg.truncate = "t"; }],
  ["pg_hba.conf memakai trust", "pg-trust", (s) => { s.pg.trust = "2"; }],
  ["pg_hba.conf mengizinkan sambungan dari luar", "pg-luar", (s) => { s.pg.remote = "1"; }],
  ["listen_addresses PostgreSQL adalah *", "pg-dengar", (s) => { s.pg.listen = "*"; }],
  ["pembaruan keamanan otomatis mati", "pembaruan-otomatis", (s) => { s.dnf = "disabled"; }],
  ["port aaPanel masih bawaan 8888", "aapanel-port", (s) => { s.panelPort = "8888"; }],
];

describe.each(BAD)("kelemahan: %s", (_name, id, mutate, also = []) => {
  it(`${id} GAGAL, pemeriksaan lain tidak terpengaruh, dan skrip keluar dengan kode 1`, () => {
    const s = healthy(); mutate(s);
    const r = run(s);
    expect(r.status(id)).toBe("GAGAL");
    const gagal = IDS.filter((x) => r.status(x) === "GAGAL");
    expect(gagal).toEqual([id, ...also].sort((a, b) => IDS.indexOf(a) - IDS.indexOf(b)));
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Hasil: ${25 - gagal.length} lulus, ${gagal.length} gagal`);
  });
});

// T63 (N34, ARCHITECTURE K10): CentOS Stream 9 berhenti didukung 31 Mei 2027. Pemeriksa harus menyatakan sistem operasi yang didukung.
describe("sistem operasi yang didukung (os-didukung)", () => {
  const withOs = (os: string | null, today = "2026-11-01") => { const s = healthy(); s.osRelease = os; s.today = today; return run(s); };
  const CENTOS = osRelease("centos", "CentOS Stream", "9");

  it.each([["AlmaLinux 9.4", osRelease("almalinux", "AlmaLinux", "9.4")], ["Rocky Linux 9.3", osRelease("rocky", "Rocky Linux", "9.3")], ["RHEL 9.4", osRelease("rhel", "Red Hat Enterprise Linux", "9.4")], ["AlmaLinux 10", osRelease("almalinux", "AlmaLinux", "10.0")]])("%s: LULUS, juga sesudah 31 Mei 2027", (_n, os) => {
    expect(withOs(os).status("os-didukung")).toBe("LULUS");
    expect(withOs(os, "2028-01-01").status("os-didukung")).toBe("LULUS");
  });

  it("CentOS Stream 9 sebelum batas: PERIKSA, menyebut tanggal dan sisa hari, dan rujukan runbook; keluar 0", () => {
    const r = withOs(CENTOS);
    expect(r.status("os-didukung")).toBe("PERIKSA");
    expect(r.out).toMatch(/^PERIKSA\s+os-didukung.*31 Mei 2027.*211 hari/m);
    expect(r.out).toContain("docs/migrasi-os.md");
    expect(r.code).toBe(0);
  });
  it("batas tepat: 31 Mei 2027 masih PERIKSA (0 hari), 1 Juni 2027 GAGAL dan keluar 1", () => {
    const last = withOs(CENTOS, "2027-05-31");
    expect(last.status("os-didukung")).toBe("PERIKSA");
    expect(last.out).toMatch(/^PERIKSA\s+os-didukung.*\b0 hari/m);
    expect(last.code).toBe(0);
    const after = withOs(CENTOS, "2027-06-01");
    expect(after.status("os-didukung")).toBe("GAGAL");
    expect(after.out).toMatch(/^GAGAL\s+os-didukung.*berakhir/m);
    expect(after.code).toBe(1);
  });
  it("CentOS Stream 10 tidak ikut batas 2027: tetap PERIKSA (bukan GAGAL) walau sesudah 31 Mei 2027", () => {
    const r = withOs(osRelease("centos", "CentOS Stream", "10"), "2028-01-01");
    expect(r.status("os-didukung")).toBe("PERIKSA");
    expect(r.code).toBe(0);
  });
  it("hanya os-didukung yang berubah: pemeriksaan lain tetap LULUS saat CentOS Stream lewat batas", () => {
    const r = withOs(CENTOS, "2027-06-01");
    expect(IDS.filter((x) => r.status(x) === "GAGAL")).toEqual(["os-didukung"]);
  });
  it.each([["AlmaLinux 8 (belum diuji)", osRelease("almalinux", "AlmaLinux", "8.10")], ["Ubuntu", osRelease("ubuntu", "Ubuntu", "24.04")], ["CentOS Stream 10", osRelease("centos", "CentOS Stream", "10")], ["berkas tanpa ID", 'NAME="Entah"\n'], ["berkas kosong", ""]])("%s: PERIKSA manual, bukan lulus dan bukan gagal", (_n, os) => {
    const r = withOs(os);
    expect(r.status("os-didukung")).toBe("PERIKSA");
    expect(r.code).toBe(0);
  });
  it("berkas os-release tidak ada: PERIKSA, skrip tidak rusak", () => {
    const r = withOs(null);
    expect(r.status("os-didukung")).toBe("PERIKSA");
    expect(r.status("ssh-password")).toBe("LULUS");
  });
  it("isi os-release tidak dijalankan sebagai perintah (berkas tidak tepercaya)", () => {
    const r = withOs('ID="almalinux"\nVERSION_ID="9.4"\nNAME="$(touch /tmp/hayatun-os-injeksi)"\n');
    expect(existsSync("/tmp/hayatun-os-injeksi")).toBe(false);
    expect(r.status("os-didukung")).toBe("LULUS");
  });
});

describe("port lokal aplikasi (T66)", () => {
  it("bawaan 9000 (web) dan 9001 (API); HAYATUN_WEB_PORT/HAYATUN_API_PORT menggantinya", () => {
    const s = healthy(); s.ss = s.ss.map((l) => l.replace("127.0.0.1:9000", "0.0.0.0:9000"));
    expect(run(s).status("dengar-web")).toBe("GAGAL");
    const moved = healthy(); moved.ss = moved.ss.map((l) => l.replace("127.0.0.1:9000", "0.0.0.0:9100"));
    expect(run(moved).status("dengar-web")).toBe("LULUS"); // 9100 bukan port aplikasi bila tidak diatur
    expect(run(moved, { env: { HAYATUN_WEB_PORT: "9100" } }).status("dengar-web")).toBe("GAGAL");
  });
});

describe("perilaku skrip", () => {
  it("bukan root: berhenti dengan kode 2 dan pesan jelas, tanpa memeriksa apa pun", () => {
    const s = healthy(); s.uid = "1000";
    const r = run(s);
    expect(r.code).toBe(2);
    expect(r.out + r.err).toMatch(/sudo/i);
    expect(r.status("ssh-password")).toBeUndefined();
  });

  it("beberapa kelemahan sekaligus: semuanya dilaporkan, tidak berhenti di yang pertama", () => {
    const s = healthy(); s.selinux = "Permissive"; s.pg.trust = "1"; s.dnf = "disabled";
    const r = run(s);
    expect(IDS.filter((x) => r.status(x) === "GAGAL").sort()).toEqual(["pembaruan-otomatis", "pg-trust", "selinux"]);
    expect(r.out).toMatch(/3 gagal/);
    expect(r.code).toBe(1);
  });

  it("perintah yang tidak ada (firewall-cmd) dilaporkan GAGAL dengan alasan, bukan membuat skrip rusak", () => {
    const r = run(healthy(), { drop: ["firewall-cmd"] });
    expect(r.status("firewall-aktif")).toBe("GAGAL");
    expect(r.out).toMatch(/firewall-cmd.*tidak (ditemukan|ada)/i);
    expect(r.status("ssh-password")).toBe("LULUS"); // pemeriksaan lain tetap jalan
    expect(r.code).toBe(1);
  });

  it("psql tidak bisa dihubungi: pemeriksaan PostgreSQL GAGAL, bukan lolos diam-diam", () => {
    const r = run(healthy(), { drop: ["psql"] });
    for (const id of ["pg-superuser", "pg-audit-ubah", "pg-audit-hapus", "pg-audit-kosongkan", "pg-trust", "pg-luar", "pg-dengar"]) expect(r.status(id), id).toBe("GAGAL");
    expect(r.code).toBe(1);
  });

  it("jawaban aneh dari perintah tidak dianggap lolos (SELinux kosong, sshd tanpa baris yang dicari)", () => {
    const s = healthy(); s.selinux = ""; s.sshd = ["port 22"];
    const r = run(s);
    expect(r.status("selinux")).toBe("GAGAL");
    for (const id of ["ssh-password", "ssh-root", "ssh-kunci"]) expect(r.status(id), id).toBe("GAGAL");
  });

  it("berkas port aaPanel tidak ada: PERIKSA manual, bukan gagal dan bukan lulus", () => {
    const s = healthy(); s.panelPort = null;
    const r = run(s);
    expect(r.status("aapanel-port")).toBe("PERIKSA");
    expect(r.out).toMatch(/verifikasi dua langkah/i); // pengingat pemeriksaan manual aaPanel
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Hasil: 24 lulus, 0 gagal, 1 perlu dicek manual/);
  });

  it("pesan memakai bahasa Indonesia dan tidak mencetak data sensitif", () => {
    const r = run(healthy());
    expect(r.out).toMatch(/LULUS/);
    expect(r.out).not.toMatch(/password\s*[:=]\s*\S+/i);
  });
});
