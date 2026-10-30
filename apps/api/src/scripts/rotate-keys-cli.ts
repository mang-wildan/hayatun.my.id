import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { createCrypto } from "../modules/crypto/index.js";
import { rotateKeys } from "./rotate-keys.js";

// Pemakaian: npm -w apps/api run rotate-keys -- [--status | --dry-run]   (tanpa opsi: putar sungguhan). docs/operasi.md.
const arg = process.argv.slice(2);
const MODES = { "--status": "status", "--dry-run": "dry-run" } as const;
if (arg.length > 1 || (arg.length === 1 && !(arg[0] in MODES))) {
  console.error("Pemakaian: rotate-keys [--status | --dry-run]");
  process.exit(2);
}
const mode = arg.length ? MODES[arg[0] as keyof typeof MODES] : "run";

let config: ReturnType<typeof loadConfig>;
try { config = loadConfig(process.env); } catch (err) { console.error(`Konfigurasi salah: ${(err as Error).message}`); process.exit(2); }

const { db, pool } = createDb(config.databaseUrl);
const crypto = createCrypto({ keys: config.encryptionKeys, activeKeyId: config.activeKeyId, blindIndexKey: config.blindIndexKey });
const fmt = (m: Record<string, number>) => Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}=${n}`).join(" ") || "-";
try {
  const r = await rotateKeys({ db, crypto, storageDir: config.storage.dir, mode });
  console.log(`Kunci aktif: ${crypto.activeKeyId}`);
  console.log(`Sebelum: ${fmt(r.before)}`);
  if (mode === "status") console.log("Mode status: tidak ada yang diubah.");
  else console.log(`${mode === "dry-run" ? "Akan diputar" : "Diputar"}: ${r.rotated}, dilewati (berubah saat berjalan): ${r.skippedChanged}, gagal: ${r.failed.length}`);
  console.log(`Sesudah: ${fmt(r.after)}`);
  for (const f of r.failed) console.log(`GAGAL ${f.where} ${f.id}: ${f.reason}`);
  const others = Object.keys(r.after).filter((k) => k !== crypto.activeKeyId);
  if (mode === "run" && !others.length) console.log(`Semua nilai memakai ${crypto.activeKeyId}. Kunci lama boleh dilepas dari server; simpan di penyimpanan terpisah selama 30 hari (cadangan lama).`);
  else if (mode === "run") console.log("Masih ada nilai di kunci lain (dilewati atau gagal): JANGAN lepas kunci lama. Jalankan ulang setelah memperbaiki.");
  process.exitCode = r.failed.length ? 1 : 0;
} catch (err) {
  console.error(`Gagal: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
