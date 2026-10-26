import { generateSecret, generateURI, verifySync } from "otplib";

export const generateTotpSecret = () => generateSecret();

export const totpUri = (secret: string, label: string, issuer: string) => generateURI({ secret, label, issuer });

// Periode 30 detik, toleransi satu langkah ke belakang/depan. Mengembalikan langkah waktu yang cocok,
// supaya pemanggil bisa menolak kode yang sudah pernah dipakai.
export function verifyTotp(secret: string, code: string, now: Date): number | null {
  const r = verifySync({ secret, token: code, epoch: Math.floor(now.getTime() / 1000), epochTolerance: 30 });
  return r.valid && "timeStep" in r ? r.timeStep : null;
}
