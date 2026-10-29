"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

// F8.3. Konfirmasi dulu: setelah ini pesanan dianggap selesai dan tidak bisa dibatalkan.
export function ReceivedButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, refresh] = useTransition();

  async function confirm() {
    setOpen(false);
    setError(undefined);
    const res = await apiClient(`/api/orders/${orderId}/received`);
    if (res.ok) refresh(() => router.refresh());
    else setError(res.body.message);
  }

  return (
    <div className="stack">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="button" loading={pending} onClick={() => setOpen(true)}>Pesanan diterima</Button>
      <ConfirmDialog open={open} title="Pesanan sudah kamu terima?" variant="primary" confirmLabel="Ya, sudah diterima" onCancel={() => setOpen(false)} onConfirm={confirm}>
        Setelah ini pesanan dianggap selesai dan tidak bisa dibatalkan.
      </ConfirmDialog>
    </div>
  );
}
