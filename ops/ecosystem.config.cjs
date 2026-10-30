// PM2 (T58). Dua proses, satu instance masing-masing, dijalankan dari tautan `current` milik skrip deploy.
// Variabel lingkungan dibaca dari shared/.env (di luar repo, chmod 600). API menerima semuanya; web hanya yang ia pakai,
// supaya kunci enkripsi dan rahasia sesi tidak ada di lingkungan proses Next.js.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = process.env.HAYATUN_ROOT || "/srv/hayatun";

// KEY=nilai per baris; komentar (#) dan baris kosong dilewati; nilai boleh diapit tanda kutip. Tanpa komentar di akhir baris.
function readEnv(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return {}; }
  const env = {};
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || raw.trim().startsWith("#")) continue;
    let value = m[2].trim();
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) value = value.slice(1, -1);
    env[m[1]] = value;
  }
  return env;
}

const shared = readEnv(join(ROOT, "shared/.env"));
const WEB_KEYS = ["API_INTERNAL_URL"];
const webEnv = Object.fromEntries(WEB_KEYS.filter((k) => k in shared).map((k) => [k, shared[k]]));
const logs = join(ROOT, "shared/logs");

const common = { instances: 1, exec_mode: "fork", script: "npm", args: "run start", autorestart: true, max_memory_restart: "700M", kill_timeout: 10_000, time: true };

module.exports = {
  apps: [
    { ...common, name: "hayatun-api", cwd: join(ROOT, "current/apps/api"), env: { ...shared, NODE_ENV: "production" }, out_file: join(logs, "api.out.log"), error_file: join(logs, "api.err.log") },
    { ...common, name: "hayatun-web", cwd: join(ROOT, "current/apps/web"), env: { ...webEnv, NODE_ENV: "production" }, out_file: join(logs, "web.out.log"), error_file: join(logs, "web.err.log") },
  ],
};
