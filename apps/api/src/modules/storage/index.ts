import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { HttpError } from "../../errors.js";

export type FileType = "jpg" | "png" | "pdf" | "webp";
export type Category = "proofs" | "covers" | "products";
export type Storage = ReturnType<typeof createStorage>;

const LABEL: Record<FileType, string> = { jpg: "JPG", png: "PNG", pdf: "PDF", webp: "WebP" };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEAD_BYTES = 12; // cukup untuk semua tanda jenis di bawah
const KEY_RE = /^(proofs|covers|products)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf|webp|bin)$/;

// Jenis file dari isinya (magic bytes), bukan dari nama atau Content-Type kiriman pengguna
export function detectFileType(b: Buffer): FileType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} atau ${items.at(-1)}`);
const megabytes = (n: number) => `${Number((n / 1024 / 1024).toFixed(1))} MB`;
const typeError = (allowed: readonly FileType[]) =>
  new HttpError(422, `Jenis file tidak didukung. Pakai ${list(allowed.map((t) => LABEL[t]))} ya.`, "FILE_TYPE");
const sizeError = (max: number) => new HttpError(422, `Filenya kebesaran nih, maksimal ${megabytes(max)} ya. Coba kecilkan dulu.`, "FILE_TOO_LARGE");

// Content-Disposition aman: tanpa karakter kontrol (tidak bisa menyisipkan header), dengan nama Unicode lewat filename*
function disposition(filename: string) {
  // eslint-disable-next-line no-control-regex -- sengaja: membuang karakter kontrol dari nama file
  const clean = filename.replace(/[\x00-\x1f\x7f]/g, "");
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Membaca unggahan kecil ke memori dengan batas ukuran dan jenis dari isi file (pesan sama dengan save).
// Dipakai bila isi perlu diolah dulu sebelum disimpan, misalnya bukti bayar yang dienkripsi (N2).
export async function readUpload<T extends FileType>(data: Readable, opts: { allowed: readonly T[]; maxBytes: number }): Promise<{ buffer: Buffer; type: T }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of data) {
    size += (chunk as Buffer).length;
    if (size > opts.maxBytes) throw sizeError(opts.maxBytes);
    chunks.push(chunk as Buffer);
  }
  const buffer = Buffer.concat(chunks);
  const type = detectFileType(buffer);
  if (!type || !(opts.allowed as readonly FileType[]).includes(type)) throw typeError(opts.allowed);
  return { buffer, type: type as T };
}

// ARCHITECTURE K4: file produk dan bukti bayar di disk privat di luar root web (N5).
// `internalPrefix` diisi di produksi: Nginx yang mengirim file lewat X-Accel-Redirect setelah API memeriksa akses.
export function createStorage({ dir, internalPrefix }: { dir: string; internalPrefix?: string }) {
  const pathFor = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error("Key file tidak sah");
    return join(dir, key);
  };

  return {
    async save(category: Category, data: Buffer | Readable, opts: { allowed: readonly FileType[] | "any"; maxBytes: number }): Promise<string> {
      await mkdir(join(dir, category), { recursive: true, mode: 0o700 });
      const tmp = join(dir, category, `.tmp-${randomUUID()}`);
      let size = 0;
      let head = Buffer.alloc(0);
      let checked = false;
      const check = () => {
        checked = true;
        const type = detectFileType(head);
        if (opts.allowed !== "any" && (!type || !opts.allowed.includes(type))) throw typeError(opts.allowed);
      };
      // menghitung ukuran dan memeriksa jenis sambil menulis, tanpa memuat file ke memori
      const guard = new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          if (size > opts.maxBytes) return done(sizeError(opts.maxBytes));
          if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
          try {
            if (!checked && head.length >= HEAD_BYTES) check(); // jenis yang salah dihentikan sejak awal
            done(null, chunk);
          } catch (err) {
            done(err as Error);
          }
        },
        flush(done) {
          try {
            if (!checked) check(); // file yang lebih pendek dari HEAD_BYTES
            done();
          } catch (err) {
            done(err as Error);
          }
        },
      });

      try {
        const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
        await pipeline(source, guard, createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
        const key = `${category}/${randomUUID()}.${detectFileType(head) ?? "bin"}`;
        await rename(tmp, join(dir, key)); // tidak pernah ada file setengah jadi di nama akhirnya
        return key;
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },

    read: async (key: string) => readFile(pathFor(key)),

    size: async (key: string) => (await stat(pathFor(key))).size,

    // aman dipanggil berulang, misalnya oleh tugas hapus bukti bayar setelah 1 tahun
    remove: async (key: string) => rm(pathFor(key), { force: true }),

    async checkWritable(): Promise<void> {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const probe = join(dir, `.health-${randomUUID()}`);
      await writeFile(probe, "ok", { mode: 0o600 });
      await rm(probe, { force: true });
    },

    async send(res: Response, key: string, file: { filename: string; contentType: string; inline?: boolean; cacheControl?: string }): Promise<void> {
      const path = pathFor(key);
      // tanpa Nginx (lokal dan tes e2e) API mengalirkan filenya sendiri; periksa dulu sebelum header terpasang
      const info = internalPrefix ? null : await stat(path).catch(() => null);
      if (!internalPrefix && !info?.isFile()) throw new HttpError(404, "File tidak ditemukan.", "FILE_NOT_FOUND");
      res.setHeader("Content-Type", file.contentType);
      // inline hanya untuk gambar sampul yang memang tampil di halaman; selebihnya selalu diunduh
      res.setHeader("Content-Disposition", file.inline ? disposition(file.filename).replace(/^attachment/, "inline") : disposition(file.filename));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", file.cacheControl ?? "private, no-store");
      if (internalPrefix) {
        res.setHeader("X-Accel-Redirect", `${internalPrefix}/${key}`);
        return void res.end();
      }
      res.setHeader("Content-Length", info!.size);
      await pipeline(createReadStream(path), res);
    },
  };
}
