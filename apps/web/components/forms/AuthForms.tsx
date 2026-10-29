"use client";

import { acceptInviteSchema, emailSchema, loginSchema, passwordSchema, registerSchema } from "@hayatun/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";
import { setChallenge } from "@/lib/challenge";
import { useApiForm } from "@/lib/use-api-form";

const useValues = <T extends Record<string, string>>(initial: T) => {
  const [v, setV] = useState(initial);
  return [v, (k: keyof T) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))] as const;
};

// Setelah masuk: muat ulang penuh supaya bar atas dan halaman server memakai sesi baru
export const goAfterLogin = (user: { role: string }) => window.location.assign(user.role === "admin" ? "/admin" : "/");

export function RegisterForm() {
  const f = useApiForm("/api/auth/register", registerSchema);
  const [v, on] = useValues({ name: "", email: "", password: "" });
  const [done, setDone] = useState<string>();
  if (done) return <FormMessage tone="ok">{done}</FormMessage>;
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit(v, (d) => setDone(d.message)); }}>
      <TextField label="Nama" name="name" autoComplete="name" value={v.name} onChange={on("name")} error={f.fields.name} />
      <TextField label="Email" name="email" type="email" autoComplete="email" value={v.email} onChange={on("email")} error={f.fields.email} />
      <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="Minimal 8 karakter." value={v.password} onChange={on("password")} error={f.fields.password} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <p className="meta">Dengan mendaftar, kamu menyetujui <Link href="/syarat-dan-ketentuan">Syarat dan ketentuan</Link> serta <Link href="/kebijakan-privasi">Kebijakan privasi</Link>.</p>
      <Button loading={f.loading} loadingLabel="Mendaftarkan…">Daftar</Button>
      <p className="form-links"><span>Sudah punya akun? <Link href="/masuk">Masuk</Link></span></p>
    </form>
  );
}

export function LoginForm() {
  const router = useRouter();
  const f = useApiForm("/api/auth/login", loginSchema);
  const [v, on] = useValues({ email: "", password: "" });
  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(v, (d) => {
          if (d.next === "done") return goAfterLogin(d.user);
          setChallenge(d.challenge);
          router.push(d.next === "totp" ? "/masuk/kode" : "/masuk/atur-kode");
        });
      }}
    >
      <TextField label="Email" name="email" type="email" autoComplete="email" value={v.email} onChange={on("email")} error={f.fields.email} />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" value={v.password} onChange={on("password")} error={f.fields.password} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Memeriksa…">Masuk</Button>
      <p className="form-links"><Link href="/lupa-password">Lupa password?</Link> <span>Belum punya akun? <Link href="/daftar">Daftar</Link></span></p>
    </form>
  );
}

const forgotSchema = z.object({ email: emailSchema });
export function ForgotForm() {
  const f = useApiForm("/api/auth/forgot-password", forgotSchema);
  const [v, on] = useValues({ email: "" });
  const [done, setDone] = useState<string>();
  if (done) return <FormMessage tone="ok">{done}</FormMessage>;
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit(v, (d) => setDone(d.message)); }}>
      <TextField label="Email" name="email" type="email" autoComplete="email" value={v.email} onChange={on("email")} error={f.fields.email} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Mengirim…">Kirim tautan</Button>
      <p className="form-links"><Link href="/masuk">Kembali ke halaman masuk</Link></p>
    </form>
  );
}

const resetSchema = z.object({ password: passwordSchema });
export function ResetForm({ token }: { token: string }) {
  const f = useApiForm("/api/auth/reset-password", resetSchema);
  const [v, on] = useValues({ password: "" });
  const [done, setDone] = useState<string>();
  if (done) return (<><FormMessage tone="ok">{done}</FormMessage><p className="form-links"><Link href="/masuk">Masuk</Link></p></>);
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit(v, (d) => setDone(d.message), { token }); }}>
      <TextField label="Password baru" name="password" type="password" autoComplete="new-password" hint="Minimal 8 karakter." value={v.password} onChange={on("password")} error={f.fields.password} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Menyimpan…">Ganti password</Button>
      <p className="form-links"><Link href="/lupa-password">Minta tautan baru</Link></p>
    </form>
  );
}

// Verifikasi email dilakukan lewat POST dari browser, bukan GET, supaya pemindai tautan di kotak masuk tidak memakai habis tautannya
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    apiClient<{ message: string }>("/api/auth/verify-email", { token }).then((r) =>
      setState(r.ok ? { tone: "ok", text: r.data.message } : { tone: "error", text: r.body.message }),
    );
  }, [token]);
  if (!state) return <p role="status">Memverifikasi emailmu…</p>;
  return (
    <>
      <FormMessage tone={state.tone}>{state.text}</FormMessage>
      <p className="form-links"><Link href={state.tone === "ok" ? "/masuk" : "/daftar"}>{state.tone === "ok" ? "Masuk" : "Kembali"}</Link></p>
    </>
  );
}

export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const f = useApiForm("/api/auth/accept-invite", acceptInviteSchema.omit({ token: true }));
  const [v, on] = useValues({ name: "", password: "" });
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit(v, (d) => { setChallenge(d.challenge); router.push("/masuk/atur-kode"); }, { token }); }}>
      <TextField label="Nama" name="name" autoComplete="name" value={v.name} onChange={on("name")} error={f.fields.name} />
      <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="Minimal 8 karakter." value={v.password} onChange={on("password")} error={f.fields.password} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Menyimpan…">Simpan dan lanjut</Button>
    </form>
  );
}
