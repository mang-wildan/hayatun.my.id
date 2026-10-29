"use client";

import { useRouter } from "next/navigation";
import { actionLabel } from "@/lib/audit-log";

// Memilih jenis aksi langsung memuat ulang daftar dari halaman 1
export function ActionFilter({ actions, current }: { actions: string[]; current: string }) {
  const router = useRouter();
  const all = actions.includes(current) || !current ? actions : [...actions, current];
  return (
    <div className="field">
      <label htmlFor="f-action">Jenis aksi</label>
      <select id="f-action" value={current} onChange={(e) => router.push(e.target.value ? `/admin/log?action=${encodeURIComponent(e.target.value)}` : "/admin/log")}>
        <option value="">Semua aksi</option>
        {all.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
      </select>
    </div>
  );
}
