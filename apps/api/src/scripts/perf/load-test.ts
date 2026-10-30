import { performance } from "node:perf_hooks";
import { addUser, call, MAILPIT_URL, PNG_1X1, seedProducts, startStack, type Stack } from "./harness.js";
import { emailLagViolations, summarize, violations, type Sample } from "../load-test/stats.js";

// N18: 50 pengguna bersamaan (47 pembeli dan 3 admin) memakai campuran aksi biasa; p95 tiap aksi ≤ 500 ms.
// N20: lama dari pesanan dibuat sampai email "pesanan dibuat" masuk ke Mailpit; p95 ≤ 5 menit.
const BUYERS = 47;
const ADMINS = 3;
const DURATION_MS = Number(process.env.LOAD_DURATION_S ?? 30) * 1000;
const ADDRESS = { recipient: "Budi Santoso", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const samples: Sample[] = [];
async function timed(action: string, cookie: string, method: string, path: string, body?: unknown, expect = [200, 201, 204]) {
  const t0 = performance.now();
  let status = 0;
  let json: () => any = () => null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { ({ status, json } = await call(cookie, method, path, body)); } catch { /* galat jaringan = status 0 */ }
  samples.push({ action, ms: Math.round(performance.now() - t0), ok: expect.includes(status) });
  return { status, json };
}

async function main() {
  const stack: Stack = await startStack();
  try {
    const admin = await addUser(stack, "admin", "admin-beban@hayatun.test", ADMINS);
    const products = await seedProducts(admin.cookies[0], ["Beban A", "Beban B", "Beban C", "Beban D", "Beban E"]);

    // Persiapan (tidak diukur): tiap pembeli punya alamat dan satu pesanan dengan bukti menunggu verifikasi
    const createdAt = new Map<string, number>();
    const pending: string[] = [];
    const buyers = await Promise.all(Array.from({ length: BUYERS }, async (_, i) => {
      const email = `beban-${i}@hayatun.test`;
      const u = await addUser(stack, "buyer", email);
      const cookie = u.cookies[0];
      const addr = (await call(cookie, "POST", "/api/addresses", ADDRESS)).json();
      await call(cookie, "POST", "/api/cart/items", { productId: products[0].id });
      const order = await call(cookie, "POST", "/api/checkout", { expectedTotal: 75000 });
      if (order.status !== 201) throw new Error(`Persiapan gagal: checkout ${order.status}`);
      createdAt.set(email, Date.now());
      const orderId = order.json().orderId as string;
      const proof = await call(cookie, "POST", `/api/orders/${orderId}/proof`, PNG_1X1, "image/png");
      if (proof.status !== 201) throw new Error(`Persiapan gagal: bukti ${proof.status}`);
      pending.push(orderId);
      return { cookie, addressId: addr.id as string };
    }));

    const end = Date.now() + DURATION_MS;
    const buyer = async ({ cookie, addressId }: (typeof buyers)[number]) => {
      while (Date.now() < end) {
        const p = pick(products);
        const act = pick(["katalog", "katalog", "detail", "detail", "keranjang", "pesanan", "pesanan", "tambah", "alamat"]);
        if (act === "katalog") await timed("katalog", cookie, "GET", "/api/catalog");
        else if (act === "detail") await timed("detail produk", cookie, "GET", `/api/catalog/${p.slug}`);
        else if (act === "keranjang") await timed("keranjang", cookie, "GET", "/api/cart");
        else if (act === "pesanan") await timed("daftar pesanan", cookie, "GET", "/api/orders");
        else if (act === "alamat") await timed("simpan alamat", cookie, "PATCH", `/api/addresses/${addressId}`, { recipient: `Budi ${Math.floor(Math.random() * 1000)}` });
        else { // tambah lalu hapus, supaya keranjang tidak menumpuk
          await timed("tambah keranjang", cookie, "POST", "/api/cart/items", { productId: p.id });
          await timed("hapus dari keranjang", cookie, "DELETE", `/api/cart/items/${p.id}`);
        }
        await sleep(100 + Math.random() * 300); // jeda berpikir
      }
    };
    const adminLoop = async (cookie: string) => {
      while (Date.now() < end) {
        const act = pick(["antrean", "pesanan", "terima"]);
        if (act === "antrean") await timed("antrean verifikasi", cookie, "GET", "/api/admin/payments");
        else if (act === "pesanan") await timed("daftar pesanan admin", cookie, "GET", "/api/admin/orders");
        else { const id = pending.pop(); if (id) await timed("terima bukti", cookie, "POST", `/api/admin/payments/${id}/accept`); }
        await sleep(100 + Math.random() * 300);
      }
    };
    await Promise.all([...buyers.map(buyer), ...admin.cookies.map(adminLoop)]);

    const result = summarize(samples);
    console.log(["aksi".padEnd(24), "n".padStart(6), "gagal".padStart(6), "p50".padStart(6), "p95".padStart(6), "maks".padStart(6)].join(" "));
    for (const a of [...result.actions, result.overall]) console.log([a.action.padEnd(24), String(a.count).padStart(6), String(a.errors).padStart(6), String(a.p50).padStart(6), String(a.p95).padStart(6), String(a.max).padStart(6)].join(" "));
    const problems = violations(result);

    // N20: tunggu email pesanan dibuat (sampai 60 detik setelah beban selesai)
    const lags: number[] = [];
    let mailpit = true;
    for (let t = 0; t < 60 && lags.length < BUYERS; t++) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1000`).catch(() => null);
      if (!res?.ok) { mailpit = false; break; }
      const msgs = ((await res.json()) as { messages: { Created: string; Subject: string; To: { Address: string }[] }[] }).messages;
      lags.length = 0;
      for (const [email, at] of createdAt) {
        const m = msgs.find((x) => x.Subject === "Pesananmu sudah dibuat, tinggal bayar" && x.To.some((y) => y.Address === email));
        if (m) lags.push(Math.max(0, new Date(m.Created).getTime() - at));
      }
      if (lags.length < BUYERS) await sleep(1000);
    }
    if (mailpit) problems.push(...emailLagViolations(lags, BUYERS));
    else console.warn("PERINGATAN: Mailpit tidak bisa dihubungi; N20 (jeda email) tidak diukur.");
    if (mailpit) console.log(`email pesanan dibuat: ${lags.length}/${BUYERS} tiba, jeda maks ${Math.max(0, ...lags)} ms`);

    if (problems.length) { console.error(`\nANGGARAN TERLAMPAUI:\n- ${problems.join("\n- ")}`); process.exitCode = 1; }
    else console.log("\nSemua anggaran terpenuhi.");
  } finally {
    await stack.stop();
  }
}
await main();
process.exit(process.exitCode ?? 0);
