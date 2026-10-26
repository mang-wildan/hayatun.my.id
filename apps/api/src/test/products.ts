import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { TestContext } from "./context.js";

export const MB = 1024 * 1024;
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
export const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)]);
export const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");

export const DIGITAL = { name: "E-book Ramadan Ceria", description: "Kumpulan resep untuk bulan puasa.", type: "digital", price: 75000 } as const;
export const PHYSICAL = { name: "Kue Kering Nastar", description: "Toples 500 gram.", type: "physical", price: 120000, weightG: 600, stockQty: 10 } as const;

// Semua tes produk lewat HTTP, supaya independen dari bentuk tabel di dalam
export const api = (ctx: TestContext, cookie: string) => ({
  post: (path: string, body?: object) => request(ctx.app).post(path).set("Cookie", cookie).send(body ?? {}),
  patch: (path: string, body: object) => request(ctx.app).patch(path).set("Cookie", cookie).send(body),
  get: (path: string) => request(ctx.app).get(path).set("Cookie", cookie),
  del: (path: string) => request(ctx.app).delete(path).set("Cookie", cookie),
  put: (path: string, data: Buffer, type: string) => request(ctx.app).put(path).set("Cookie", cookie).set("Content-Type", type).send(data),
  upload: (path: string, data: Buffer, type = "application/octet-stream") => request(ctx.app).post(path).set("Cookie", cookie).set("Content-Type", type).send(data),
});

export async function makeProduct(ctx: TestContext, cookie: string, over: Record<string, unknown> = {}) {
  const res = await api(ctx, cookie).post("/api/admin/products", { ...DIGITAL, ...over }).expect(201);
  return res.body as { id: string; slug: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Berkas yang tersimpan di disk privat per kategori, untuk memastikan tidak ada sisa
export async function filesOnDisk(ctx: TestContext, category: "proofs" | "covers" | "products") {
  return (await readdir(join(ctx.config.storage.dir, category)).catch(() => [])).filter((f) => !f.startsWith("."));
}
