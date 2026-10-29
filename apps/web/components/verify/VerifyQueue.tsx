"use client";

import { formatWIB } from "@hayatun/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { FormMessage } from "@/components/FormMessage";
import { formatRupiah } from "@/lib/products";
import type { Queue, QueueItem } from "@/lib/verify";
import { VerifyPanel, type Decision } from "./VerifyPanel";

const WIDE = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
// Hanya satu tampilan yang ada di halaman: kartu di HP dan tablet, tabel dari 1024px (DESIGN §6)
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);

const EMPTY = "Belum ada bukti yang perlu dicek. Bukti baru akan muncul di sini.";
type SortKey = "invoiceNumber" | "buyerName" | "total" | "uploadedAt";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "invoiceNumber", label: "Invoice" }, { key: "buyerName", label: "Pembeli" }, { key: "total", label: "Total" }, { key: "uploadedAt", label: "Diunggah" },
];
const href = (i: QueueItem) => `/admin?periksa=${i.orderId}`;
const when = (i: QueueItem) => formatWIB(new Date(i.uploadedAt));

export function VerifyQueue({ queue, periksa }: { queue: Queue; periksa?: string }) {
  const router = useRouter();
  const wide = useWide();
  const [, navigate] = useTransition();
  const [message, setMessage] = useState<Decision>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "uploadedAt", dir: "asc" });
  const current = queue.items.find((i) => i.orderId === periksa);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = queue.items.filter((i) => !q || `${i.invoiceNumber} ${i.buyerName ?? ""}`.toLowerCase().includes(q));
    const sign = sort.dir === "asc" ? 1 : -1;
    return shown.sort((a, b) => sign * (typeof a[sort.key] === "number" ? (a.total - b.total) : String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""))));
  }, [queue.items, query, sort]);

  const done = (d: Decision) => {
    setMessage(d);
    navigate(() => { router.replace("/admin"); router.refresh(); });
  };
  const clear = () => setMessage(undefined);

  const list = !queue.items.length ? (
    <p className="empty">{EMPTY}</p>
  ) : !wide ? (
    <ul className="queue-cards">
      {rows.map((i) => (
        <li key={i.orderId} data-testid="antrean-item" aria-current={i.orderId === periksa ? "true" : undefined}>
          <span className="mono">{i.invoiceNumber}</span>
          <span>{i.buyerName}</span>
          <span><strong>{formatRupiah(i.total)}</strong></span>
          <span className="badge" data-tone="wait">Menunggu verifikasi</span>
          <span className="meta">Diunggah {when(i)}</span>
          <Link className="btn" data-variant="primary" href={href(i)} onClick={clear} aria-label={`Periksa bukti ${i.invoiceNumber}`}>Periksa bukti</Link>
        </li>
      ))}
    </ul>
  ) : (
    <div className="stack">
      <div className="field">
        <label htmlFor="cari">Cari invoice atau pembeli</label>
        <input id="cari" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {rows.length === 0 ? <p className="empty">Tidak ada yang cocok dengan pencarianmu.</p> : (
        <table className="product-table queue-table" data-compact={current ? "true" : undefined}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="sort" onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === "asc" ? "desc" : "asc" })}>{c.label}</button>
                </th>
              ))}
              <th scope="col" className="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.orderId} data-testid="antrean-item" aria-current={i.orderId === periksa ? "true" : undefined}>
                <td><Link className="mono" href={href(i)} onClick={clear}>{i.invoiceNumber}</Link></td>
                <td>{i.buyerName}</td>
                <td>{formatRupiah(i.total)}</td>
                <td>{when(i)}</td>
                <td className="col-status"><span className="badge" data-tone="wait">Menunggu verifikasi</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <>
      <h1>Verifikasi</h1>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      {periksa && !current && !message && <p className="notice" role="status">Bukti ini sudah tidak ada di antrean.</p>}
      <div className="verify" data-open={current ? "true" : undefined}>
        {list}
        {current && <VerifyPanel key={current.orderId} item={current} bankAccount={queue.bankAccount} onDone={done} />}
      </div>
    </>
  );
}
