export type EmailTemplate =
  | "verify_email"
  | "email_already_registered"
  | "reset_password"
  | "login_locked"
  | "admin_invite"
  | "low_stock"
  | "order_expired"
  | "order_reminder"
  | "payment_accepted"
  | "payment_rejected"
  | "order_created"
  | "proof_uploaded"
  | "license_delivered"
  | "license_pending"
  | "order_shipped"
  | "tracking_updated"
  | "order_cancelled"
  | "order_refunded";

export interface EmailData { name?: string; link?: string; productName?: string; available?: number; invoiceNumber?: string; total?: string; deadline?: string; reason?: string; bank?: { bank: string; number: string; holder: string } | null; licenses?: { name: string; codes: string[]; missing?: number }[]; missing?: number; courier?: string; trackingNumber?: string }

const BRAND = "#9D174D";
const ACTION = "#166534";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Content { subject: string; paragraphs: string[] | ((d: EmailData) => string[]); button?: { label: string }; note?: string }

const licenseLines = (d: EmailData) => (d.licenses ?? []).filter((l) => l.codes.length).map((l) => `Kode lisensi ${l.name}: ${l.codes.join(", ")}`);
const licenseLater = (d: EmailData) => ((d.licenses ?? []).some((l) => l.missing) ? ["Sebagian kode lisensi menyusul: kami kirim lewat email begitu stok kodenya ditambah."] : []);

// subjek tetap dan tidak memuat data pengguna, jadi tidak bisa disisipi header
const CONTENT: Record<EmailTemplate, Content> = {
  verify_email: {
    subject: "Verifikasi email akun Hayatun-mu",
    paragraphs: ["Terima kasih sudah daftar di Hayatun. Klik tombol di bawah supaya kamu bisa mulai belanja."],
    button: { label: "Verifikasi email" },
    note: "Tautan ini berlaku 24 jam dan hanya bisa dipakai sekali.",
  },
  email_already_registered: {
    subject: "Ada yang mencoba daftar dengan emailmu",
    paragraphs: [
      "Ada yang baru saja mencoba daftar di Hayatun memakai emailmu, padahal emailmu sudah punya akun.",
      "Kalau itu kamu, silakan masuk seperti biasa atau pakai \"Lupa password\" bila perlu. Kalau bukan kamu, abaikan saja email ini; akunmu tetap aman.",
    ],
  },
  reset_password: {
    subject: "Atur ulang password Hayatun-mu",
    paragraphs: ["Kami menerima permintaan untuk mengatur ulang password akunmu. Klik tombol di bawah untuk membuat password baru."],
    button: { label: "Atur ulang password" },
    note: "Tautan ini berlaku 60 menit dan hanya bisa dipakai sekali. Kalau bukan kamu yang meminta, abaikan saja email ini.",
  },
  login_locked: {
    subject: "Ada percobaan masuk ke akun Hayatun-mu",
    paragraphs: [
      "Ada beberapa kali percobaan masuk yang gagal ke akunmu, jadi kami mengunci percobaan masuk selama 15 menit.",
      "Kalau itu kamu, tunggu 15 menit lalu coba lagi. Kalau bukan kamu, sebaiknya ganti password-mu lewat \"Lupa password\".",
    ],
  },
  low_stock: {
    subject: "Stok produk hampir habis",
    paragraphs: (d) => [
      d.available === 0 ? `Stok "${d.productName}" sudah habis.` : `Stok "${d.productName}" tinggal ${d.available}.`,
      "Tambah stok supaya pembeli masih bisa memesannya.",
    ],
    button: { label: "Atur stok" },
  },
  order_expired: {
    subject: "Pesananmu kedaluwarsa",
    paragraphs: (d) => [
      `Pesanan ${d.invoiceNumber} kedaluwarsa karena bukti bayar belum diunggah sampai batas waktunya.`,
      "Kalau masih mau membeli, silakan checkout ulang ya. Stok yang tadinya ditahan untukmu sudah dilepas.",
    ],
    button: { label: "Lihat pesanan" },
  },
  order_reminder: {
    subject: "Batas bayar pesananmu tinggal 3 jam",
    paragraphs: (d) => [
      `Batas unggah bukti bayar pesanan ${d.invoiceNumber} tinggal 3 jam, yaitu ${d.deadline}.`,
      `Total yang perlu ditransfer: ${d.total}.`,
      "Kalau sudah transfer, unggah buktinya supaya pesananmu bisa segera kami cek.",
    ],
    button: { label: "Bayar sekarang" },
  },
  payment_accepted: {
    subject: "Pembayaranmu sudah kami terima",
    paragraphs: (d) => [`Pembayaran untuk pesanan ${d.invoiceNumber} sudah kami terima dan diverifikasi. Terima kasih!`, ...licenseLines(d), ...licenseLater(d)],
    button: { label: "Lihat pesanan" },
  },
  payment_rejected: {
    subject: "Bukti bayarmu belum bisa diterima",
    paragraphs: (d) => [
      `Bukti bayar untuk pesanan ${d.invoiceNumber} belum bisa kami terima.`,
      `Alasannya: ${d.reason}`,
      `Kamu masih bisa mengunggah bukti yang baru sampai ${d.deadline}.`,
    ],
    button: { label: "Unggah bukti baru" },
  },
  order_created: {
    subject: "Pesananmu sudah dibuat, tinggal bayar",
    paragraphs: (d) => [
      `Pesanan ${d.invoiceNumber} sudah kami catat. Transfer ${d.total} sebelum ${d.deadline}.`,
      d.bank ? `Transfer ke ${d.bank.bank} ${d.bank.number} a.n. ${d.bank.holder}.` : "Rekening tujuan ada di halaman pesanan.",
      "Setelah transfer, unggah bukti bayarnya supaya pesananmu bisa segera kami cek.",
    ],
    button: { label: "Unggah bukti bayar" },
  },
  proof_uploaded: {
    subject: "Ada bukti bayar baru",
    paragraphs: (d) => [`Pembeli mengunggah bukti bayar untuk pesanan ${d.invoiceNumber} sebesar ${d.total}.`, "Cek dan putuskan terima atau tolak."],
    button: { label: "Periksa bukti" },
  },
  license_delivered: {
    subject: "Kode lisensimu sudah tersedia",
    paragraphs: (d) => [`Kode lisensi untuk pesanan ${d.invoiceNumber} sudah lengkap.`, ...licenseLines(d)],
    button: { label: "Lihat pesanan" },
  },
  license_pending: {
    subject: "Lisensi tertunda, stok kode perlu ditambah",
    paragraphs: (d) => [`Pesanan ${d.invoiceNumber} sudah Lunas, tapi kode lisensi "${d.productName}" kurang ${d.missing}.`, "Tambah kode supaya pembeli segera mendapatkannya; kami kirim otomatis begitu kodenya masuk."],
    button: { label: "Tambah kode" },
  },
  order_shipped: {
    subject: "Pesananmu sedang dikirim",
    paragraphs: (d) => [`Pesanan ${d.invoiceNumber} sudah dikirim lewat ${d.courier}.`, `Nomor resi: ${d.trackingNumber}`, "Pakai nomor itu untuk melacak kirimanmu di situs ekspedisi."],
    button: { label: "Lihat pesanan" },
  },
  tracking_updated: {
    subject: "Nomor resi pesananmu diperbarui",
    paragraphs: (d) => [`Nomor resi pesanan ${d.invoiceNumber} diperbarui. Ekspedisi: ${d.courier}.`, `Nomor resi baru: ${d.trackingNumber}`],
    button: { label: "Lihat pesanan" },
  },
  order_cancelled: {
    subject: "Pesananmu dibatalkan",
    paragraphs: (d) => [`Pesanan ${d.invoiceNumber} dibatalkan oleh toko. Akses unduhan untuk pesanan ini ikut dicabut.`, "Kalau ada yang ingin ditanyakan, hubungi toko lewat kontak di halaman pesanan."],
    button: { label: "Lihat pesanan" },
  },
  order_refunded: {
    subject: "Pesananmu dikembalikan",
    paragraphs: (d) => [`Pesanan ${d.invoiceNumber} ditandai dikembalikan oleh toko. Akses unduhan untuk pesanan ini ikut dicabut.`, "Kalau ada yang ingin ditanyakan, hubungi toko lewat kontak di halaman pesanan."],
    button: { label: "Lihat pesanan" },
  },
  admin_invite: {
    subject: "Undangan jadi admin Hayatun",
    paragraphs: ["Kamu diundang menjadi admin toko Hayatun. Klik tombol di bawah untuk membuat password dan memasang verifikasi dua langkah."],
    button: { label: "Terima undangan" },
    note: "Undangan ini berlaku 72 jam dan hanya bisa dipakai sekali.",
  },
};

export function renderEmail(template: EmailTemplate, data: EmailData): { subject: string; text: string; html: string } {
  const c = CONTENT[template];
  if (c.button && !data.link) throw new Error(`Templat ${template} butuh data link`);
  if (template === "low_stock" && (data.productName === undefined || data.available === undefined)) throw new Error("Templat low_stock butuh data productName dan available");
  if (["order_expired", "order_reminder", "payment_accepted", "payment_rejected", "order_created", "proof_uploaded", "license_delivered", "license_pending", "order_shipped", "tracking_updated", "order_cancelled", "order_refunded"].includes(template) && !data.invoiceNumber) throw new Error(`Templat ${template} butuh data invoiceNumber`);
  if (["order_created", "proof_uploaded"].includes(template) && !data.total) throw new Error(`Templat ${template} butuh data total`);
  if (template === "license_delivered" && !data.licenses?.length) throw new Error("Templat license_delivered butuh data licenses");
  if (template === "license_pending" && (data.productName === undefined || !data.missing)) throw new Error("Templat license_pending butuh data productName dan missing");
  if (["order_shipped", "tracking_updated"].includes(template) && (!data.courier || !data.trackingNumber)) throw new Error(`Templat ${template} butuh data courier dan trackingNumber`);
  if (template === "order_created" && !data.deadline) throw new Error("Templat order_created butuh data deadline");
  if (template === "payment_rejected" && (!data.reason || !data.deadline)) throw new Error("Templat payment_rejected butuh data reason dan deadline");
  const paragraphs = typeof c.paragraphs === "function" ? c.paragraphs(data) : c.paragraphs;
  const greeting = data.name ? `Halo ${data.name},` : "Halo,";

  const text = [
    greeting,
    ...paragraphs,
    ...(c.button ? [`${c.button.label}: ${data.link}`] : []),
    ...(c.note ? [c.note] : []),
    "Salam,\nHayatun",
  ].join("\n\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#18181B">${escapeHtml(s)}</p>`;
  const link = data.link ? escapeHtml(data.link) : "";
  const html = `<!doctype html>
<html lang="id"><body style="margin:0;padding:24px 16px;background:#FDF2F8;font-family:Outfit,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #FBCFE8;border-radius:16px;padding:24px">
<div style="font-size:22px;font-weight:700;color:${BRAND};margin-bottom:16px">Hayatun</div>
${p(greeting)}
${paragraphs.map(p).join("\n")}
${c.button ? `<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:${ACTION};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:16px;padding:14px 24px;border-radius:12px">${escapeHtml(c.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.4;color:#52525B">Kalau tombolnya tidak jalan, salin tautan ini ke browser:<br>${link}</p>` : ""}
${c.note ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.4;color:#52525B">${escapeHtml(c.note)}</p>` : ""}
${p("Salam, Hayatun")}
</div></body></html>`;

  return { subject: c.subject, text, html };
}
