"use client";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; status: number; body: { message: string; code?: string; fields?: Record<string, string> } };

// Dipanggil dari browser ke /api di domain yang sama. Sesi yang habis langsung mengarah ke halaman masuk.
export async function apiClient<T = unknown>(path: string, body?: unknown): Promise<ClientResult<T>> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), credentials: "same-origin" });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  if (res.status === 401 && json?.code === "SESSION_EXPIRED") window.location.assign("/masuk?pesan=sesi-habis");
  return { ok: false, status: res.status, body: json ?? { message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." } };
}
