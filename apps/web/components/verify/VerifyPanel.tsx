"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiClient } from "@/lib/api-client";
import { formatRupiah } from "@/lib/products";
import { REASON_REQUIRED, REJECT_PRESETS, type Queue, type QueueItem } from "@/lib/verify";

export type Decision = { tone: "ok" | "error"; text: string };

// Satu bukti: layar penuh di HP dan tablet, panel di samping daftar di PC (DESIGN §6). Dibuat ulang per pesanan (key), jadi keadaannya selalu bersih.
export function VerifyPanel({ item, bankAccount, onDone }: { item: QueueItem; bankAccount: Queue["bankAccount"]; onDone: (d: Decision) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<"accept" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const proof = `/api/admin/payments/${item.orderId}/proof`;
  const pdf = item.mime === "application/pdf";
  useEffect(() => { heading.current?.focus(); }, []);

  async function decide(kind: "accept" | "reject") {
    if (kind === "reject" && !reason.trim()) { setReasonError(true); return; }
    setDialog(null);
    setBusy(true);
    const res = await apiClient(`/api/admin/payments/${item.orderId}/${kind}`, kind === "reject" ? { reason } : undefined);
    onDone(res.ok ? { tone: "ok", text: `${item.invoiceNumber} ${kind === "accept" ? "diterima" : "ditolak"}` } : { tone: "error", text: res.body.message });
  }

  return (
    <section className="verify-panel" aria-label="Periksa bukti">
      <div className="verify-body">
        <Link className="back" href="/admin">Kembali ke antrean</Link>
        <h2 ref={heading} tabIndex={-1}>{item.invoiceNumber}</h2>
        <p className="meta">{item.buyerName ?? "Pembeli"}</p>
        <ul className="verify-lines">{item.items.map((i, n) => <li key={n}>{i.name} × {i.qty}</li>)}</ul>
        <p>Total <strong data-testid="total-periksa">{formatRupiah(item.total)}</strong></p>
        <p data-testid="rekening-periksa">
          {bankAccount ? <>Transfer ke <strong>{bankAccount.bank} <span className="mono">{bankAccount.number}</span></strong> a.n. {bankAccount.holder}</> : "Rekening tujuan belum diatur. Cek pengaturan toko."}
        </p>
        {pdf ? (
          <a href={proof} target="_blank" rel="noopener noreferrer">Buka bukti (PDF)</a>
        ) : (
          <>
            <div className="proof-frame" tabIndex={0} role="group" aria-label="Area bukti, bisa digeser">
              {/* eslint-disable-next-line @next/next/no-img-element -- bukti dari API kita sendiri, harus lewat endpoint yang mencatat pembukaan */}
              <img src={proof} alt={`Bukti bayar ${item.invoiceNumber}`} />
            </div>
            <a href={proof} target="_blank" rel="noopener noreferrer">Buka ukuran penuh</a>
          </>
        )}
      </div>
      <div className="verify-actions">
        <Button type="button" variant="danger" disabled={busy} onClick={() => setDialog("reject")}>Tolak</Button>
        <Button type="button" disabled={busy} onClick={() => setDialog("accept")}>Terima</Button>
      </div>

      <ConfirmDialog open={dialog === "accept"} title={`Terima bukti bayar ${item.invoiceNumber}?`} variant="primary" confirmLabel="Ya, terima" onCancel={() => setDialog(null)} onConfirm={() => decide("accept")}>
        Pesanan jadi Lunas dan pembeli dikabari lewat email.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "reject"} title={`Tolak bukti bayar ${item.invoiceNumber}?`} confirmLabel="Ya, tolak" onCancel={() => setDialog(null)} onConfirm={() => decide("reject")}>
        <div className="stack">
          <div className="pills">
            {REJECT_PRESETS.map((p) => <button key={p} type="button" className="pill" onClick={() => { setReason(p); setReasonError(false); }}>{p}</button>)}
          </div>
          <div className="field">
            <label htmlFor="alasan">Alasan penolakan</label>
            <textarea id="alasan" value={reason} maxLength={500} aria-invalid={reasonError} aria-describedby={reasonError ? "alasan-error" : undefined} onChange={(e) => { setReason(e.target.value); setReasonError(false); }} />
            {reasonError && <p id="alasan-error" className="field-error">{REASON_REQUIRED}</p>}
          </div>
        </div>
      </ConfirmDialog>
    </section>
  );
}
