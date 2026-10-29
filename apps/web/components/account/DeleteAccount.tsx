"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";

type State = { requestedAt: string | null; blockers: { orderId: string; invoiceNumber: string; reason: string }[] };

// F1.5, F12.2, F12.5. Password diminta lagi, dan permintaan bisa dibatalkan sampai tugas pemroses jalan.
export function DeleteAccount({ initial }: { initial: State }) {
  const router = useRouter();
  const [, refresh] = useTransition();
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();

  async function send() {
    setAsking(false);
    setError(undefined);
    setFailure(undefined);
    const res = await apiClient("/api/account/deletion", { password });
    if (res.ok) { setPassword(""); refresh(() => router.refresh()); }
    else if (res.body.fields?.password) setError(res.body.fields.password);
    else setFailure(res.body.message);
  }
  async function cancel() {
    const res = await apiClient("/api/account/deletion", undefined, "DELETE");
    if (res.ok) refresh(() => router.refresh());
    else setFailure(res.body.message);
  }

  if (initial.requestedAt) {
    return (
      <section className="stack" aria-labelledby="minta-h">
        <h2 id="minta-h">Permintaan hapus akun</h2>
        <FormMessage tone="ok">Permintaan hapus akun sudah kami terima.</FormMessage>
        {initial.blockers.length > 0 ? (
          <>
            <p>Penghapusan menunggu pesanan berikut selesai atau dibatalkan:</p>
            <ul className="plain-list" aria-label="Pesanan yang menunda">
              {initial.blockers.map((b) => <li key={b.orderId}><Link href={`/pesanan/${b.orderId}`}>{b.invoiceNumber}</Link> <span className="meta">{b.reason}</span></li>)}
            </ul>
          </>
        ) : <p>Akunmu akan dihapus dalam beberapa saat, dan kami kabari lewat email.</p>}
        {failure && <FormMessage tone="error">{failure}</FormMessage>}
        <Button type="button" variant="secondary" onClick={cancel}>Batalkan permintaan</Button>
      </section>
    );
  }

  return (
    <form className="form" aria-label="Hapus akun" onSubmit={(e) => { e.preventDefault(); setAsking(true); }} noValidate>
      {failure && <FormMessage tone="error">{failure}</FormMessage>}
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} hint="Masukkan passwordmu untuk memastikan ini memang kamu." />
      <Button type="submit" variant="danger">Hapus akun</Button>
      <ConfirmDialog open={asking} title="Hapus akunmu?" confirmLabel="Ya, hapus akun" onCancel={() => setAsking(false)} onConfirm={send}>
        Akunmu akan dihapus dan tidak bisa dipulihkan. Pesanan yang masih berjalan membuat penghapusan menunggu sampai selesai atau dibatalkan.
      </ConfirmDialog>
    </form>
  );
}
