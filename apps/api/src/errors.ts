import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>, // pesan per kolom formulir
    public extra?: Record<string, unknown>, // data tambahan untuk pembeli, misalnya daftar item yang habis
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ...err.extra, message: err.message, code: err.code, fields: err.fields });
  } else if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".")] ??= i.message;
    res.status(422).json({ message: err.issues[0].message, fields });
  } else if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    // error dari body parser, misalnya JSON rusak atau terlalu besar
    res.status(err.status).json({ message: "Permintaannya tidak bisa dibaca. Coba lagi ya." });
  } else {
    req.log?.error({ err }, "error tak terduga");
    res.status(500).json({ message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." });
  }
};
