import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";

export default function TokoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="page">{children}</main>
    </>
  );
}
