import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = "v1";

export interface CryptoOptions {
  keys: Record<string, Buffer>;
  activeKeyId: string;
  blindIndexKey: Buffer;
}

export type Crypto = ReturnType<typeof createCrypto>;

// SPEC F12.1, N2: data pribadi dienkripsi per field; ID kunci ikut disimpan agar kunci bisa dirotasi
export function createCrypto({ keys, activeKeyId, blindIndexKey }: CryptoOptions) {
  for (const [id, key] of Object.entries(keys)) {
    if (key.length !== 32) throw new Error(`Kunci enkripsi "${id}" harus 32 byte`);
  }
  if (!keys[activeKeyId]) throw new Error(`Kunci aktif "${activeKeyId}" tidak ada`);
  if (blindIndexKey.length !== 32) throw new Error("Kunci blind index harus 32 byte");

  const keyFor = (id: string) => {
    const key = keys[id];
    if (!key) throw new Error(`Kunci enkripsi "${id}" tidak dikenal`);
    return key;
  };

  const seal = (plain: Buffer) => {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, keys[activeKeyId], iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ct };
  };

  const open = (keyId: string, iv: Buffer, tag: Buffer, ct: Buffer) => {
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new Error("Data terenkripsi rusak");
    const decipher = createDecipheriv(ALGO, keyFor(keyId), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  };

  return {
    // format: v1:<keyId>:<iv>:<tag>:<ciphertext>, masing-masing base64url
    encrypt(plain: string): string {
      const { iv, tag, ct } = seal(Buffer.from(plain, "utf8"));
      return [VERSION, activeKeyId, iv, tag, ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(":");
    },

    decrypt(token: string): string {
      const parts = token.split(":");
      if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("Format data terenkripsi tidak dikenal");
      const [, keyId, iv, tag, ct] = parts;
      return open(keyId, Buffer.from(iv, "base64url"), Buffer.from(tag, "base64url"), Buffer.from(ct, "base64url")).toString("utf8");
    },

    // format: "v1" | panjang keyId (1 byte) | keyId | iv | tag | ciphertext
    encryptBuffer(plain: Buffer): Buffer {
      const { iv, tag, ct } = seal(plain);
      const id = Buffer.from(activeKeyId, "utf8");
      return Buffer.concat([Buffer.from(VERSION), Buffer.from([id.length]), id, iv, tag, ct]);
    },

    decryptBuffer(data: Buffer): Buffer {
      if (data.length < 3 || data.subarray(0, 2).toString() !== VERSION) throw new Error("Format data terenkripsi tidak dikenal");
      const idEnd = 3 + data[2];
      const ivEnd = idEnd + IV_LEN;
      const tagEnd = ivEnd + TAG_LEN;
      if (data.length < tagEnd) throw new Error("Data terenkripsi rusak");
      return open(data.subarray(3, idEnd).toString("utf8"), data.subarray(idEnd, ivEnd), data.subarray(ivEnd, tagEnd), data.subarray(tagEnd));
    },

    // HMAC atas nilai ternormalisasi, untuk mencari email tanpa membuka enkripsi (ARCHITECTURE K5)
    blindIndex(value: string): string {
      return createHmac("sha256", blindIndexKey).update(value.normalize("NFKC").trim().toLowerCase()).digest("hex");
    },
  };
}
