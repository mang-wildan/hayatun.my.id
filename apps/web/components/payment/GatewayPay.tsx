"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

// Tautan bayar dari gateway (T64). Tanpa tautan (gateway gagal saat checkout), pembeli bisa mencoba lagi tanpa membuat pesanan baru.
export function GatewayPay({ orderId, paymentUrl }: { orderId: string; paymentUrl: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (paymentUrl) return <a className="btn" data-variant="primary" href={paymentUrl}>Lanjut bayar online</a>;

  async function retry() {
    setBusy(true);
    setError(undefined);
    const res = await apiClient<{ paymentUrl: string }>(`/api/orders/${orderId}/payment/gateway`);
    if (res.ok) return window.location.assign(res.data.paymentUrl);
    setError(res.body.message);
    setBusy(false);
  }

  return (
    <div className="stack">
      <p className="notice">Pembayaran online belum bisa dibuka. Pesananmu tetap tersimpan, coba lagi sebentar lagi atau batalkan dan pakai transfer bank.</p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="button" loading={busy} loadingLabel="Membuka…" onClick={retry}>Coba lagi</Button>
    </div>
  );
}
