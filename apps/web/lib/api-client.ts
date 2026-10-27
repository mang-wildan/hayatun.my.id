"use client";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; status: number; body: { message: string; code?: string; fields?: Record<string, string> } };

// Sesi yang habis langsung mengarah ke halaman masuk
async function toResult<T>(res: Response): Promise<ClientResult<T>> {
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  if (res.status === 401 && json?.code === "SESSION_EXPIRED") window.location.assign("/masuk?pesan=sesi-habis");
  return { ok: false, status: res.status, body: json ?? { message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." } };
}

// Dipanggil dari browser ke /api di domain yang sama.
export async function apiClient<T = unknown>(path: string, body?: unknown, method = "POST"): Promise<ClientResult<T>> {
  return toResult<T>(await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), credentials: "same-origin" }));
}

// Mengirim isi file apa adanya (bukan JSON), misalnya sampul dan file produk
export async function apiUpload<T = unknown>(path: string, file: File, method = "POST"): Promise<ClientResult<T>> {
  return toResult<T>(await fetch(path, { method, headers: { "content-type": file.type || "application/octet-stream" }, body: file, credentials: "same-origin" }));
}
