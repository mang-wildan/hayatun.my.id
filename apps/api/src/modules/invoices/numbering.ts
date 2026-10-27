import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Periode menurut WIB (UTC+7 tanpa DST), jadi tanggal 31 pukul 23.30 WIB sudah masuk bulan berikutnya bila memang begitu
const period = (now: Date) => {
  const d = new Date(now.getTime() + 7 * 3600_000);
  return { year: d.getUTCFullYear(), month: String(d.getUTCMonth() + 1).padStart(2, "0") };
};

// Wajib dipanggil di dalam transaksi pembuatan pesanan: baris penghitung terkunci sampai commit,
// sehingga nomor berurutan dan, bila transaksi batal, nomor ikut batal (tidak pernah ada pesanan dengan nomor ganda) (F6.1)
export async function nextInvoiceNumber(tx: Tx, now: Date): Promise<string> {
  const { year, month } = period(now);
  const { rows } = await tx.execute<{ last_number: number }>(sql`
    insert into invoice_counters (period, last_number) values (${`${year}${month}`}, 1)
    on conflict (period) do update set last_number = invoice_counters.last_number + 1
    returning last_number`);
  return `INV/${year}/${month}/${String(rows[0].last_number).padStart(4, "0")}`;
}
