import { expect, test, type BrowserContext } from "@playwright/test";
import { adminCookie, buyerCookie, resetProducts, seedProduct, userApi } from "./helpers";
import { discover, PAGES } from "./pages";

let anon: BrowserContext;
let buyerA: BrowserContext;
let buyerB: BrowserContext;
let admin: BrowserContext;
let orderId: string;
let invoiceNumber: string;
test.beforeAll(async ({ browser }) => {
  await resetProducts();
  const adminC = await adminCookie();
  const a = await buyerCookie();
  const b = await buyerCookie();
  const mk = async (...cookies: Awaited<ReturnType<typeof buyerCookie>>[]) => { const c = await browser.newContext({ baseURL: "http://127.0.0.1:3000" }); await c.addCookies(cookies); return c; };
  anon = await mk(); buyerA = await mk(a); buyerB = await mk(b); admin = await mk(adminC);
  const p = await seedProduct(adminC, { name: "E-book Rahasia Pemilik", price: 75000 });
  await userApi(a, "POST", "/api/cart/items", { productId: p.id });
  orderId = (await userApi(a, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
  invoiceNumber = (await userApi(a, "GET", `/api/invoices/${orderId}`)).number as string;
});
test.afterAll(async () => { for (const c of [anon, buyerA, buyerB, admin]) await c.close(); });

const fill = (path: string) => path.startsWith("/pesanan/") ? path.replace("[id]", orderId) : path.replace("[slug]", "tidak-ada").replace("[id]", "00000000-0000-4000-8000-000000000001").replace("[orderId]", orderId);
async function open(ctx: BrowserContext, path: string) {
  const page = await ctx.newPage();
  const res = await page.goto(fill(path), { waitUntil: "domcontentloaded" });
  const out = { status: res!.status(), path: new URL(page.url()).pathname, text: await page.locator("body").innerText() };
  await page.close();
  return out;
}

test("tabel halaman lengkap: setiap page.tsx ada di tabel dan sebaliknya", () => {
  expect(discover().sort()).toEqual(Object.keys(PAGES).sort());
});

for (const [path, who] of Object.entries(PAGES)) {
  test(`${path} (${who})`, async () => {
    if (who === "public") {
      for (const c of [anon, buyerA, admin]) {
        const r = await open(c, path);
        expect(r.status, `${path} status`).toBeLessThan(500);
        if (!path.startsWith("/masuk") && path !== "/daftar") expect(r.path, "tamu tidak dilempar ke /masuk").not.toBe("/masuk");
      }
      return;
    }
    // tanpa login selalu ke halaman masuk
    expect((await open(anon, path)).path, "tamu").toBe("/masuk");

    if (who === "admin") {
      expect((await open(buyerA, path)).path, "pembeli").toBe("/masuk");
      const r = await open(admin, path);
      expect(r.path, "admin").not.toBe("/masuk");
      expect(r.status).toBeLessThan(500);
    } else if (who === "buyer") {
      expect((await open(admin, path)).path, "admin").toBe("/masuk");
      expect((await open(buyerA, path)).path, "pembeli").not.toBe("/masuk");
    } else if (who === "user") {
      for (const c of [buyerA, admin]) expect((await open(c, path)).path).not.toBe("/masuk");
    } else {
      // satu pesanan milik pembeli A
      const other = await open(buyerB, path);
      expect(other.status, "pembeli lain").toBe(404);
      for (const secret of [invoiceNumber, orderId, "E-book Rahasia Pemilik"]) expect(other.text, secret).not.toContain(secret);
      const owner = await open(buyerA, path);
      expect(owner.status, "pemilik").toBe(200);
      expect(owner.text).toContain(invoiceNumber);
      const adm = await open(admin, path);
      if (who === "order-invoice") { expect(adm.status, "admin membuka invoice").toBe(200); expect(adm.text).toContain(invoiceNumber); }
      else expect(adm.status, "admin tidak memakai halaman pesanan pembeli").toBe(404);
    }
  });
}
