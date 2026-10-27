"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";
import type { Cart, CartItem } from "@/lib/cart";
import { formatRupiah, typeLabel } from "@/lib/products";

const BLOCKED = "Ada item yang tidak bisa dibeli. Hapus item itu dulu untuk melanjutkan.";

export function CartView({ cart }: { cart: Cart }) {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string }>();
  const [sending, setSending] = useState(false);
  const [refreshing, refresh] = useTransition();
  const busy = sending || refreshing; // tetap terkunci sampai data baru tiba, supaya klik cepat tidak memakai jumlah lama

  async function act(request: Promise<{ ok: boolean; body?: { message: string } }>, done?: string) {
    setSending(true);
    setNote(undefined);
    const res = await request;
    if (res.ok) refresh(() => router.refresh());
    setNote(res.ok ? (done ? { tone: "ok", text: done } : undefined) : { tone: "error", text: res.body!.message });
    setSending(false);
  }
  const setQty = (i: CartItem, qty: number) => act(apiClient(`/api/cart/items/${i.productId}`, { qty }, "PATCH"));
  const remove = (i: CartItem) => act(apiClient(`/api/cart/items/${i.productId}`, undefined, "DELETE"), `${i.name} dihapus dari keranjang.`);

  if (cart.items.length === 0 && !note) {
    return (
      <div className="stack">
        <p className="empty">Keranjangmu masih kosong.</p>
        <Link className="btn" data-variant="primary" href="/">Mulai belanja</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      {note && <FormMessage tone={note.tone}>{note.text}</FormMessage>}
      {cart.items.length === 0 ? (
        <>
          <p className="empty">Keranjangmu masih kosong.</p>
          <Link className="btn" data-variant="primary" href="/">Mulai belanja</Link>
        </>
      ) : (
        <>
          <ul className="cart-list">
            {cart.items.map((i) => (
              <li key={i.productId}>
                <div className="cart-info">
                  <Link href={`/produk/${i.slug}`}>{i.name}</Link>
                  <div className="badges">
                    <span className="badge" data-tone="neutral">{typeLabel(i.type)}</span>
                    {i.status === "inactive" && <span className="badge" data-tone="danger">Tidak dijual lagi</span>}
                    {i.status === "out_of_stock" && <span className="badge" data-tone="danger">Habis</span>}
                  </div>
                  <p className="meta">{formatRupiah(i.price)}</p>
                  {i.status === "exceeds_stock" && <p className="field-error">Stok tersisa {i.maxQty}. Kurangi jumlahnya.</p>}
                </div>
                {i.type === "physical" && (i.status === "ok" || i.status === "exceeds_stock") && (
                  <div className="stepper" role="group" aria-label={`Jumlah ${i.name}`}>
                    <Button type="button" variant="secondary" aria-label={`Kurangi jumlah ${i.name}`} disabled={busy || i.qty <= 1} onClick={() => setQty(i, i.qty - 1)}>−</Button>
                    <span data-testid="jumlah">{i.qty}</span>
                    <Button type="button" variant="secondary" aria-label={`Tambah jumlah ${i.name}`} disabled={busy || i.qty >= i.maxQty} onClick={() => setQty(i, i.qty + 1)}>+</Button>
                  </div>
                )}
                {i.status === "ok" && <p className="cart-total">{formatRupiah(i.lineTotal)}</p>}
                <Button type="button" variant="secondary" aria-label={`Hapus ${i.name}`} disabled={busy} onClick={() => remove(i)}>Hapus</Button>
              </li>
            ))}
          </ul>
          {cart.items.some((i) => i.status !== "ok") && <FormMessage tone="error">{BLOCKED}</FormMessage>}
          <p className="cart-subtotal">Subtotal <strong data-testid="subtotal">{formatRupiah(cart.subtotal)}</strong></p>
        </>
      )}
    </div>
  );
}
