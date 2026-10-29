"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

// F4.6: pembeli bisa membatalkan selama menunggu pembayaran
export function CancelOrder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [, refresh] = useTransition();

  async function cancel() {
    setOpen(false);
    setError(undefined);
    const res = await apiClient(`/api/orders/${orderId}/cancel`);
    if (res.ok) refresh(() => router.refresh());
    else setError(res.body.message);
  }

  return (
    <div className="stack">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Batalkan pesanan</Button>
      <ConfirmDialog open={open} title="Batalkan pesanan?" confirmLabel="Ya, batalkan" onCancel={() => setOpen(false)} onConfirm={cancel}>
        Stok yang ditahan untukmu akan dilepas, dan pesanan yang sudah dibatalkan tidak bisa dipakai lagi.
      </ConfirmDialog>
    </div>
  );
}
