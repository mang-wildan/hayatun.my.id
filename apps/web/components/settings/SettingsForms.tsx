"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";

type Bank = { bank: string; number: string; holder: string };
export interface Settings { store: { name: string; email: string | null; phone: string | null }; bankAccount: Bank | null }
type Fields = Record<string, string>;

// F13.3, F15.7: informasi toko dan rekening tujuan. Rekening meminta konfirmasi karena semua admin dikabari dan pembeli langsung melihatnya.
export function SettingsForms({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [, refresh] = useTransition();
  const [store, setStore] = useState({ name: initial.store.name, email: initial.store.email ?? "", phone: initial.store.phone ?? "" });
  const [bank, setBank] = useState<Bank>(initial.bankAccount ?? { bank: "", number: "", holder: "" });
  const [storeErr, setStoreErr] = useState<Fields>({});
  const [bankErr, setBankErr] = useState<Fields>({});
  const [storeDone, setStoreDone] = useState(false);
  const [bankDone, setBankDone] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [asking, setAsking] = useState(false);

  async function saveStore(e: React.FormEvent) {
    e.preventDefault();
    setStoreErr({}); setStoreDone(false); setFailure(undefined);
    const res = await apiClient<{ name: string; email: string | null; phone: string | null }>("/api/admin/settings/store", store, "PUT");
    if (res.ok) { setStore({ name: res.data.name, email: res.data.email ?? "", phone: res.data.phone ?? "" }); setStoreDone(true); refresh(() => router.refresh()); }
    else if (res.body.fields) setStoreErr(res.body.fields);
    else setFailure(res.body.message);
  }
  async function saveBank() {
    setAsking(false); setBankErr({}); setBankDone(false); setFailure(undefined);
    const res = await apiClient<Bank>("/api/admin/settings/bank-account", bank, "PUT");
    if (res.ok) { setBank(res.data); setBankDone(true); refresh(() => router.refresh()); }
    else if (res.body.fields) setBankErr(res.body.fields);
    else setFailure(res.body.message);
  }

  return (
    <>
      {!initial.bankAccount && <p className="notice">Rekening belum diatur. Pembeli belum bisa melihat tujuan transfer.</p>}
      {failure && <FormMessage tone="error">{failure}</FormMessage>}

      <form className="form" aria-label="Informasi toko" noValidate onSubmit={saveStore}>
        <h2>Informasi toko</h2>
        {storeDone && <FormMessage tone="ok">Informasi toko tersimpan</FormMessage>}
        <TextField label="Nama toko" value={store.name} error={storeErr.name} onChange={(e) => setStore({ ...store, name: e.target.value })} />
        <TextField label="Email kontak" type="email" autoComplete="off" value={store.email} error={storeErr.email} onChange={(e) => setStore({ ...store, email: e.target.value })} />
        <TextField label="Telepon" type="tel" autoComplete="off" value={store.phone} error={storeErr.phone} onChange={(e) => setStore({ ...store, phone: e.target.value })} />
        <Button type="submit">Simpan informasi</Button>
      </form>

      <form className="form" aria-label="Rekening tujuan transfer" noValidate onSubmit={(e) => { e.preventDefault(); setAsking(true); }}>
        <h2>Rekening tujuan transfer</h2>
        {bankDone && <FormMessage tone="ok">Rekening tersimpan</FormMessage>}
        <TextField label="Bank" autoComplete="off" value={bank.bank} error={bankErr.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} />
        <TextField label="Nomor rekening" inputMode="numeric" autoComplete="off" value={bank.number} error={bankErr.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} />
        <TextField label="Atas nama" autoComplete="off" value={bank.holder} error={bankErr.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} />
        <Button type="submit">Simpan rekening</Button>
        <ConfirmDialog open={asking} title="Ubah rekening tujuan transfer?" variant="primary" confirmLabel="Ya, simpan rekening" onCancel={() => setAsking(false)} onConfirm={saveBank}>
          Email pemberitahuan dikirim ke semua admin, dan pembeli langsung melihat rekening ini di halaman bayar. Pastikan nomornya benar.
        </ConfirmDialog>
      </form>
    </>
  );
}
