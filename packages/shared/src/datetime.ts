const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const pad = (n: number) => String(n).padStart(2, "0");

// WIB = UTC+7 sepanjang tahun (tanpa DST), jadi cukup geser jam lalu baca sebagai UTC
export function formatWIB(date: Date): string {
  const d = new Date(date.getTime() + 7 * 3600_000);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())} WIB`;
}
