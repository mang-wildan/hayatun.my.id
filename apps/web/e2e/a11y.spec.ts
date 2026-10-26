import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adminCookie } from "./helpers";

// Halaman 404 tidak punya pelanggaran WCAG, jadi pastikan halamannya benar-benar ada sebelum diperiksa.
async function open(page: import("@playwright/test").Page, path: string) {
  expect((await page.goto(path))!.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Hayatun" })).toBeVisible();
}

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

for (const width of WIDTHS) {
  for (const path of ["/", "/masuk"]) {
    test(`${path} @${width}px: lolos WCAG 2.1 AA dan tanpa gulir ke samping`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, path);
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}

test("beranda langsung menyebut toko dan isinya, tanpa banner penghalang (DESIGN §6)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Hayatun" })).toBeVisible();
  await expect(page.getByText("E-book, template, aplikasi, dan produk pilihan dari Hayatun.")).toBeVisible();
  await expect(page.getByText("Produk Hayatun sedang disiapkan. Mampir lagi sebentar lagi ya.")).toBeInViewport();
  await expect(page.getByRole("link", { name: /menu|hamburger/i })).toHaveCount(0);
});

test("seluruh halaman memakai huruf Outfit dan latar blush pucat (DESIGN §2–§3)", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Outfit");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(253, 242, 248)"); // #FDF2F8
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
});

test("area sentuh minimal 44px di HP", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, "/masuk");
  const targets = await page.locator("button, input, header a, nav a").all();
  expect(targets.length).toBeGreaterThan(0);
  for (const el of targets) {
    const box = (await el.boundingBox())!;
    expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
  }
});

test("gerakan: transisi singkat, dan mati bila perangkat memilih kurangi gerakan (N16)", async ({ browser }) => {
  const durationMs = (page: import("@playwright/test").Page) =>
    page.getByRole("link", { name: "Hayatun" }).evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration) * 1000);

  const a = await browser.newPage({ reducedMotion: "no-preference" });
  await a.goto("/");
  const d = await durationMs(a);
  expect(d).toBeGreaterThan(0);
  expect(d).toBeLessThanOrEqual(250);

  const b = await browser.newPage({ reducedMotion: "reduce" });
  await b.goto("/");
  expect(await durationMs(b)).toBeLessThanOrEqual(1);
});

test.describe("kerangka admin (DESIGN §6)", () => {
  test.beforeEach(async ({ context }) => { await context.addCookies([await adminCookie()]); });

  test("HP: navigasi bawah berlabel; menu samping tersembunyi", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menu admin" });
    await expect(nav).toBeVisible();
    for (const label of ["Verifikasi", "Pesanan", "Produk", "Lainnya"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    expect((await nav.boundingBox())!.y).toBeGreaterThan(600); // di bagian bawah layar
  });

  test("PC: menu samping 240px tetap terlihat di kiri", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menu admin" });
    const box = (await nav.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual(240);
    expect(box.width).toBeLessThan(300);
  });

  for (const width of WIDTHS) {
    test(`/admin @${width}px: lolos WCAG 2.1 AA dan tanpa gulir ke samping`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/admin");
      await expect(page.getByRole("navigation", { name: "Menu admin" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
