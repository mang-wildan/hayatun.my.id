import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface Shared { label: string; hint?: string; error?: string }

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <span className="error" id={id}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      {children}
    </span>
  );
}

function useFieldIds({ hint, error }: Shared) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return { id, describedBy };
}

// Label di atas kolom, error di bawahnya dan terhubung lewat aria-describedby (DESIGN §5, N15)
export function TextField({ label, hint, error, ...input }: Shared & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-invalid" | "aria-describedby">) {
  const { id, describedBy } = useFieldIds({ label, hint, error });
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function TextArea({ label, hint, error, ...input }: Shared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "aria-invalid" | "aria-describedby">) {
  const { id, describedBy } = useFieldIds({ label, hint, error });
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
