import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// ops/check-server.sh memeriksa server lewat perintah sistem (sshd, firewall-cmd, getenforce, ss, psql, dll.).
// Di sini perintah itu ditiru lewat PATH, sehingga logika LULUS/GAGAL teruji tanpa server sungguhan.
const SCRIPT = join(__dirname, "check-server.sh");

type Stubs = Record<string, string>; // nama perintah -> isi badan `case "$*"` atau skrip bash utuh
const SSHD = ["port 22", "permitrootlogin no", "passwordauthentication no", "pubkeyauthentication yes", "kbdinteractiveauthentication no"];
const SS = ["LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*", "LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*", "LISTEN 0 244 127.0.0.1:5432 0.0.0.0:*", "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*", "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*", "LISTEN 0 511 0.0.0.0:443 0.0.0.0:*"];

interface Server {
  uid: string; sshd: string[]; fwState: string; fwServices: string; fwPorts: string; selinux: string; httpdNet: string; ss: string[];
  passwd: string; groups: string; files: string; dnf: string; panelPort: string | null;
  pg: { rolsuper: string; update: string; delete: string; truncate: string; trust: string; remote: string; listen: string };
}
const healthy = (): Server => ({
  uid: "0", sshd: [...SSHD], fwState: "running", fwServices: "ssh http https", fwPorts: "", selinux: "Enforcing", httpdNet: "httpd_can_network_connect --> on", ss: [...SS],
  passwd: "hayatun:x:1001:1001:Hayatun:/home/hayatun:/sbin/nologin", groups: "hayatun", files: "hayatun hayatun 750", dnf: "enabled", panelPort: "28888",
  pg: { rolsuper: "f", update: "f", delete: "f", truncate: "f", trust: "0", remote: "0", listen: "localhost" },
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
  return { dir, bin, log, panel };
}

function run(s: Server, opts: { drop?: string[]; env?: Record<string, string> } = {}) {
  const b = build(s, opts);
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { PATH: `${b.bin}:/usr/bin:/bin`, HAYATUN_PSQL: join(b.bin, "psql"), HAYATUN_AAPANEL_PORT_FILE: b.panel, HAYATUN_FILES_DIR: "/srv/hayatun/files", ...opts.env },
  });
  const lines = (r.stdout ?? "").split("\n");
  const status = (id: string) => lines.find((l) => new RegExp(`^(LULUS|GAGAL|PERIKSA)\\s+${id}\\b`).test(l))?.split(/\s+/)[0];
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", status, log: () => (readFileSync(b.log, { encoding: "utf8", flag: "a+" })) };
}

const IDS = ["ssh-password", "ssh-root", "ssh-kunci", "firewall-aktif", "firewall-port", "selinux", "selinux-nginx", "dengar-3000", "dengar-4000", "dengar-5432", "pengguna-hayatun", "pengguna-shell", "pengguna-sudo", "file-pemilik", "file-mode", "pg-superuser", "pg-audit-ubah", "pg-audit-hapus", "pg-audit-kosongkan", "pg-trust", "pg-luar", "pg-dengar", "pembaruan-otomatis", "aapanel-port"];

describe("server yang sehat", () => {
  it("semua pemeriksaan LULUS dan skrip keluar dengan kode 0", () => {
    const r = run(healthy());
    expect(r.err).toBe("");
    for (const id of IDS) expect(r.status(id), id).toBe("LULUS");
    expect(r.out).toMatch(/Hasil: 24 lulus, 0 gagal/);
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

  it("layanan lokal yang belum berjalan (3000, 4000) tidak terbuka ke luar, jadi LULUS", () => {
    const s = healthy(); s.ss = s.ss.filter((l) => !/:(3000|4000)\b/.test(l));
    const r = run(s);
    expect(r.status("dengar-3000")).toBe("LULUS");
    expect(r.status("dengar-4000")).toBe("LULUS");
  });

  it("mode folder file 700 juga LULUS", () => {
    const s = healthy(); s.files = "hayatun hayatun 700";
    expect(run(s).status("file-mode")).toBe("LULUS");
  });
});

const BAD: [string, string, (s: Server) => void][] = [
  ["login SSH dengan password", "ssh-password", (s) => { s.sshd = s.sshd.map((l) => l.replace("passwordauthentication no", "passwordauthentication yes")); }],
  ["login root lewat SSH", "ssh-root", (s) => { s.sshd = s.sshd.map((l) => l.replace("permitrootlogin no", "permitrootlogin yes")); }],
  ["root boleh masuk dengan kunci (prohibit-password)", "ssh-root", (s) => { s.sshd = s.sshd.map((l) => l.replace("permitrootlogin no", "permitrootlogin prohibit-password")); }],
  ["login dengan kunci dimatikan", "ssh-kunci", (s) => { s.sshd = s.sshd.map((l) => l.replace("pubkeyauthentication yes", "pubkeyauthentication no")); }],
  ["firewalld tidak berjalan", "firewall-aktif", (s) => { s.fwState = "not running"; }],
  ["layanan tambahan terbuka (cockpit)", "firewall-port", (s) => { s.fwServices = "ssh http https cockpit"; }],
  ["port 3000 terbuka di firewall", "firewall-port", (s) => { s.fwPorts = "3000/tcp"; }],
  ["port 5432 terbuka di firewall", "firewall-port", (s) => { s.fwPorts = "5432/tcp"; }],
  ["HTTP tidak terbuka, bukan hanya SSH", "firewall-port", (s) => { s.fwServices = "ssh https"; }],
  ["SELinux permissive", "selinux", (s) => { s.selinux = "Permissive"; }],
  ["SELinux dimatikan", "selinux", (s) => { s.selinux = "Disabled"; }],
  ["boolean Nginx ke port lokal mati", "selinux-nginx", (s) => { s.httpdNet = "httpd_can_network_connect --> off"; }],
  ["Next.js (3000) mendengarkan di semua antarmuka", "dengar-3000", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:3000", "0.0.0.0:3000")); }],
  ["Express (4000) mendengarkan di IPv6 semua antarmuka", "dengar-4000", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:4000", "[::]:4000")); }],
  ["Express (4000) mendengarkan di *", "dengar-4000", (s) => { s.ss = s.ss.map((l) => l.replace("127.0.0.1:4000", "*:4000")); }],
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

describe.each(BAD)("kelemahan: %s", (_name, id, mutate) => {
  it(`${id} GAGAL, pemeriksaan lain tidak terpengaruh, dan skrip keluar dengan kode 1`, () => {
    const s = healthy(); mutate(s);
    const r = run(s);
    expect(r.status(id)).toBe("GAGAL");
    const gagal = IDS.filter((x) => r.status(x) === "GAGAL");
    expect(gagal).toEqual([id]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Hasil: 23 lulus, 1 gagal/);
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
    expect(r.out).toMatch(/Hasil: 23 lulus, 0 gagal, 1 perlu dicek manual/);
  });

  it("pesan memakai bahasa Indonesia dan tidak mencetak data sensitif", () => {
    const r = run(healthy());
    expect(r.out).toMatch(/LULUS/);
    expect(r.out).not.toMatch(/password\s*[:=]\s*\S+/i);
  });
});
