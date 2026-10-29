import type { Metadata } from "next";
import { SettingsForms, type Settings } from "@/components/settings/SettingsForms";
import { apiServer, unwrap } from "@/lib/api-server";

export const metadata: Metadata = { title: "Pengaturan toko" };

export default async function Pengaturan() {
  const settings = unwrap(await apiServer<Settings>("/api/admin/settings"));
  return (
    <>
      <h1>Pengaturan toko</h1>
      <SettingsForms initial={settings} />
    </>
  );
}
