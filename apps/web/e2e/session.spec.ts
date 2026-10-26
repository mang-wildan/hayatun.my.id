import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env";

test("sesi habis: /admin mengarah ke halaman masuk dengan pesan jelas", async ({ page, context }) => {
  await context.addCookies([{ name: "hayatun_sid", value: "kedaluwarsa", url: WEB_URL }]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/masuk\?pesan=sesi-habis/);
  await expect(page.getByText("Sesimu sudah habis, silakan masuk lagi ya.")).toBeVisible();
});

test("belum pernah masuk: /admin mengarah ke halaman masuk tanpa pesan sesi habis", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/masuk/);
  await expect(page).not.toHaveURL(/pesan=sesi-habis/);
  await expect(page.getByText("Sesimu sudah habis")).toHaveCount(0);
});

test("pembeli yang sudah masuk tidak bisa membuka /admin", async ({ page }) => {
  const credentials = { email: "budi-sesi@hayatun.test", password: "rahasia-hayatun-1" };
  await page.request.post("/api/auth/register", { data: { name: "Budi", ...credentials } });
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200); // cookie tersimpan di konteks
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/masuk/);
});
