import type { Metadata } from "next";
import { ForgotForm } from "@/components/forms/AuthForms";

export const metadata: Metadata = { title: "Lupa password" };

export default function Page() {
  return (
    <>
      <h1>Lupa password</h1>
      <ForgotForm />
    </>
  );
}
