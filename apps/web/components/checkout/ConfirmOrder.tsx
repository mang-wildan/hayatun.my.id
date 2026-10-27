"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

const STATUS: Record<string, string> = { inactive: "tidak dijual lagi", out_of_stock: "habis", exceeds_stock: "stoknya kurang" };

export function ConfirmOrder({ expectedTotal, addressId, courier, service }: { expectedTotal: number; addressId?: string; courier?: string; service?: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, refresh] = useTransition();
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false); // mencegah dua pesanan dari klik ganda sebelum tombol sempat terkunci

  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setError(undefined);
    const res = await apiClient<{ orderId: string }>("/api/checkout", { addressId, courier, service, expectedTotal });
    if (res.ok) return router.push(`/pesanan/${res.data.orderId}`); // tombol tetap terkunci sampai pindah halaman
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
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {blocked && <Link className="btn" data-variant="secondary" href="/keranjang">Kembali ke keranjang</Link>}
      {!blocked && <Button type="button" loading={sending} loadingLabel="Membuat pesanan…" disabled={refreshing} onClick={submit}>Buat pesanan</Button>}
    </div>
  );
}
