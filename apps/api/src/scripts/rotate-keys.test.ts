import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { addresses, licenseCodes, orders, paymentProofs, products, users } from "../db/schema.js";
import { createCrypto } from "../modules/crypto/index.js";
import { createTestContext, type TestContext } from "../test/context.js";
import { ROTATED_COLUMNS, rotateKeys } from "./rotate-keys.js";

// N35: mengganti kunci enkripsi data. Prosedur: kunci baru jadi aktif (kunci lama tetap ikut dibaca), skrip ini memutar ulang semua
// nilai terenkripsi dan file bukti bayar ke kunci aktif, lalu kunci lama boleh dilepas dari server (tetap disimpan 30 hari untuk cadangan lama).

const PLAIN = {
  emailA: "ani@contoh.id", nameA: "Ani Wijaya", phoneA: "081200001111", totpA: "JBSWY3DPEHPK3PXP",
  emailB: "budi@contoh.id", code: "LISENSI-AAAA-BBBB", recipient: "Citra Dewi", phone: "081355556666", address: "Jl. Melati No. 7, Bandung",
  shipRecipient: "Dedi Kurnia", shipPhone: "081377778888", shipAddress: "Jl. Kenanga No. 9, Surabaya",
};
const PROOF = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(300)]);
const b64 = () => randomBytes(32).toString("base64");

let ctx: TestContext;
let oldKey: Buffer, newKey: Buffer, blind: Buffer;
let oldCrypto: ReturnType<typeof createCrypto>, newCrypto: ReturnType<typeof createCrypto>;
const ids = {} as { userA: string; userB: string; codeId: string; addressId: string; orderId: string; proofId: string; deletedProofId: string; proofKey: string };

beforeEach(async () => {
  ctx = await createTestContext();
  oldKey = ctx.config.encryptionKeys.k1; newKey = Buffer.from(b64(), "base64"); blind = ctx.config.blindIndexKey;
  oldCrypto = createCrypto({ keys: { k1: oldKey }, activeKeyId: "k1", blindIndexKey: blind });
  newCrypto = createCrypto({ keys: { k1: oldKey, k2: newKey }, activeKeyId: "k2", blindIndexKey: blind });

  const e = (s: string) => oldCrypto.encrypt(s);
  const [a] = await ctx.db.insert(users).values({ role: "buyer", emailEnc: e(PLAIN.emailA), emailIndex: oldCrypto.blindIndex(PLAIN.emailA), nameEnc: e(PLAIN.nameA), phoneEnc: e(PLAIN.phoneA), totpSecretEnc: e(PLAIN.totpA) }).returning({ id: users.id });
  const [b] = await ctx.db.insert(users).values({ role: "buyer", emailEnc: e(PLAIN.emailB), emailIndex: oldCrypto.blindIndex(PLAIN.emailB) }).returning({ id: users.id }); // kolom lain NULL
  const [p] = await ctx.db.insert(products).values({ slug: "kode", name: "Kode", type: "digital", price: 10000, isLicensed: true }).returning({ id: products.id });
  const [c] = await ctx.db.insert(licenseCodes).values({ productId: p.id, codeEnc: e(PLAIN.code), codeIndex: oldCrypto.blindIndex(PLAIN.code) }).returning({ id: licenseCodes.id });
  const [ad] = await ctx.db.insert(addresses).values({ userId: a.id, recipientEnc: e(PLAIN.recipient), phoneEnc: e(PLAIN.phone), addressEnc: e(PLAIN.address), areaId: "area-1", postalCode: "40111" }).returning({ id: addresses.id });
  const base = { userId: a.id, status: "MENUNGGU_VERIFIKASI", digitalStatus: "TIDAK_ADA", physicalStatus: "MENUNGGU", subtotal: 10000, shippingCost: 0, total: 10000, expiresAt: new Date("2030-01-01") } as const;
  const [o] = await ctx.db.insert(orders).values({ ...base, invoiceNumber: "INV-202610-0001", shipRecipientEnc: e(PLAIN.shipRecipient), shipPhoneEnc: e(PLAIN.shipPhone), shipAddressEnc: e(PLAIN.shipAddress) }).returning({ id: orders.id });
  await ctx.db.insert(orders).values({ ...base, invoiceNumber: "INV-202610-0002" }); // tanpa alamat kirim (produk digital)
  const proofKey = await ctx.storage.save("proofs", oldCrypto.encryptBuffer(PROOF), { allowed: "any", maxBytes: 5_000_000 });
  const [pr] = await ctx.db.insert(paymentProofs).values({ orderId: o.id, storageKey: proofKey, mime: "image/jpeg", sizeBytes: PROOF.length }).returning({ id: paymentProofs.id });
  // bukti yang filenya sudah dihapus (F12.3): barisnya tetap, tidak ada file untuk diputar
  const [dp] = await ctx.db.insert(paymentProofs).values({ orderId: o.id, storageKey: `proofs/${randomUUID()}.bin`, mime: "image/jpeg", sizeBytes: 1, fileDeletedAt: new Date("2030-01-01") }).returning({ id: paymentProofs.id });
  Object.assign(ids, { userA: a.id, userB: b.id, codeId: c.id, addressId: ad.id, orderId: o.id, proofId: pr.id, deletedProofId: dp.id, proofKey });
});
afterEach(() => ctx.close());

const TOTAL = 13; // 4 + 1 (users) + 1 (kode) + 3 (alamat) + 3 (alamat kirim pesanan) + 1 file bukti
const keyIdOf = (token: string) => token.split(":")[1];
const proofPath = () => join(ctx.config.storage.dir, ids.proofKey);
const keyIdOfFile = (buf: Buffer) => buf.subarray(3, 3 + buf[2]).toString();
const rotate = (over: Record<string, unknown> = {}) => rotateKeys({ db: ctx.db, crypto: newCrypto, storageDir: ctx.config.storage.dir, mode: "run", ...over } as Parameters<typeof rotateKeys>[0]);

async function snapshot() {
  const [a] = await ctx.db.select().from(users).where(eq(users.id, ids.userA));
  const [b] = await ctx.db.select().from(users).where(eq(users.id, ids.userB));
  const [c] = await ctx.db.select().from(licenseCodes);
  const [ad] = await ctx.db.select().from(addresses);
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, ids.orderId));
  return { a, b, c, ad, o, file: readFileSync(proofPath()) };
}
const tokens = (s: Awaited<ReturnType<typeof snapshot>>) => [s.a.emailEnc, s.a.nameEnc, s.a.phoneEnc, s.a.totpSecretEnc, s.b.emailEnc, s.c.codeEnc, s.ad.recipientEnc, s.ad.phoneEnc, s.ad.addressEnc, s.o.shipRecipientEnc, s.o.shipPhoneEnc, s.o.shipAddressEnc] as string[];

describe("mode status dan dry-run: tidak mengubah apa pun", () => {
  it("status menghitung nilai per ID kunci", async () => {
    const r = await rotate({ mode: "status" });
    expect(r.before).toEqual({ k1: TOTAL });
    expect(r.after).toEqual({ k1: TOTAL });
    expect(r.rotated).toBe(0);
    expect(r.failed).toEqual([]);
  });
  it("status dan dry-run tidak menulis ke database maupun file", async () => {
    const before = await snapshot();
    const mtime = statSync(proofPath()).mtimeMs;
    await rotate({ mode: "status" });
    const dry = await rotate({ mode: "dry-run" });
    expect(dry.rotated).toBe(TOTAL); // yang AKAN diputar
    expect(dry.after).toEqual({ k1: TOTAL });
    const after = await snapshot();
    expect(tokens(after)).toEqual(tokens(before));
    expect(after.file.equals(before.file)).toBe(true);
    expect(statSync(proofPath()).mtimeMs).toBe(mtime);
  });
});

describe("memutar ke kunci aktif", () => {
  it("semua nilai pindah ke k2 dan isinya tetap sama", async () => {
    const r = await rotate();
    expect(r).toMatchObject({ before: { k1: TOTAL }, after: { k2: TOTAL }, rotated: TOTAL, skippedChanged: 0, failed: [] });
    const s = await snapshot();
    expect(tokens(s).map(keyIdOf)).toEqual(Array(12).fill("k2"));
    expect(tokens(s).map((t) => newCrypto.decrypt(t))).toEqual([
      PLAIN.emailA, PLAIN.nameA, PLAIN.phoneA, PLAIN.totpA, PLAIN.emailB, PLAIN.code, PLAIN.recipient, PLAIN.phone, PLAIN.address, PLAIN.shipRecipient, PLAIN.shipPhone, PLAIN.shipAddress,
    ]);
  });
  it("tujuan akhirnya: crypto yang HANYA punya k2 bisa membuka semuanya (k1 boleh dilepas)", async () => {
    await rotate();
    const onlyNew = createCrypto({ keys: { k2: newKey }, activeKeyId: "k2", blindIndexKey: blind });
    const s = await snapshot();
    expect(tokens(s).map((t) => onlyNew.decrypt(t))).toContain(PLAIN.emailA);
    expect(onlyNew.decryptBuffer(s.file).equals(PROOF)).toBe(true);
  });
  it("kolom NULL tetap NULL dan kolom lain (blind index, status, id) tidak berubah", async () => {
    await rotate();
    const s = await snapshot();
    expect(s.b).toMatchObject({ nameEnc: null, phoneEnc: null, totpSecretEnc: null, emailIndex: oldCrypto.blindIndex(PLAIN.emailB) });
    expect(s.c.codeIndex).toBe(oldCrypto.blindIndex(PLAIN.code));
    expect(s.a.emailIndex).toBe(oldCrypto.blindIndex(PLAIN.emailA));
    const [o2] = await ctx.db.select().from(orders).where(eq(orders.invoiceNumber, "INV-202610-0002"));
    expect(o2.shipAddressEnc).toBeNull();
  });
  it("file bukti bayar: jalur sama, isi dienkripsi k2, mode file dan folder tetap, tidak ada sisa sementara", async () => {
    chmodSync(proofPath(), 0o640); // bukan 0600 bawaan file sementara, supaya terbukti mode asli dipertahankan
    const mode = statSync(proofPath()).mode;
    await rotate();
    const file = readFileSync(proofPath());
    expect(keyIdOfFile(file)).toBe("k2");
    expect(newCrypto.decryptBuffer(file).equals(PROOF)).toBe(true);
    expect(statSync(proofPath()).mode).toBe(mode);
    expect(readdirSync(join(ctx.config.storage.dir, "proofs")).filter((f) => f.startsWith("."))).toEqual([]);
    const [row] = await ctx.db.select().from(paymentProofs).where(eq(paymentProofs.id, ids.proofId));
    expect(row).toMatchObject({ storageKey: ids.proofKey, sizeBytes: PROOF.length });
  });
  it("bukti yang filenya sudah dihapus (file_deleted_at) dilewati tanpa galat", async () => {
    expect((await rotate()).failed).toEqual([]);
  });
  it("idempoten: putaran kedua tidak memutar apa pun dan tidak menulis ulang", async () => {
    await rotate();
    const first = await snapshot();
    const mtime = statSync(proofPath()).mtimeMs;
    const r = await rotate();
    expect(r).toMatchObject({ before: { k2: TOTAL }, rotated: 0, failed: [] });
    const second = await snapshot();
    expect(tokens(second)).toEqual(tokens(first));
    expect(statSync(proofPath()).mtimeMs).toBe(mtime);
  });
  it("nilai yang sudah memakai kunci aktif tidak disentuh, yang lama tetap diputar", async () => {
    const already = newCrypto.encrypt(PLAIN.nameA);
    await ctx.db.update(users).set({ nameEnc: already }).where(eq(users.id, ids.userA));
    const r = await rotate();
    expect(r.before).toEqual({ k1: TOTAL - 1, k2: 1 });
    expect(r.rotated).toBe(TOTAL - 1);
    expect((await snapshot()).a.nameEnc).toBe(already);
  });
  it("tabel besar diproses per kelompok: semua baris terputar walau lebih banyak dari ukuran kelompok", async () => {
    await ctx.db.insert(users).values(Array.from({ length: 7 }, (_, i) => ({ role: "buyer" as const, emailEnc: oldCrypto.encrypt(`x${i}@contoh.id`), emailIndex: `idx-${i}` })));
    const r = await rotate({ batchSize: 3 });
    expect(r).toMatchObject({ rotated: TOTAL + 7, after: { k2: TOTAL + 7 }, failed: [] });
  });
  it("laporan tidak memuat data pribadi maupun token", async () => {
    const text = JSON.stringify(await rotate());
    for (const v of Object.values(PLAIN)) expect(text).not.toContain(v);
    expect(text).not.toMatch(/v1:k\d:/);
  });
});

describe("ketahanan", () => {
  it("baris yang diubah aplikasi saat skrip berjalan tidak ditimpa; putaran berikutnya mengambilnya", async () => {
    const fresh = oldCrypto.encrypt("Nama Baru");
    let fired = false;
    const r = await rotate({
      beforeWrite: async ({ column, id }: { column: string; id: string }) => {
        if (fired || column !== "users.name_enc" || id !== ids.userA) return;
        fired = true;
        await ctx.db.update(users).set({ nameEnc: fresh }).where(eq(users.id, ids.userA));
      },
    });
    expect(fired).toBe(true);
    expect(r).toMatchObject({ skippedChanged: 1, rotated: TOTAL - 1, failed: [] });
    expect((await snapshot()).a.nameEnc).toBe(fresh); // nilai versi aplikasi menang
    expect((await rotate()).rotated).toBe(1);
    expect(newCrypto.decrypt((await snapshot()).a.nameEnc!)).toBe("Nama Baru");
  });

  it("ID kunci tak dikenal: dilaporkan gagal (kolom dan id baris), nilai tidak diubah, sisanya tetap diputar", async () => {
    const stray = oldCrypto.encrypt("rahasia-asing").replace("v1:k1:", "v1:k9:");
    await ctx.db.update(users).set({ nameEnc: stray }).where(eq(users.id, ids.userA));
    const r = await rotate();
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ where: "users.name_enc", id: ids.userA });
    expect(JSON.stringify(r.failed)).not.toContain("rahasia-asing");
    expect(JSON.stringify(r.failed)).not.toContain(stray);
    expect(r).toMatchObject({ rotated: TOTAL - 1, after: { k2: TOTAL - 1, k9: 1 } });
    expect((await snapshot()).a.nameEnc).toBe(stray);
  });

  it("nilai rusak (isi diubah): gagal, tidak diubah, tidak menghentikan baris lain", async () => {
    const t = (await snapshot()).a.phoneEnc!.split(":");
    t[4] = Buffer.from("rusak-rusak-rusak").toString("base64url");
    await ctx.db.update(users).set({ phoneEnc: t.join(":") }).where(eq(users.id, ids.userA));
    const r = await rotate();
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ where: "users.phone_enc", id: ids.userA });
    expect(r.rotated).toBe(TOTAL - 1);
    expect((await snapshot()).a.phoneEnc).toBe(t.join(":"));
  });

  it("file bukti rusak: gagal dan isi aslinya utuh; file hilang untuk baris yang masih aktif: gagal", async () => {
    const bad = Buffer.from(readFileSync(proofPath()));
    bad[bad.length - 1] ^= 0xff;
    writeFileSync(proofPath(), bad);
    const r1 = await rotate();
    expect(r1.failed).toEqual([expect.objectContaining({ where: "payment_proofs.storage_key", id: ids.proofId })]);
    expect(readFileSync(proofPath()).equals(bad)).toBe(true);
    await ctx.db.update(paymentProofs).set({ storageKey: `proofs/${randomUUID()}.bin` }).where(eq(paymentProofs.id, ids.proofId));
    const r2 = await rotate();
    expect(r2.failed).toEqual([expect.objectContaining({ where: "payment_proofs.storage_key", id: ids.proofId, reason: expect.stringMatching(/hilang/) })]);
  });
});

describe("kunci file dari database tidak dipercaya mentah", () => {
  it("storage_key yang keluar dari folder bukti ditolak: file di luar tidak dibaca maupun ditulis", async () => {
    const outside = join(ctx.config.storage.dir, "rahasia.bin");
    const content = oldCrypto.encryptBuffer(Buffer.from("di luar folder bukti"));
    writeFileSync(outside, content);
    await ctx.db.update(paymentProofs).set({ storageKey: "proofs/../rahasia.bin" }).where(eq(paymentProofs.id, ids.proofId));
    const r = await rotate();
    expect(r.failed).toEqual([expect.objectContaining({ where: "payment_proofs.storage_key", id: ids.proofId })]);
    expect(readFileSync(outside).equals(content)).toBe(true);
  });
});

describe("daftar kolom tidak boleh tertinggal (penjaga kelengkapan)", () => {
  const cfgs = Object.values(schema).filter((v) => is(v, PgTable)).map((t) => getTableConfig(t as PgTable));
  it("setiap kolom *_enc di skema ada di ROTATED_COLUMNS, dan sebaliknya", () => {
    const inSchema = cfgs.flatMap((c) => c.columns.filter((col) => col.name.endsWith("_enc")).map((col) => `${c.name}.${col.name}`)).sort();
    expect(inSchema.length).toBeGreaterThanOrEqual(11); // 4 users + 1 kode lisensi + 3 alamat + 3 alamat kirim pesanan
    expect([...ROTATED_COLUMNS].sort()).toEqual(inSchema);
  });
  it("tabel yang menyimpan kunci file di disk dikenal: tabel baru memaksa keputusan 'file ini terenkripsi atau tidak'", () => {
    const withStorage = cfgs.filter((c) => c.columns.some((col) => /^(storage_key|cover_key)$/.test(col.name))).map((c) => c.name).sort();
    // payment_proofs: terenkripsi, diputar skrip. product_files dan products (sampul): file apa adanya, bukan rahasia.
    expect(withStorage).toEqual(["payment_proofs", "product_files", "products"]);
  });
});

describe("rotate-keys-cli (proses sungguhan)", () => {
  const CLI = join(__dirname, "rotate-keys-cli.ts");
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync("npx", ["tsx", CLI, ...args], {
      cwd: join(__dirname, "../.."), encoding: "utf8",
      env: {
        ...process.env, NODE_ENV: "test", APP_URL: "https://hayatun.my.id", APP_TIMEZONE: "Asia/Jakarta", LOG_LEVEL: "silent", LOG_DIR: "/tmp",
        WEB_PORT: "3000", API_PORT: "4000", API_INTERNAL_URL: "http://127.0.0.1:4000", SESSION_SECRET: b64(),
        DATA_ENCRYPTION_KEYS: `k1:${oldKey.toString("base64")},k2:${newKey.toString("base64")}`, DATA_ENCRYPTION_ACTIVE_KEY_ID: "k2", BLIND_INDEX_KEY: blind.toString("base64"),
        TOTP_ISSUER: "Hayatun", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", SMTP_USER: "", SMTP_PASSWORD: "", EMAIL_FROM: "toko@hayatun.my.id",
        STORAGE_DIR: ctx.config.storage.dir, ...env,
      },
    });
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  it("--status: menampilkan kunci aktif dan jumlah per kunci, tidak mengubah apa pun", () => {
    const r = run(["--status"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Kunci aktif: k2/);
    expect(r.out).toMatch(/Sebelum: k1=13/);
  }, 60_000);
  it("--dry-run lalu putaran sungguhan: sisa kunci lama 0 dan keluar 0", async () => {
    expect(run(["--dry-run"]).out).toMatch(/Sesudah: k1=13/);
    const r = run([]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Diputar: 13/);
    expect(r.out).toMatch(/Sesudah: k2=13/);
    expect(tokens(await snapshot()).every((t) => keyIdOf(t) === "k2")).toBe(true);
  }, 60_000);
  it("ada yang gagal: keluar 1 dan pesan tidak memuat data pribadi", async () => {
    await ctx.db.update(users).set({ nameEnc: oldCrypto.encrypt("rahasia-asing").replace("v1:k1:", "v1:k9:") }).where(eq(users.id, ids.userA));
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.out + r.err).toMatch(/users\.name_enc/);
    expect(r.out + r.err).not.toContain("rahasia-asing");
  }, 60_000);
  it("argumen tak dikenal: keluar 2 dan tidak menyentuh data", async () => {
    const r = run(["--paksa"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Pemakaian/);
    expect(tokens(await snapshot()).every((t) => keyIdOf(t) === "k1")).toBe(true);
  }, 60_000);
  it("konfigurasi salah (kunci aktif tidak ada di daftar): keluar 2", () => {
    const r = run(["--status"], { DATA_ENCRYPTION_ACTIVE_KEY_ID: "k7" });
    expect(r.code).toBe(2);
  }, 60_000);
});
