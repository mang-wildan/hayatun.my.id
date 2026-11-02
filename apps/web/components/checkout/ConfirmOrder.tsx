"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

const STATUS: Record<string, string> = { inactive: "tidak dijual lagi", out_of_stock: "habis", exceeds_stock: "stoknya kurang" };

export function ConfirmOrder({ expectedTotal, addressId, courier, service, methods }: { expectedTotal: number; addressId?: string; courier?: string; service?: string; methods: string[] }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, refresh] = useTransition();
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [method, setMethod] = useState<"manual" | "gateway">("manual");
  const busy = useRef(false); // mencegah dua pesanan dari klik ganda sebelum tombol sempat terkunci

  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setError(undefined);
    const res = await apiClient<{ orderId: string; paymentUrl: string | null }>("/api/checkout", { addressId, courier, service, expectedTotal, paymentMethod: method });
    // tombol tetap terkunci sampai pindah halaman; tanpa tautan (gateway gagal), halaman pesanan menawarkan coba lagi
    if (res.ok) return res.data.paymentUrl ? window.location.assign(res.data.paymentUrl) : router.push(`/pesanan/${res.data.orderId}`);
    const body = res.body as { message: string; code?: string; items?: { name: string; status: string }[] };
    if (body.code === "CART_NOT_READY") {
      setBlocked(true);
      setError(`${body.message} ${(body.items ?? []).map((i) => `${i.name} (${STATUS[i.status] ?? i.status})`).join(", ")}.`);
    } else {
      setError(body.message);
      if (body.code === "TOTAL_CHANGED") refresh(() => router.refresh()); // total baru tampil sebelum pembeli mencoba lagi
    }
    busy.current = false;
    setSending(false);
  }

  return (
    <div className="stack">
      {methods.includes("gateway") && (
        <fieldset className="radio-group">
          <legend>Cara bayar</legend>
          <label className="radio option"><input type="radio" name="cara-bayar" checked={method === "manual"} onChange={() => setMethod("manual")} />Transfer bank</label>
          <label className="radio option"><input type="radio" name="cara-bayar" checked={method === "gateway"} onChange={() => setMethod("gateway")} />Bayar online (virtual account, e-wallet)</label>
        </fieldset>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {blocked && <Link className="btn" data-variant="secondary" href="/keranjang">Kembali ke keranjang</Link>}
      {!blocked && <Button type="button" loading={sending} loadingLabel="Membuat pesanan…" disabled={refreshing} onClick={submit}>Buat pesanan</Button>}
    </div>
  );
}
