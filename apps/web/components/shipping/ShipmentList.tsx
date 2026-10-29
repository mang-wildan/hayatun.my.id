"use client";

import { formatWIB } from "@hayatun/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";
import type { Shipment } from "@/lib/shipping";

type Result = { tone: "ok" | "error"; text: string };

function Card({ s, onDone }: { s: Shipment; onDone: (r: Result) => void }) {
  const [resi, setResi] = useState(s.trackingNumber ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const shipped = s.physicalStatus === "DIKIRIM";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(undefined);
    onDone({ tone: "ok", text: "" });
    setBusy(true);
    const res = await apiClient(`/api/admin/shipments/${s.orderId}/tracking`, { trackingNumber: resi });
    setBusy(false);
    if (res.ok) onDone({ tone: "ok", text: "Resi tersimpan" });
    else if (res.body.fields?.trackingNumber) setError(res.body.fields.trackingNumber);
    else onDone({ tone: "error", text: res.body.message });
  }

  return (
    <li data-testid="pengiriman-item" className="shipment">
      <span className="mono" data-testid="nomor-invoice">{s.invoiceNumber}</span>
      <span className="meta">Dibayar {formatWIB(new Date(s.paidAt))}</span>
      <p><strong>{s.recipient}</strong><br />{s.address}<br />{s.phone}</p>
      <p className="meta">{[s.courier, s.service].filter(Boolean).join(" ")}</p>
      <ul className="plain-list">{s.items.map((i, n) => <li key={n}>{i.name} × {i.qty}</li>)}</ul>
      <form onSubmit={submit} noValidate>
        <TextField label="Nomor resi" value={resi} onChange={(e) => setResi(e.target.value)} error={error} autoComplete="off" />
        <Button type="submit" variant={shipped ? "secondary" : "primary"} loading={busy} loadingLabel="Menyimpan…">{shipped ? "Ubah resi" : "Simpan resi"}</Button>
      </form>
    </li>
  );
}

// F8.1, F8.2, F8.5: pesanan yang perlu dikirim dan yang sudah dikirim (resinya bisa diperbaiki)
export function ShipmentList({ items }: { items: Shipment[] }) {
  const router = useRouter();
  const [, refresh] = useTransition();
  const [result, setResult] = useState<Result>();
  const done = (r: Result) => {
    setResult(r.text ? r : undefined);
    if (r.text && r.tone === "ok") refresh(() => router.refresh());
  };
  const toShip = items.filter((i) => i.physicalStatus === "DIPROSES");
  const sent = items.filter((i) => i.physicalStatus === "DIKIRIM");
  return (
    <>
      {result && <FormMessage tone={result.tone}>{result.text}</FormMessage>}
      <section className="stack" aria-labelledby="kirim-h">
        <h2 id="kirim-h">Perlu dikirim</h2>
        {toShip.length === 0 ? <p className="empty">Belum ada pesanan yang perlu dikirim.</p> : <ul className="shipment-cards">{toShip.map((s) => <Card key={s.orderId} s={s} onDone={done} />)}</ul>}
      </section>
      {sent.length > 0 && (
        <section className="stack" aria-labelledby="terkirim-h">
          <h2 id="terkirim-h">Sudah dikirim</h2>
          <ul className="shipment-cards">{sent.map((s) => <Card key={s.orderId} s={s} onDone={done} />)}</ul>
        </section>
      )}
    </>
  );
}
