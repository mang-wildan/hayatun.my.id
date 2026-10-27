"use client";

import { Button } from "@/components/Button";

// Unduh = fitur cetak browser, "Simpan sebagai PDF" (ARCHITECTURE K8)
export function PrintButton() {
  return <Button type="button" variant="secondary" onClick={() => window.print()}>Cetak / Simpan sebagai PDF</Button>;
}
