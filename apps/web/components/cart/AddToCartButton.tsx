"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiClient } from "@/lib/api-client";

export function AddToCartButton({ productId, loggedIn }: { productId: string; loggedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string }>();

  async function add() {
    if (!loggedIn) return router.push("/masuk?pesan=masuk-dulu");
    setBusy(true);
    setNote(undefined);
    const res = await apiClient("/api/cart/items", { productId });
    setNote(res.ok ? { tone: "ok", text: "Masuk ke keranjang." } : { tone: "error", text: res.body.message });
    if (res.ok) router.refresh(); // jumlah di bar atas ikut diperbarui
    setBusy(false);
  }

  return (
    <div className="stack">
      <Button type="button" loading={busy} loadingLabel="Memasukkan…" onClick={add}>Masukkan keranjang</Button>
      {note && <FormMessage tone={note.tone}>{note.text}</FormMessage>}
    </div>
  );
}
