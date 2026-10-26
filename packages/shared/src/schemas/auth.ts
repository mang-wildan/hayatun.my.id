import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Emailnya terlalu panjang, maksimal 254 karakter.")
  .pipe(z.email("Format emailnya belum benar, coba cek lagi ya."));

// tidak di-trim: spasi di tepi dianggap bagian dari password
export const passwordSchema = z
  .string()
  .min(8, "Password minimal 8 karakter ya.")
  .max(128, "Password maksimal 128 karakter.");

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Namanya diisi dulu ya.")
  .max(100, "Nama maksimal 100 karakter.");

export const totpCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Kodenya 6 angka, coba cek lagi di aplikasi authenticator-mu."));

const tokenSchema = z.string().min(1, "Tautannya tidak lengkap. Buka lagi dari email ya.");

export const registerSchema = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const acceptInviteSchema = z.object({ token: tokenSchema, name: nameSchema, password: passwordSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
