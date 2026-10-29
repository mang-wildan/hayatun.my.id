import { formatWIB } from "@hayatun/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionFilter } from "@/components/audit/ActionFilter";
import { apiServer, unwrap } from "@/lib/api-server";
import { actionLabel, type AuditLogPage } from "@/lib/audit-log";

export const metadata: Metadata = { title: "Log aktivitas" };

// F15.3: hanya dibaca. Tidak ada tombol ubah atau hapus (F15.4).
export default async function Log({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.action) params.set("action", sp.action);
  if (sp.page && /^[1-9]\d{0,5}$/.test(sp.page)) params.set("page", sp.page);
  const list = unwrap(await apiServer<AuditLogPage>(`/api/admin/audit-logs?${params}`));
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (page: number) => { const p = new URLSearchParams(params); p.set("page", String(page)); return `/admin/log?${p}`; };

  return (
    <>
      <h1>Log aktivitas</h1>
      <div className="filters"><ActionFilter actions={list.actions} current={sp.action ?? ""} /></div>
      {list.logs.length === 0 ? <p className="empty">Belum ada catatan.</p> : (
        <ul className="queue-cards">
          {list.logs.map((l) => (
            <li key={l.id} data-testid="log-item">
              <strong>{actionLabel(l.action)}</strong>
              <span>{l.actorName ?? "Sistem"}</span>
              {l.entityLabel && <span>{l.entityLabel}</span>}
              <span className="meta">{formatWIB(new Date(l.createdAt))}</span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Halaman">
          {list.page > 1 && <Link className="btn" data-variant="secondary" href={link(list.page - 1)}>Sebelumnya</Link>}
          <span>Halaman {list.page} dari {pages}</span>
          {list.page < pages && <Link className="btn" data-variant="secondary" href={link(list.page + 1)}>Berikutnya</Link>}
        </nav>
      )}
    </>
  );
}
