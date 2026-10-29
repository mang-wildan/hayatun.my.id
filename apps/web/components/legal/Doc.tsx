import type { ReactNode } from "react";
import { apiServer } from "@/lib/api-server";

// Dokumen bersih bergaya invoice (DESIGN): satu h1, tiap bagian punya judul h2 dan menjadi region bernama
export function Doc({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <article className="doc">
      <h1>{title}</h1>
      {intro && <p className="lead">{intro}</p>}
      {children}
    </article>
  );
}

export function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="stack" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

// Kontak dari pengaturan toko; tidak ada kontak bawaan selain alamat email pengirim yang sudah dikonfigurasi
export async function Contact({ lead }: { lead: string }) {
  const res = await apiServer<{ name: string; email?: string; phone?: string }>("/api/store");
  const s = res.ok ? res.data : { name: "Hayatun" };
  return (
    <Part id="kontak" title="Kontak">
      <p>{lead}</p>
      <p><strong>{s.name}</strong>{s.email && <><br /><a href={`mailto:${s.email}`}>{s.email}</a></>}{s.phone && <><br />{s.phone}</>}</p>
    </Part>
  );
}
