import type { ReactNode } from "react";

const PATH = { error: "M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z", ok: "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };

// Status tidak pernah disampaikan lewat warna saja: selalu ada ikon dan teks (DESIGN §2)
export function FormMessage({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return (
    <p className="message" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATH[tone]} /></svg>
      <span>{children}</span>
    </p>
  );
}
