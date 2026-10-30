import { addUser, photoJpeg, seedProducts, startStack, WEB_URL } from "./harness.js";

// Penyaji untuk Lighthouse CI: API dan web produksi (build sudah ada) dengan beberapa produk bersampul.
const stack = await startStack({ web: true });
const admin = await addUser(stack, "admin", "admin-kinerja@hayatun.test");
const products = await seedProducts(admin.cookies[0], ["E-book Kinerja", "Template Kinerja", "Panduan Kinerja", "Kursus Kinerja", "Paket Kinerja", "Catatan Kinerja"], await photoJpeg());
// Pemanasan: cache pengoptimal gambar Next dingin pada kunjungan pertama, dan itu selalu run Lighthouse yang terlambat. Yang diukur
// adalah keadaan tunak; sampul yang baru diunggah memang sekali lambat (dicatat di PR).
const pages = ["/", ...products.map((p) => `/produk/${p.slug}`)];
for (const path of pages) {
  const html = await (await fetch(`${WEB_URL}${path}`)).text();
  for (const m of html.matchAll(/\/_next\/image\?[^"'\s,]+/g)) await fetch(`${WEB_URL}${m[0].replaceAll("&amp;", "&")}`, { headers: { accept: "image/avif,image/webp,*/*" } });
}
console.log("perf-serve siap");
const bye = async () => { await stack.stop(); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
setInterval(() => {}, 1 << 30);
