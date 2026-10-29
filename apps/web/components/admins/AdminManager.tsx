"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";

export interface AdminRow { id: string; name: string | null; email: string; status: "active" | "invited" | "disabled" }
interface Buyer { id: string; name: string | null; totpEnabled: boolean }

const STATUS = { active: ["Aktif", "ok"], invited: ["Diundang", "wait"], disabled: ["Dinonaktifkan", "neutral"] } as const;

// F15.1, F15.5, F15.6: undang dan nonaktifkan admin. Pembeli yang kehilangan HP dibantu lewat pencarian email persis (tidak ada daftar pembeli).
export function AdminManager({ admins }: { admins: AdminRow[] }) {
  const router = useRouter();
  const [, refresh] = useTransition();
  const [email, setEmail] = useState("");
  const [inviteErr, setInviteErr] = useState<string>();
  const [invited, setInvited] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [target, setTarget] = useState<AdminRow>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searchErr, setSearchErr] = useState<string>();
  const [buyer, setBuyer] = useState<Buyer>();
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState<string>();

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(undefined); setInvited(undefined);
    const res = await apiClient("/api/admin/admins", { email });
    if (res.ok) { setInvited(email.trim()); setEmail(""); refresh(() => router.refresh()); }
    else setInviteErr(res.body.fields?.email ?? res.body.message);
  }
  async function disable() {
    if (!target || busy) return;
    setBusy(true); setFailure(undefined);
    const res = await apiClient(`/api/admin/admins/${target.id}/disable`);
    setTarget(undefined); setBusy(false);
    if (res.ok) refresh(() => router.refresh());
    else setFailure(res.body.message);
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearchErr(undefined); setBuyer(undefined); setResetDone(undefined);
    const res = await apiClient<Buyer>("/api/admin/users/lookup", { email: query });
    if (res.ok) setBuyer(res.data);
    else setSearchErr(res.body.fields?.email ?? res.body.message);
  }
  async function resetTotp() {
    if (!buyer || busy) return;
    setBusy(true); setFailure(undefined);
    const res = await apiClient(`/api/admin/users/${buyer.id}/totp/disable`);
    setResetting(false); setBusy(false);
    if (res.ok) { setBuyer({ ...buyer, totpEnabled: false }); setResetDone(`Verifikasi dua langkah ${buyer.name ?? "pembeli"} dimatikan`); }
    else setFailure(res.body.message);
  }

  return (
    <>
      {failure && <FormMessage tone="error">{failure}</FormMessage>}
      <ul className="queue-cards">
        {admins.map((a) => (
          <li key={a.id} data-testid="admin-item">
            <strong>{a.name ?? "Belum menerima undangan"}</strong>
            <span>{a.email}</span>
            <span className="badge" data-tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</span>
            {a.status !== "disabled" && <Button type="button" variant="danger" aria-label={`Nonaktifkan ${a.email}`} onClick={() => setTarget(a)}>Nonaktifkan</Button>}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(target)} title={`Nonaktifkan ${target?.email ?? ""}?`} confirmLabel="Ya, nonaktifkan" onCancel={() => setTarget(undefined)} onConfirm={disable}>
        Sesinya langsung berakhir dan ia tidak bisa masuk lagi. Admin lain dikabari lewat email.
      </ConfirmDialog>

      <form className="form" aria-label="Undang admin" noValidate onSubmit={invite}>
        <h2>Undang admin</h2>
        {invited && <FormMessage tone="ok">{`Undangan dikirim ke ${invited}`}</FormMessage>}
        <TextField label="Email admin baru" type="email" autoComplete="off" value={email} error={inviteErr} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit">Kirim undangan</Button>
      </form>

      <form className="form" aria-label="Cari pembeli" noValidate onSubmit={search}>
        <h2>Bantu pembeli yang kehilangan HP</h2>
        <TextField label="Email pembeli" type="email" autoComplete="off" value={query} error={searchErr} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit">Cari</Button>
      </form>
      {resetDone && <FormMessage tone="ok">{resetDone}</FormMessage>}
      {buyer && (
        <section aria-label="Hasil pencarian pembeli" className="form">
          <strong>{buyer.name ?? "Pembeli"}</strong>
          <p>Verifikasi dua langkah: {buyer.totpEnabled ? "Aktif" : "Belum aktif"}</p>
          {buyer.totpEnabled && <Button type="button" variant="danger" onClick={() => setResetting(true)}>Matikan verifikasi dua langkah</Button>}
          <ConfirmDialog open={resetting} title={`Matikan verifikasi dua langkah ${buyer.name ?? "pembeli"}?`} confirmLabel="Ya, matikan" onCancel={() => setResetting(false)} onConfirm={resetTotp}>
            Semua sesi masuknya berakhir dan ia dikabari lewat email. Lakukan ini hanya setelah kamu yakin yang meminta memang pemilik akun.
          </ConfirmDialog>
        </section>
      )}
    </>
  );
}
