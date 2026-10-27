export type EmailTemplate =
  | "verify_email"
  | "email_already_registered"
  | "reset_password"
  | "login_locked"
  | "admin_invite"
  | "low_stock";

export interface EmailData { name?: string; link?: string; productName?: string; available?: number }

const BRAND = "#9D174D";
const ACTION = "#166534";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Content { subject: string; paragraphs: string[] | ((d: EmailData) => string[]); button?: { label: string }; note?: string }

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
