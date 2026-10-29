import type { Metadata } from "next";
import { AdminManager, type AdminRow } from "@/components/admins/AdminManager";
import { apiServer, unwrap } from "@/lib/api-server";

export const metadata: Metadata = { title: "Admin" };

export default async function Admin() {
  const { admins } = unwrap(await apiServer<{ admins: AdminRow[] }>("/api/admin/admins"));
  return (
    <>
      <h1>Admin</h1>
      <AdminManager admins={admins} />
    </>
  );
}
