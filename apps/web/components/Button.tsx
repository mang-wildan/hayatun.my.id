import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  loadingLabel?: string; // label saat memproses, misalnya "Mendaftarkan…"
}

// Saat memproses: label berganti dan tombol tidak bisa ditekan lagi (DESIGN §5)
export function Button({ variant = "primary", loading, loadingLabel, children, disabled, type = "submit", ...rest }: Props) {
  return (
    <button className="btn" data-variant={variant} type={type} disabled={disabled || loading} {...rest}>
      {loading ? (loadingLabel ?? "Memproses…") : children}
    </button>
  );
}
