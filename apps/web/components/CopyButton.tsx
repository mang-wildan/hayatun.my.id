"use client";

import { useState } from "react";

// `label` memberi nama yang jelas bagi pembaca layar bila ada beberapa tombol Salin di satu halaman
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="link-button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Tersalin" : "Salin"}
    </button>
  );
}
