import type { Metadata } from "next";
import { TotpLoginForm } from "@/components/forms/TotpForms";

export const metadata: Metadata = { title: "Kode verifikasi" };

export default function Page() {
  return (
    <>
      <h1>Kode verifikasi</h1>
      <TotpLoginForm />
    </>
  );
}
