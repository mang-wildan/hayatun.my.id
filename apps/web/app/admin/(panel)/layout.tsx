import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/AdminShell";
import { getAuth } from "@/lib/api-server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, expired } = await getAuth();
  if (!user) redirect(expired ? "/masuk?pesan=sesi-habis" : "/masuk");
  if (user.role !== "admin") redirect("/masuk");
  return <AdminShell>{children}</AdminShell>;
}
