"use client";

import { totpCodeSchema } from "@hayatun/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";
import { clearChallenge, getChallenge } from "@/lib/challenge";
import { useApiForm } from "@/lib/use-api-form";
import { goAfterLogin } from "./AuthForms";

const codeSchema = z.object({ code: totpCodeSchema });
const CODE_LABEL = "Kode 6 angka";
const CODE_HINT = "Buka aplikasi authenticator-mu, lalu masukkan kode yang tampil.";

// Challenge hilang (tab baru, sesi ditutup): kembali ke awal, bukan halaman kosong
function useChallenge() {
  const [challenge, setValue] = useState<string | null>();
  useEffect(() => setValue(getChallenge()), []);
  return challenge;
}

function CodeField({ f, value, onChange }: { f: ReturnType<typeof useApiForm>; value: string; onChange: (v: string) => void }) {
  return (
    <TextField label={CODE_LABEL} name="code" inputMode="numeric" autoComplete="one-time-code" hint={CODE_HINT} value={value} onChange={(e) => onChange(e.target.value)} error={f.fields.code} />
  );
}

export function TotpLoginForm() {
  const challenge = useChallenge();
  const f = useApiForm("/api/auth/login/totp", codeSchema);
  const [code, setCode] = useState("");
  if (challenge === undefined) return null;
  if (challenge === null) return <FormMessage tone="error">Waktunya habis. Silakan masuk lagi dari awal ya.</FormMessage>;
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit({ code }, (d) => { clearChallenge(); goAfterLogin(d.user); }, { challenge }); }}>
      <CodeField f={f} value={code} onChange={setCode} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Memeriksa…">Masuk</Button>
      <p className="form-links"><Link href="/masuk">Mulai dari awal</Link></p>
    </form>
  );
}

interface Setup { otpauthUri: string; secret: string }

function SecretBlock({ setup }: { setup: Setup }) {
  return (
    <div className="stack">
      <p>Tambahkan akun di aplikasi authenticator dengan kunci ini, atau <a href={setup.otpauthUri}>buka langsung di HP</a>.</p>
      <p className="secret">
        <code className="mono" data-testid="totp-secret">{setup.secret}</code>
        <CopyButton text={setup.secret} />
      </p>
    </div>
  );
}

// Admin baru: TOTP wajib dipasang sebelum mendapat sesi (F15.2)
export function TotpEnrollAdmin() {
  const challenge = useChallenge();
  const f = useApiForm("/api/auth/totp/confirm", codeSchema);
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState<string>();
  const [code, setCode] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (!challenge || started.current) return;
    started.current = true; // setup membuat kunci baru setiap dipanggil
    apiClient<Setup>("/api/auth/totp/setup", { challenge }).then((r) => (r.ok ? setSetup(r.data) : setError(r.body.message)));
  }, [challenge]);
  if (challenge === undefined) return null;
  if (challenge === null || error) return <FormMessage tone="error">{error ?? "Waktunya habis. Silakan masuk lagi dari awal ya."}</FormMessage>;
  if (!setup) return <p role="status">Menyiapkan kuncimu…</p>;
  return (
    <>
      <SecretBlock setup={setup} />
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); f.submit({ code }, (d) => { clearChallenge(); goAfterLogin(d.user); }, { challenge }); }}>
        <CodeField f={f} value={code} onChange={setCode} />
        {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
        <Button loading={f.loading} loadingLabel="Memeriksa…">Aktifkan</Button>
      </form>
    </>
  );
}

// Pembeli: opsional, bisa diaktifkan dan dimatikan sendiri
export function SecurityPanel({ role, totpEnabled }: { role: "buyer" | "admin"; totpEnabled: boolean }) {
  const [enabled, setEnabled] = useState(totpEnabled);
  const [notice, setNotice] = useState<string>();
  const [setup, setSetup] = useState<Setup>();
  const [setupError, setSetupError] = useState<string>();
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [code, setCode] = useState("");
  const confirm = useApiForm("/api/auth/totp/confirm", codeSchema);
  const disable = useApiForm("/api/auth/totp/disable", codeSchema);

  if (enabled) {
    return (
      <div className="stack">
        {notice ? <FormMessage tone="ok">{notice}</FormMessage> : <p>Verifikasi dua langkah sedang aktif. Setiap masuk, kamu akan diminta kode dari aplikasi authenticator.</p>}
        {role === "admin" ? (
          <p className="empty">Admin wajib memakai verifikasi dua langkah, jadi tidak bisa dimatikan.</p>
        ) : (
          <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); disable.submit({ code }, (d) => { setEnabled(false); setCode(""); setNotice(d.message); }); }}>
            <TextField label={CODE_LABEL} name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={disable.fields.code} />
            {disable.message && <FormMessage tone="error">{disable.message}</FormMessage>}
            <Button variant="danger" loading={disable.loading} loadingLabel="Mematikan…">Matikan verifikasi dua langkah</Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {notice && <FormMessage tone="ok">{notice}</FormMessage>}
      {!setup ? (
        <>
          <p>Tambahkan satu lapis pengaman lagi: selain password, kamu diminta kode dari aplikasi authenticator di HP.</p>
          {setupError && <FormMessage tone="error">{setupError}</FormMessage>}
          <Button
            type="button"
            loading={loadingSetup}
            loadingLabel="Menyiapkan…"
            onClick={async () => {
              setLoadingSetup(true);
              const r = await apiClient<Setup>("/api/auth/totp/setup", {});
              if (r.ok) setSetup(r.data); else setSetupError(r.body.message);
              setLoadingSetup(false);
            }}
          >
            Aktifkan verifikasi dua langkah
          </Button>
        </>
      ) : (
        <>
          <SecretBlock setup={setup} />
          <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); confirm.submit({ code }, (d) => { setEnabled(true); setSetup(undefined); setCode(""); setNotice(d.message); }); }}>
            <CodeField f={confirm} value={code} onChange={setCode} />
            {confirm.message && <FormMessage tone="error">{confirm.message}</FormMessage>}
            <Button loading={confirm.loading} loadingLabel="Memeriksa…">Aktifkan</Button>
          </form>
        </>
      )}
    </div>
  );
}
