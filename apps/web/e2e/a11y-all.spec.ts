import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ADDRESS, adminCookie, buyerCookie, resetProducts, seedProduct, userApi } from "./helpers";
import { discover, PAGES } from "./pages";

// N11–N16 untuk semua halaman: setiap halaman di PAGES dibuka di 360, 768, dan 1280 px oleh peran yang boleh membukanya.
const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BASE = "http://127.0.0.1:3000";

let anon: BrowserContext;
let admin: BrowserContext;
let owner: BrowserContext; // pemilik pesanan; keranjang digital
let shopper: BrowserContext; // keranjang fisik dengan alamat tersimpan
let ids: { slug: string; productId: string; orderId: string };

test.beforeAll(async ({ browser }) => {
  await resetProducts();
  const adminC = await adminCookie();
  const a = await buyerCookie();
  const s = await buyerCookie();
  const mk = async (...cookies: Awaited<ReturnType<typeof buyerCookie>>[]) => { const c = await browser.newContext({ baseURL: BASE }); await c.addCookies(cookies); return c; };
  anon = await mk(); admin = await mk(adminC); owner = await mk(a); shopper = await mk(s);
  const book = await seedProduct(adminC, { name: "E-book Sapuan A11y", price: 75000, cover: true });
  const cake = await seedProduct(adminC, { name: "Nastar Sapuan A11y", type: "physical", price: 120000, stockQty: 10, cover: true });
  await userApi(a, "POST", "/api/cart/items", { productId: book.id });
  const orderId = (await userApi(a, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
  await userApi(a, "POST", "/api/cart/items", { productId: book.id }); // keranjang tetap terisi untuk /checkout/bayar
  await userApi(s, "POST", "/api/cart/items", { productId: cake.id });
  await userApi(s, "POST", "/api/addresses", ADDRESS);
  ids = { slug: book.slug, productId: book.id, orderId };
});
test.afterAll(async () => { for (const c of [anon, admin, owner, shopper]) await c.close(); });

// peran yang dipakai untuk membuka tiap halaman, dan jalur akhir yang harus tampil (tanpa redirect yang tak disengaja)
function plan(path: string): { ctx: BrowserContext; url: string } {
  const url = path.replace("[slug]", ids.slug).replace("[orderId]", ids.orderId).replace("/pesanan/[id]", `/pesanan/${ids.orderId}`).replace("[id]", ids.productId);
  const who = PAGES[path];
  if (path === "/checkout/pengiriman") return { ctx: shopper, url };
  if (who === "admin") return { ctx: admin, url };
  if (who === "public") return { ctx: anon, url };
  return { ctx: owner, url };
}

async function openPage(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
  const { url } = plan(path);
  const res = await page.goto(url, { waitUntil: "networkidle" });
  expect(res!.status(), `${path} status`).toBe(200);
  expect(new URL(page.url()).pathname, `${path} tidak boleh dialihkan`).toBe(new URL(url, BASE).pathname);
}

test("tabel halaman lengkap: setiap page.tsx ada di tabel", () => {
  expect(discover().sort()).toEqual(Object.keys(PAGES).sort());
});

for (const path of Object.keys(PAGES)) {
  for (const width of WIDTHS) {
    test(`${path} @${width}px: WCAG 2.1 AA, tanpa gulir ke samping, label terlihat, gambar beralt`, async () => {
      const page = await plan(path).ctx.newPage();
      try {
        await openPage(page, path, width);
        await expect(page.locator("main, [role=main]").first()).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations, "axe").toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), "gulir mendatar (N11)").toBeLessThanOrEqual(width);

        // N15: setiap kolom isian punya label yang terlihat (bukan hanya aria-label)
        const unlabeled = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea")]
          .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden" && !(e as HTMLInputElement).closest("[hidden]"))
          .filter((e) => {
            const labels = [...((e as HTMLInputElement).labels ?? [])];
            return !labels.some((l) => { const r = l.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (l.textContent ?? "").trim().length > 0; });
          }).map((e) => e.outerHTML.slice(0, 90)));
        expect(unlabeled, "kolom tanpa label yang terlihat (N15)").toEqual([]);

        // N16: semua gambar punya atribut alt
        expect(await page.evaluate(() => [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => i.outerHTML.slice(0, 90))), "gambar tanpa alt (N16)").toEqual([]);
      } finally { await page.close(); }
    });
  }

  test(`${path} @360px: teks isi minimal 16px dan area sentuh minimal 44px (N13)`, async () => {
    const page = await plan(path).ctx.newPage();
    try {
      await openPage(page, path, 360);
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main p, main li, main label, main td, main dd, main dt")]
        .filter((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden], .meta, .hint, .badge, .count, .sr-only, dialog:not([open])"))
        .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim()))
        .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${getComputedStyle(e).fontSize} ${e.outerHTML.slice(0, 80)}`));
      expect(small, "teks isi di bawah 16px").toEqual([]);

      const tiny = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
        "button, select, textarea, input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=file]), .btn, header a, nav a, footer a")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest("dialog:not([open]), [hidden]"); })
        .filter((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 43.5; })
        .map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${e.outerHTML.slice(0, 80)}`; }));
      expect(tiny, "area sentuh di bawah 44px").toEqual([]);
    } finally { await page.close(); }
  });
}

test.describe("kurangi gerakan (N16)", () => {
  for (const path of ["/", "/masuk", "/keranjang", "/admin"]) {
    test(`${path}: transisi dan animasi mati bila perangkat memilih kurangi gerakan`, async ({ browser }) => {
      const ctx = await browser.newContext({ baseURL: BASE, reducedMotion: "reduce" });
      await ctx.addCookies(PAGES[path] === "admin" ? await admin.cookies() : PAGES[path] === "user" ? await owner.cookies() : []);
      const page = await ctx.newPage();
      await page.goto(path);
      const moving = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body, body *")].filter((e) => {
        const s = getComputedStyle(e);
        const t = Math.max(...s.transitionDuration.split(",").map(parseFloat));
        const a = Math.max(...s.animationDuration.split(",").map(parseFloat));
        return t > 0.001 || (a > 0.001 && s.animationName !== "none"); // CSS memakai 0.01ms; di bawah 1ms dianggap mati
      }).map((e) => e.tagName + "." + e.className).slice(0, 5));
      expect(moving).toEqual([]);
      await ctx.close();
    });
  }
});
