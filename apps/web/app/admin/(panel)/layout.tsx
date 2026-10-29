import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/AdminShell";
import { apiServer, getAuth } from "@/lib/api-server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, expired } = await getAuth();
  if (!user) redirect(expired ? "/masuk?pesan=sesi-habis" : "/masuk");
  if (user.role !== "admin") redirect("/masuk");
  const queue = await apiServer<{ items: unknown[] }>("/api/admin/payments"); // angka di menu; gagal berarti tanpa angka
  return <AdminShell queueCount={queue.ok ? queue.data.items.length : 0}>{children}</AdminShell>;
}
