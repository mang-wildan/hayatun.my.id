"use client";

import { formatWIB } from "@hayatun/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { OrderStatusBadge } from "@/components/payment/OrderStatusBadge";
import { apiClient } from "@/lib/api-client";
import type { AdminOrder } from "@/lib/admin-orders";
import { formatRupiah } from "@/lib/products";

type Result = { tone: "ok" | "error"; text: string };

// F13.1 daftar, dan F10: Batalkan atau kembalikan pesanan Lunas dengan catatan wajib
export function AdminOrderList({ orders }: { orders: AdminOrder[] }) {
  const router = useRouter();
  const [, refresh] = useTransition();
  const [target, setTarget] = useState<AdminOrder>();
  const [kind, setKind] = useState<"DIBATALKAN" | "DIKEMBALIKAN">("DIBATALKAN");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();

  const open = (o: AdminOrder) => { setTarget(o); setKind("DIBATALKAN"); setNote(""); setError(undefined); setResult(undefined); };

  async function confirm() {
    if (!target) return;
    if (!note.trim()) return setError("Catatan wajib diisi.");
    const res = await apiClient(`/api/admin/orders/${target.orderId}/cancel`, { status: kind, note });
    const invoice = target.invoiceNumber;
    setTarget(undefined);
    setResult(res.ok ? { tone: "ok", text: `${invoice} ${kind === "DIKEMBALIKAN" ? "dikembalikan" : "dibatalkan"}` } : { tone: "error", text: res.body.message });
    refresh(() => router.refresh()); // juga saat gagal: admin lain mungkin sudah mengubahnya
  }

  return (
    <>
      {result && <FormMessage tone={result.tone}>{result.text}</FormMessage>}
      {orders.length === 0 ? <p className="empty">Tidak ada pesanan yang cocok.</p> : (
        <ul className="order-cards">
          {orders.map((o) => (
            <li key={o.orderId} data-testid="admin-pesanan-item" className="admin-order">
              <span className="mono" data-testid="nomor-invoice">{o.invoiceNumber}</span>
              <span className="meta">{formatWIB(new Date(o.createdAt))}</span>
              <span>{o.buyerName}</span>
              <strong>{formatRupiah(o.total)}</strong>
              <OrderStatusBadge status={o.status} />
              {o.status === "LUNAS" && <Button type="button" variant="danger" aria-label={`Batalkan pesanan ${o.invoiceNumber}`} onClick={() => open(o)}>Batalkan pesanan</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(target)} title={`Batalkan pesanan ${target?.invoiceNumber ?? ""}?`} confirmLabel="Ya, batalkan" onCancel={() => setTarget(undefined)} onConfirm={confirm}>
        <div className="stack">
          <p>Akses unduhan dicabut dan stok fisik yang belum dikirim kembali. Penyelesaian dana dilakukan di luar aplikasi.</p>
          <fieldset className="radio-group">
            <legend>Tandai sebagai</legend>
            {(["DIBATALKAN", "DIKEMBALIKAN"] as const).map((k) => (
              <label key={k} className="radio"><input type="radio" name="jenis" checked={kind === k} onChange={() => setKind(k)} />{k === "DIBATALKAN" ? "Dibatalkan" : "Dikembalikan"}</label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="catatan">Catatan</label>
            <textarea id="catatan" value={note} maxLength={500} aria-invalid={error ? true : undefined} aria-describedby={error ? "catatan-error" : undefined} onChange={(e) => { setNote(e.target.value); setError(undefined); }} />
            {error && <p id="catatan-error" className="field-error">{error}</p>}
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
