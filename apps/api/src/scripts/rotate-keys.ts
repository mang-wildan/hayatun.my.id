import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { addresses, licenseCodes, orders, users } from "../db/schema.js";
import type { Crypto } from "../modules/crypto/index.js";

// N35: memutar semua nilai terenkripsi ke kunci aktif supaya kunci lama bisa dilepas. Aman dijalankan saat aplikasi hidup:
// tiap nilai ditulis dengan `WHERE kolom = nilai lama`, jadi baris yang diubah aplikasi di sela-selanya tidak ditimpa.
// Blind index (HMAC) bukan bagian dari ini: ia memakai BLIND_INDEX_KEY, bukan kunci enkripsi.
const TARGETS: [PgTable, PgColumn][] = [
  [users, users.emailEnc], [users, users.nameEnc], [users, users.phoneEnc], [users, users.totpSecretEnc],
  [licenseCodes, licenseCodes.codeEnc],
  [addresses, addresses.recipientEnc], [addresses, addresses.phoneEnc], [addresses, addresses.addressEnc],
  [orders, orders.shipRecipientEnc], [orders, orders.shipPhoneEnc], [orders, orders.shipAddressEnc],
];
export const ROTATED_COLUMNS = TARGETS.map(([t, c]) => `${getTableName(t)}.${c.name}`);
const PROOF_FILE_COLUMN = "payment_proofs.storage_key"; // satu-satunya file yang dienkripsi aplikasi (sampul dan file produk apa adanya)
const PROOF_KEY_RE = /^proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/;

export interface RotateOptions {
  db: Db;
  crypto: Crypto;
  storageDir: string;
  mode: "status" | "dry-run" | "run";
  batchSize?: number;
  /** Hanya untuk tes: dipanggil sesudah membaca dan sebelum menulis satu nilai, untuk meniru perubahan dari aplikasi. */
  beforeWrite?: (info: { column: string; id: string }) => Promise<void>;
}
export interface RotateReport {
  before: Record<string, number>; // jumlah nilai per ID kunci sebelum
  after: Record<string, number>; // sesudah (pada status/dry-run sama dengan before)
  rotated: number; // dry-run: yang AKAN diputar
  skippedChanged: number; // berubah saat berjalan; diambil putaran berikutnya
  failed: { where: string; id: string; reason: string }[]; // alasan tetap, tidak pernah memuat nilai atau token
}

const count = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const UNREADABLE = "tidak bisa dibuka (ID kunci tidak dikenal atau data rusak)";

export async function rotateKeys({ db, crypto, storageDir, mode, batchSize = 200, beforeWrite }: RotateOptions): Promise<RotateReport> {
  const active = crypto.activeKeyId;
  const r: RotateReport = { before: {}, after: {}, rotated: 0, skippedChanged: 0, failed: [] };
  const fail = (where: string, id: string, reason: string, keyId: string) => { r.failed.push({ where, id, reason }); count(r.after, keyId); };

  // Memproses satu nilai; `write` menulis hasilnya dan mengembalikan false bila nilai sudah berubah (hanya dipanggil pada mode run).
  async function visit(where: string, id: string, keyId: string, rotate: () => Promise<boolean>) {
    count(r.before, keyId);
    if (keyId === active || mode === "status") return count(r.after, keyId);
    if (mode === "dry-run") { r.rotated++; return count(r.after, keyId); }
    if (await rotate()) { r.rotated++; count(r.after, active); } else { r.skippedChanged++; count(r.after, keyId); }
  }

  for (const [table, col] of TARGETS) {
    const t = sql.identifier(getTableName(table)), c = sql.identifier(col.name), where = `${getTableName(table)}.${col.name}`;
    for (let last = ""; ;) {
      const { rows } = await db.execute<{ id: string; v: string }>(sql`select id, ${c} as v from ${t} where ${c} is not null and id::text > ${last} order by id::text limit ${batchSize}`);
      for (const { id, v } of rows) {
        const parts = v.split(":");
        if (parts.length !== 5 || parts[0] !== "v1") { fail(where, id, "format tidak dikenal", "?"); count(r.before, "?"); continue; }
        await visit(where, id, parts[1], async () => {
          let next: string;
          try {
            const plain = crypto.decrypt(v);
            next = crypto.encrypt(plain);
            if (crypto.decrypt(next) !== plain) throw new Error();
          } catch { r.failed.push({ where, id, reason: UNREADABLE }); throw new Unreadable(); }
          await beforeWrite?.({ column: where, id });
          const res = await db.execute(sql`update ${t} set ${c} = ${next} where id = ${id} and ${c} = ${v}`);
          return res.rowCount === 1;
        }).catch((e) => { if (!(e instanceof Unreadable)) throw e; count(r.after, parts[1]); });
      }
      if (rows.length < batchSize) break;
      last = rows[rows.length - 1].id;
    }
  }

  // file bukti bayar yang masih ada (file_deleted_at kosong)
  for (let last = ""; ;) {
    const { rows } = await db.execute<{ id: string; key: string }>(sql`select id, storage_key as key from payment_proofs where file_deleted_at is null and id::text > ${last} order by id::text limit ${batchSize}`);
    for (const { id, key } of rows) {
      const path = join(storageDir, key);
      let data: Buffer;
      try {
        if (!PROOF_KEY_RE.test(key)) throw new Error("kunci file tidak sah");
        data = await readFile(path);
      } catch { r.failed.push({ where: PROOF_FILE_COLUMN, id, reason: "file hilang atau tidak terbaca" }); count(r.before, "?"); count(r.after, "?"); continue; }
      const keyId = data.length > 3 && data.subarray(0, 2).toString() === "v1" ? data.subarray(3, 3 + data[2]).toString() : "?";
      try {
        await visit(PROOF_FILE_COLUMN, id, keyId, async () => {
          let next: Buffer;
          try {
            const plain = crypto.decryptBuffer(data);
            next = crypto.encryptBuffer(plain);
            if (!crypto.decryptBuffer(next).equals(plain)) throw new Error();
          } catch { r.failed.push({ where: PROOF_FILE_COLUMN, id, reason: UNREADABLE }); throw new Unreadable(); }
          const tmp = join(storageDir, "proofs", `.tmp-rotate-${randomUUID()}`);
          try {
            await writeFile(tmp, next, { mode: 0o600 });
            await chmod(tmp, (await stat(path)).mode & 0o777);
            await rename(tmp, path); // atomik: pembaca melihat file lama utuh atau file baru utuh
          } finally { await rm(tmp, { force: true }); }
          return true;
        });
      } catch (e) { if (!(e instanceof Unreadable)) throw e; count(r.after, keyId); }
    }
    if (rows.length < batchSize) break;
    last = rows[rows.length - 1].id;
  }
  return r;
}

class Unreadable extends Error {}
