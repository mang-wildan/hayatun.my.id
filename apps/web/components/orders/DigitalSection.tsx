"use client";

import { STATUS_LABELS, STATUS_TONES, type DigitalStatus } from "@hayatun/shared";
import { useState } from "react";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";
import type { OrderFiles, OrderLicenses } from "@/lib/orders";

type Props = { orderId: string; status: DigitalStatus; files: OrderFiles["items"]; licenses: OrderLicenses["items"]; links: Record<string, string> };

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// F7.2, F7.5: unduhan dan kode lisensi. Tombol Unduh meminta tautan 15 menit baru setiap ditekan (F7.3).
export function DigitalSection({ orderId, status, files, licenses, links }: Props) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  async function download(fileId: string) {
    setError(undefined);
    setBusy(fileId);
    const res = await apiClient<{ url: string }>(`/api/orders/${orderId}/files/${fileId}/download`);
    setBusy(undefined);
    if (res.ok) window.location.assign(res.data.url);
    else setError(res.body.message);
  }

  const revoked = status === "DICABUT";
  const pending = licenses.some((l) => l.missing > 0);
  return (
    <section className="stack" aria-labelledby="digital-h">
      <h2 id="digital-h">Digital</h2>
      <p><span className="badge" data-tone={STATUS_TONES.digital[status]} data-testid="status-digital">{STATUS_LABELS.digital[status]}</span></p>
      {revoked && <p className="notice">Akses unduhan dicabut.</p>}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {!revoked && files.map((item, n) => (
        <div key={n} className="stack">
          <h3>{item.name}</h3>
          <ul className="file-list">
            {item.files.map((f) => (
              <li key={f.id}>
                <div>{f.filename}{f.sizeBytes ? <span className="meta"> {size(f.sizeBytes)}</span> : null}</div>
                {f.kind === "file"
                  ? <Button type="button" variant="secondary" loading={busy === f.id} loadingLabel="Menyiapkan…" aria-label={`Unduh ${f.filename}`} onClick={() => download(f.id)}>Unduh</Button>
                  : <a className="btn" data-variant="secondary" href={links[f.id]} target="_blank" rel="noopener noreferrer" aria-label={`Buka tautan ${f.filename}`}>Buka</a>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!revoked && licenses.map((l, n) => (
        <div key={n} className="stack">
          {l.codes.map((c) => (
            <p key={c} className="license-row">
              <span className="meta">{l.name}</span>
              <span className="mono" data-testid="kode-lisensi">{c}</span> <CopyButton text={c} label={`Salin kode lisensi ${c}`} />
            </p>
          ))}
        </div>
      ))}
      {!revoked && pending && <p className="notice">Kode lisensi menyusul, kami kabari lewat email.</p>}
    </section>
  );
}
