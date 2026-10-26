import { readFileSync } from "node:fs";
import { hash, verify } from "@node-rs/argon2";

// N3: Argon2id (bawaan @node-rs/argon2) dengan parameter minimal rekomendasi OWASP
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // hash rusak atau kosong
  }
}

const COMMON = new Set(
  readFileSync(new URL("./common-passwords.txt", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.toLowerCase()),
);

export const isCommonPassword = (password: string) => COMMON.has(password.toLowerCase());
