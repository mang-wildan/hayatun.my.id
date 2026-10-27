import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

export interface ApiUser { id: string; name: string | null; email: string; role: "buyer" | "admin"; emailVerified: boolean; totpEnabled: boolean }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; body: { message: string; code?: string; fields?: Record<string, string> } };

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

// Dipanggil di server Next.js. Cookie sesi pengguna diteruskan ke Express; Next.js tidak pernah membaca database.
export async function apiServer<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const cookie = (await cookies()).getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${API}${path}`, { ...init, cache: "no-store", headers: { ...init.headers, cookie } });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, body: body ?? { message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." } };
}

// `expired` membedakan sesi yang habis dari pengunjung yang belum pernah masuk
export async function getAuth(): Promise<{ user: ApiUser | null; expired: boolean }> {
  const res = await apiServer<ApiUser>("/api/auth/me");
  return res.ok ? { user: res.data, expired: false } : { user: null, expired: !res.ok && res.body.code === "SESSION_EXPIRED" };
}

// Untuk halaman server: layout dan halaman dirender bersamaan, jadi halaman sendiri yang mengarahkan pengunjung tanpa sesi
export function unwrap<T>(res: ApiResult<T>): T {
  if (res.ok) return res.data;
  if (res.status === 401 || res.status === 403) redirect("/masuk");
  if (res.status === 404) notFound();
  throw new Error(res.body.message);
}
