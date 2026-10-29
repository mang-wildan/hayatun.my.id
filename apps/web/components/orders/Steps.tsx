// Daftar langkah vertikal. Langkah yang sedang berjalan ditandai teks dan aria-current, bukan warna saja (DESIGN §2).
export function Steps({ label, labels, current }: { label: string; labels: string[]; current: number }) {
  return (
    <ol className="steps" aria-label={label}>
      {labels.map((l, i) => (
        <li key={l} data-state={i < current ? "done" : i === current ? "current" : "todo"} aria-current={i === current ? "step" : undefined}>
          {l}{i === current && <span className="meta"> (sekarang)</span>}
        </li>
      ))}
    </ol>
  );
}
