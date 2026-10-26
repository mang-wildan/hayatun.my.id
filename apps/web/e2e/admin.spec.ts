import { expect, test } from "@playwright/test";
import { latestEmailTo, linkFrom, resetAdmins, runBootstrap, totpNow } from "./helpers";

const OWNER = "pemilik@hayatun.test";
const PW = "admin-hayatun-2026";

// tes ini berurutan (tes kedua memakai undangan tes pertama), dan tidak boleh terpengaruh admin dari tes lain
test.describe.configure({ mode: "serial" });
test.beforeAll(resetAdmins);

test("undangan admin: buat password, pasang TOTP, masuk panel, keluar, lalu masuk dengan kode", async ({ page }) => {
  runBootstrap(OWNER);
  await page.goto(linkFrom((await latestEmailTo(OWNER, "Undangan jadi admin Hayatun")).text));
  await page.getByLabel("Nama").fill("Pemilik");
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Simpan dan lanjut" }).click();

  await expect(page).toHaveURL(/\/masuk\/atur-kode/);
  expect(page.url()).not.toMatch(/challenge/);
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Kode 6 angka").fill(totpNow(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation", { name: "Menu admin" })).toBeVisible();

  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/); // keluar selesai
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/masuk\/kode/);
  await page.getByLabel("Kode 6 angka").fill(totpNow(secret, 30));
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("undangan yang sudah dipakai ditolak dengan pesan jelas", async ({ page }) => {
  const link = linkFrom((await latestEmailTo(OWNER, "Undangan jadi admin Hayatun")).text);
  await page.goto(link);
  await page.getByLabel("Nama").fill("Pemilik");
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Simpan dan lanjut" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Undangannya sudah dipakai. Silakan masuk." })).toBeVisible();
});
