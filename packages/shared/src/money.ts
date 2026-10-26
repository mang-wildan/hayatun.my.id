export function formatRupiah(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Nominal harus bilangan bulat tidak negatif");
  return "Rp" + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
