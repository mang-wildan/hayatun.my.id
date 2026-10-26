import type { Metadata } from "next";
import { TotpEnrollAdmin } from "@/components/forms/TotpForms";

export const metadata: Metadata = { title: "Pasang verifikasi dua langkah" };

export default function Page() {
  return (
    <>
      <h1>Pasang verifikasi dua langkah</h1>
      <TotpEnrollAdmin />
    </>
  );
}
