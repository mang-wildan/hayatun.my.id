export interface Sample { action: string; ms: number; ok: boolean }
export interface ActionStats { action: string; count: number; errors: number; p50: number | null; p95: number | null; max: number | null }

// Peringkat terdekat: nilai ke-ceil(p% x n) dari data terurut
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function stats(action: string, samples: Sample[]): ActionStats {
  const ms = samples.map((x) => x.ms);
  return { action, count: samples.length, errors: samples.filter((x) => !x.ok).length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms.length ? Math.max(...ms) : null };
}

export function summarize(samples: Sample[]) {
  const names = [...new Set(samples.map((x) => x.action))].sort();
  return { overall: stats("keseluruhan", samples), actions: names.map((n) => stats(n, samples.filter((x) => x.action === n))) };
}

// N18: p95 ≤ 500 ms untuk tiap aksi dan keseluruhan, tanpa permintaan gagal. Sampel yang terlalu sedikit membuat hasil tidak sah.
export function violations(r: ReturnType<typeof summarize>, { budgetMs = 500, minSamples = 300 } = {}): string[] {
  if (r.overall.count < minSamples) return [`hanya ${r.overall.count} permintaan terukur, minimal ${minSamples}`];
  const out: string[] = [];
  for (const a of r.actions) {
    if (a.errors) out.push(`aksi "${a.action}": ${a.errors} permintaan gagal`);
    if (a.p95! > budgetMs) out.push(`aksi "${a.action}": p95 ${a.p95} ms melebihi ${budgetMs} ms`);
  }
  if (r.overall.p95! > budgetMs) out.push(`keseluruhan: p95 ${r.overall.p95} ms melebihi ${budgetMs} ms`);
  return out;
}

// N20: email sampai dalam 5 menit pada p95; email yang tidak pernah tiba tidak boleh dilewati diam-diam
export function emailLagViolations(lagsMs: number[], expected: number, budgetMs = 300_000): string[] {
  if (!expected) return ["email: tidak ada email yang diukur"];
  if (lagsMs.length < expected) return [`email: hanya ${lagsMs.length} dari ${expected} email tiba`];
  const p95 = percentile(lagsMs, 95)!;
  return p95 > budgetMs ? [`email: p95 ${p95} ms melebihi ${budgetMs} ms`] : [];
}
