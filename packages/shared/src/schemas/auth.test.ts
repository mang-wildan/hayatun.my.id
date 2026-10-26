import { describe, expect, it } from "vitest";
import type { ZodSafeParseResult } from "zod";
import {
  acceptInviteSchema, emailSchema, loginSchema, nameSchema,
  passwordSchema, registerSchema, resetPasswordSchema, totpCodeSchema,
} from "./auth.js";

const msg = (r: ZodSafeParseResult<unknown>) => (r.success ? null : r.error.issues[0].message);
const field = (r: ZodSafeParseResult<unknown>, name: string) =>
  r.success ? null : r.error.issues.find((i) => i.path[0] === name)?.message;

describe("emailSchema", () => {
  it("menolak format salah dengan pesan santai", () => {
    expect(msg(emailSchema.safeParse("budi@"))).toBe("Format emailnya belum benar, coba cek lagi ya.");
  });
  it("merapikan spasi dan huruf besar", () => {
    expect(emailSchema.parse("  Budi@Mail.COM ")).toBe("budi@mail.com");
  });
  it("menolak lebih dari 254 karakter (cek panjang sebelum format)", () => {
    expect(msg(emailSchema.safeParse("a".repeat(250) + "@x.id"))).toBe("Emailnya terlalu panjang, maksimal 254 karakter.");
  });
});

describe("passwordSchema", () => {
  it("minimal 8 dan maksimal 128 karakter", () => {
    expect(msg(passwordSchema.safeParse("1234567"))).toBe("Password minimal 8 karakter ya.");
    expect(msg(passwordSchema.safeParse("a".repeat(129)))).toBe("Password maksimal 128 karakter.");
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
  });
  it("tidak mengubah isi password (spasi dipertahankan)", () => {
    expect(passwordSchema.parse(" rahasia 123 ")).toBe(" rahasia 123 ");
  });
});

describe("nameSchema", () => {
  it("wajib diisi dan maksimal 100 karakter", () => {
    expect(msg(nameSchema.safeParse("   "))).toBe("Namanya diisi dulu ya.");
    expect(msg(nameSchema.safeParse("x".repeat(101)))).toBe("Nama maksimal 100 karakter.");
    expect(nameSchema.parse("  Budi ")).toBe("Budi");
  });
});

describe("totpCodeSchema", () => {
  it("tepat 6 angka, spasi dibuang", () => {
    expect(msg(totpCodeSchema.safeParse("12345"))).toBe("Kodenya 6 angka, coba cek lagi di aplikasi authenticator-mu.");
    expect(msg(totpCodeSchema.safeParse("12345a"))).toBe("Kodenya 6 angka, coba cek lagi di aplikasi authenticator-mu.");
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });
});

describe("skema gabungan", () => {
  it("registerSchema melaporkan error di kolom yang tepat", () => {
    const r = registerSchema.safeParse({ name: "", email: "x", password: "1" });
    expect(field(r, "name")).toBe("Namanya diisi dulu ya.");
    expect(field(r, "email")).toBe("Format emailnya belum benar, coba cek lagi ya.");
    expect(field(r, "password")).toBe("Password minimal 8 karakter ya.");
  });
  it("registerSchema menolak password 10.000 karakter tanpa error lain", () => {
    expect(field(registerSchema.safeParse({ name: "Budi", email: "b@mail.com", password: "a".repeat(10_000) }), "password"))
      .toBe("Password maksimal 128 karakter.");
  });
  it("loginSchema, resetPasswordSchema, acceptInviteSchema memakai aturan yang sama", () => {
    expect(loginSchema.parse({ email: " B@Mail.com", password: "apa-saja-123" }).email).toBe("b@mail.com");
    expect(field(resetPasswordSchema.safeParse({ token: "t", password: "1" }), "password")).toBe("Password minimal 8 karakter ya.");
    expect(field(resetPasswordSchema.safeParse({ token: "", password: "rahasia-123" }), "token")).toBeTruthy();
    expect(acceptInviteSchema.parse({ token: "t", name: " Pemilik ", password: "admin-hayatun-2026" }).name).toBe("Pemilik");
  });
});
