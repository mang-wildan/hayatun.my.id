import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, code: err.code });
  } else if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".")] ??= i.message;
    res.status(422).json({ message: err.issues[0].message, fields });
  } else {
    req.log?.error({ err }, "error tak terduga");
    res.status(500).json({ message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." });
  }
};
