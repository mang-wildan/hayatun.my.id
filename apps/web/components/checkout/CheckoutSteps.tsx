// Langkah checkout terlihat di bagian atas; Pengiriman hanya bila ada produk fisik (DESIGN §6)
export function CheckoutSteps({ current, physical }: { current: "keranjang" | "pengiriman" | "bayar"; physical: boolean }) {
  const steps = [
    { key: "keranjang", label: "Keranjang" },
    ...(physical ? [{ key: "pengiriman", label: "Pengiriman" }] : []),
    { key: "bayar", label: "Bayar" },
  ];
  return (
    <ol className="steps" aria-label="Langkah checkout">
      {steps.map((s) => (
        <li key={s.key} aria-current={s.key === current ? "step" : undefined}>{s.label}</li>
      ))}
    </ol>
  );
}
