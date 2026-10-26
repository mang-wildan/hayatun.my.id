import type { Metadata } from "next";
import { RegisterForm } from "@/components/forms/AuthForms";

export const metadata: Metadata = { title: "Daftar" };

export default function Page() {
  return (
    <>
      <h1>Daftar</h1>
      <RegisterForm />
    </>
  );
}
