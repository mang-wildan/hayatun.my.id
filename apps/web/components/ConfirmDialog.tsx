"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

// Dialog bawaan browser: fokus terkunci di dalamnya dan Esc menutupnya (DESIGN §5)
export function ConfirmDialog({ open, title, children, confirmLabel, variant = "danger", onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; variant?: "primary" | "danger"; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onCancel}>
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      <div className="dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Batal</Button>
        <Button type="button" variant={variant} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
