import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../errors.js";
import { createStorage, detectFileType, type Storage } from "./index.js";

const MB = 1024 * 1024;
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nbukti transfer");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), randomBytes(32)]);
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");
const PROOF = { allowed: ["jpg", "png", "pdf"] as const, maxBytes: 5 * MB };
const KEY_RE = /^proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

let dir: string;
let storage: Storage;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hayatun-storage-"));
  storage = createStorage({ dir });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

// semua berkas (bukan folder) di bawah dir, untuk memastikan tidak ada sisa file sementara
async function filesIn(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(join(e.parentPath, e.name));
  return out;
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("detectFileType (dari isi, bukan nama)", () => {
  it.each([
    ["jpg", JPG],
    ["png", PNG],
    ["pdf", PDF],
    ["webp", WEBP],
  ])("mengenali %s", (type, buf) => expect(detectFileType(buf)).toBe(type));

  it.each([
    ["HTML", HTML],
    ["kosong", Buffer.alloc(0)],
    ["%PDF tidak di awal", Buffer.concat([Buffer.from(" "), PDF])],
    ["RIFF yang bukan WebP", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])],
    ["terlalu pendek", Buffer.from([0xff, 0xd8])],
  ])("menolak %s", (_label, buf) => expect(detectFileType(buf)).toBeNull());
});

describe("save / read", () => {
  it("menyimpan dengan key acak, isi utuh, hak akses hanya pemilik", async () => {
    const key = await storage.save("proofs", PDF, PROOF);
    expect(key).toMatch(KEY_RE);
    expect(await storage.read(key)).toEqual(PDF);
    expect((await stat(join(dir, key))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "proofs"))).mode & 0o777).toBe(0o700);
    expect(await storage.save("proofs", PDF, PROOF)).not.toBe(key);
  });

  it("ekstensi key mengikuti jenis yang terdeteksi; jenis bebas memakai .bin", async () => {
    expect(await storage.save("covers", WEBP, { allowed: ["jpg", "png", "webp"], maxBytes: 5 * MB })).toMatch(/^covers\/[0-9a-f-]{36}\.webp$/);
    expect(await storage.save("products", randomBytes(100), { allowed: "any", maxBytes: 5 * MB })).toMatch(/^products\/[0-9a-f-]{36}\.bin$/);
    expect(await storage.save("products", PDF, { allowed: "any", maxBytes: 5 * MB })).toMatch(/\.pdf$/);
  });

  it("menolak jenis yang tidak diizinkan, dengan pesan sesuai daftar", async () => {
    await expect(storage.save("proofs", HTML, PROOF)).rejects.toMatchObject({
      status: 422, code: "FILE_TYPE", message: "Jenis file tidak didukung. Pakai JPG, PNG, atau PDF ya.",
    });
    await expect(storage.save("proofs", WEBP, PROOF)).rejects.toMatchObject({ code: "FILE_TYPE" });
    await expect(storage.save("covers", PDF, { allowed: ["jpg", "png", "webp"], maxBytes: MB })).rejects.toMatchObject({
      message: "Jenis file tidak didukung. Pakai JPG, PNG, atau WebP ya.",
    });
    await expect(storage.save("proofs", Buffer.alloc(0), PROOF)).rejects.toMatchObject({ code: "FILE_TYPE" });
    expect(await filesIn(dir)).toEqual([]);
  });

  it("menolak yang melewati batas ukuran; tepat di batas masih diterima", async () => {
    const atLimit = Buffer.concat([PDF, Buffer.alloc(5 * MB - PDF.length)]);
    await storage.save("proofs", atLimit, PROOF);
    await expect(storage.save("proofs", Buffer.concat([atLimit, Buffer.from("x")]), PROOF)).rejects.toMatchObject({
      status: 422, code: "FILE_TOO_LARGE", message: "Filenya kebesaran nih, maksimal 5 MB ya. Coba kecilkan dulu.",
    });
    expect(await filesIn(dir)).toHaveLength(1);
  });

  it("stream besar disimpan utuh tanpa dimuat sekaligus", async () => {
    const chunks = Array.from({ length: 20 }, () => randomBytes(MB));
    const key = await storage.save("products", Readable.from(chunks), { allowed: "any", maxBytes: 50 * MB });
    const back = await storage.read(key);
    expect(back.length).toBe(20 * MB);
    expect(sha(back)).toBe(sha(Buffer.concat(chunks)));
  });

  it("stream yang melewati batas dihentikan dan tidak meninggalkan file sementara", async () => {
    const chunks = [PDF, ...Array.from({ length: 6 }, () => randomBytes(MB))];
    await expect(storage.save("proofs", Readable.from(chunks), PROOF)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(await filesIn(dir)).toEqual([]);
  });

  it("stream yang putus di tengah tidak meninggalkan file sementara", async () => {
    async function* broken() {
      yield PDF;
      yield randomBytes(MB);
      throw new Error("koneksi terputus");
    }
    await expect(storage.save("proofs", Readable.from(broken()), PROOF)).rejects.toThrow("koneksi terputus");
    expect(await filesIn(dir)).toEqual([]);
  });
});

describe("key yang tidak sah ditolak (path traversal)", () => {
  const bad = ["../../etc/passwd", "proofs/../x", "/etc/passwd", "proofs/abc.pdf", `proofs/${randomUUID()}.pdf/../..`, `rahasia/${randomUUID()}.pdf`, ""];
  it.each(bad)("read(%j)", async (key) => { await expect(storage.read(key)).rejects.toThrow(/key/i); });
  it.each(bad)("remove(%j)", async (key) => { await expect(storage.remove(key)).rejects.toThrow(/key/i); });
});

describe("remove", () => {
  it("menghapus file; file yang sudah tidak ada tidak menimbulkan error", async () => {
    const key = await storage.save("proofs", PDF, PROOF);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toThrow();
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });
});

describe("checkWritable (dipakai health check)", () => {
  it("berhasil pada folder normal", async () => {
    await expect(storage.checkWritable()).resolves.toBeUndefined();
    expect(await filesIn(dir)).toEqual([]); // berkas uji dihapus lagi
  });

  it("gagal bila folder tidak bisa ditulis", async () => {
    const notADir = join(dir, "bukan-folder");
    await writeFile(notADir, "x"); // berlaku juga saat berjalan sebagai root
    await expect(createStorage({ dir: notADir }).checkWritable()).rejects.toThrow();
  });
});

describe("send (N5)", () => {
  const appFor = (s: Storage, key: string, filename: string) =>
    express()
      .get("/unduh", async (_req, res) => { await s.send(res, key, { filename, contentType: "application/pdf" }); })
      .use(errorHandler);
  const SECURITY = { "x-content-type-options": "nosniff", "cache-control": "private, no-store" };

  it("produksi: hanya header X-Accel-Redirect, Nginx yang mengirim file", async () => {
    const s = createStorage({ dir, internalPrefix: "/_files" });
    const key = await s.save("proofs", PDF, PROOF);
    const res = await request(appFor(s, key, "bukti.pdf")).get("/unduh").expect(200);
    expect(res.headers["x-accel-redirect"]).toBe(`/_files/${key}`);
    expect(res.headers).toMatchObject(SECURITY);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="bukti\.pdf"/);
    expect(res.text ?? "").toBe(""); // isi dikirim Nginx, bukan API
  });

  it("lokal tanpa Nginx: API mengalirkan filenya sendiri dengan header yang sama", async () => {
    const key = await storage.save("proofs", PDF, PROOF);
    const res = await request(appFor(storage, key, "E-book Ramadan — 2026.pdf")).get("/unduh").buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c)).on("end", () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    expect(res.body).toEqual(PDF);
    expect(res.headers["x-accel-redirect"]).toBeUndefined();
    expect(res.headers).toMatchObject({ ...SECURITY, "content-type": "application/pdf" });
    expect(res.headers["content-disposition"]).toContain("filename*=UTF-8''E-book%20Ramadan%20%E2%80%94%202026.pdf");
  });

  it("nama file berbahaya tidak bisa menyisipkan header", async () => {
    const s = createStorage({ dir, internalPrefix: "/_files" });
    const key = await s.save("proofs", PDF, PROOF);
    const res = await request(appFor(s, key, 'bukti "jahat"\r\nSet-Cookie: x=1.pdf')).get("/unduh").expect(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  });

  it("file yang tidak ada: 404 dengan pesan jelas", async () => {
    const res = await request(appFor(storage, `proofs/${randomUUID()}.pdf`, "x.pdf")).get("/unduh").expect(404);
    expect(res.body).toMatchObject({ code: "FILE_NOT_FOUND", message: "File tidak ditemukan." });
  });

  it("key tidak sah ditolak sebelum menyentuh disk", async () => {
    await request(appFor(storage, "../../etc/passwd", "x")).get("/unduh").expect(500);
  });
});
