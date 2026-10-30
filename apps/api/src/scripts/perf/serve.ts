import { addUser, photoJpeg, seedProducts, startStack } from "./harness.js";

// Penyaji untuk Lighthouse CI: API dan web produksi (build sudah ada) dengan beberapa produk bersampul.
const stack = await startStack({ web: true });
const admin = await addUser(stack, "admin", "admin-kinerja@hayatun.test");
await seedProducts(admin.cookies[0], ["E-book Kinerja", "Template Kinerja", "Panduan Kinerja", "Kursus Kinerja", "Paket Kinerja", "Catatan Kinerja"], await photoJpeg());
console.log("perf-serve siap");
const bye = async () => { await stack.stop(); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
setInterval(() => {}, 1 << 30);
