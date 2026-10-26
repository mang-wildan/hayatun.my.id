import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/daftar", "/masuk", "/lupa-password", "/akun/keamanan", "/verifikasi-email", "/reset-password"];

for (const width of [360, 768, 1280]) {
  for (const path of PAGES.filter((p) => p !== "/akun/keamanan")) {
    test(`${path} @${width}px: halaman ada, lolos WCAG 2.1 AA, tanpa gulir ke samping`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      expect((await page.goto(path))!.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}

test("formulir daftar: area sentuh ≥ 44px, label terlihat, satu tombol utama", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/daftar");
  const targets = await page.locator("main button, main input").all();
  expect(targets.length).toBeGreaterThanOrEqual(4);
  for (const el of targets) expect(Math.min(...Object.values((await el.boundingBox())!).slice(2))).toBeGreaterThanOrEqual(44);
  for (const label of ["Nama", "Email", "Password"]) await expect(page.getByLabel(label)).toBeVisible();
  await expect(page.locator("main button.primary, main button[data-variant='primary']")).toHaveCount(1);
});

test("alur masuk bisa diselesaikan hanya dengan keyboard (N14) dan fokus selalu terlihat", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByLabel("Email").focus();
  const ring = await page.getByLabel("Email").evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(ring).not.toBe("none");
  await page.keyboard.type("budi@hayatun.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type("salah-salah-1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("/akun/keamanan tanpa sesi mengarah ke halaman masuk", async ({ page }) => {
  await page.goto("/akun/keamanan");
  await expect(page).toHaveURL(/\/masuk/);
});
