import { expect, test } from "@playwright/test";
import { createVerifiedBuyer, latestEmailTo, linkFrom, totpNow } from "./helpers";

const PW = "rahasia-hayatun-1";
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@hayatun.test`;

test("daftar, verifikasi, masuk (email huruf besar), lalu keluar", async ({ page }) => {
  const email = uniq("budi");
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Daftar" }).click();
  await expect(page.getByText("Cek emailmu ya. Kami kirim tautan untuk verifikasi akun.")).toBeVisible();

  await page.goto(linkFrom((await latestEmailTo(email, "Verifikasi email akun Hayatun-mu")).text));
  await expect(page.getByText("Emailmu sudah terverifikasi. Selamat belanja!")).toBeVisible();

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("link", { name: "Akun" })).toBeVisible();

  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page.getByRole("link", { name: "Masuk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Akun" })).toHaveCount(0);
});

test("error tampil tepat di bawah kolomnya dan dibacakan pembaca layar", async ({ page }) => {
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  await page.getByLabel("Email").fill(uniq("x"));
  await page.getByLabel("Password").fill("1234567");
  await page.getByRole("button", { name: "Daftar" }).click();
  const field = page.getByLabel("Password");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Password minimal 8 karakter ya.")).toBeVisible();
  await expect(field).toHaveAccessibleDescription(/Password minimal 8 karakter ya\./);
  await expect(page.getByLabel("Nama")).not.toHaveAttribute("aria-invalid", "true");
});

test("password salah: pesan jelas, kolom tetap terisi", async ({ page }) => {
  const email = uniq("salah");
  await createVerifiedBuyer(email, PW);
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("salah-salah-1");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email atau password-nya belum cocok." })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(email);
});

test("lupa password sampai bisa masuk dengan password baru", async ({ page }) => {
  const email = uniq("lupa");
  await createVerifiedBuyer(email, PW);
  await page.goto("/lupa-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Kirim tautan" }).click();
  await expect(page.getByText("Kalau emailnya terdaftar, kami sudah kirim tautan untuk atur ulang password.")).toBeVisible();

  await page.goto(linkFrom((await latestEmailTo(email, "Atur ulang password Hayatun-mu")).text));
  await page.getByLabel("Password baru").fill("baru-sekali-2026");
  await page.getByRole("button", { name: "Ganti password" }).click();
  await expect(page.getByText("Password-mu sudah diganti. Silakan masuk lagi ya.")).toBeVisible();

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("baru-sekali-2026");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("link", { name: "Akun" })).toBeVisible();
});

test("tautan reset yang sudah dipakai ditolak dengan pesan jelas", async ({ page }) => {
  const email = uniq("pakai");
  await createVerifiedBuyer(email, PW);
  await page.request.post("/api/auth/forgot-password", { data: { email } });
  const link = linkFrom((await latestEmailTo(email, "Atur ulang password Hayatun-mu")).text);
  await page.goto(link);
  await page.getByLabel("Password baru").fill("baru-sekali-2026");
  await page.getByRole("button", { name: "Ganti password" }).click();
  await expect(page.getByText("Password-mu sudah diganti")).toBeVisible();
  await page.goto(link);
  await page.getByLabel("Password baru").fill("lain-lagi-2026");
  await page.getByRole("button", { name: "Ganti password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Tautannya sudah dipakai" })).toBeVisible();
});

test("tombol tidak bisa ditekan dua kali saat memproses", async ({ page }) => {
  await page.route("**/api/auth/register", async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/auth/register")) posts += 1; });
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  await page.getByLabel("Email").fill(uniq("ganda"));
  await page.getByLabel("Password").fill(PW);
  const button = page.getByRole("button", { name: "Daftar" });
  await button.click();
  await expect(page.getByRole("button", { name: "Mendaftarkan…" })).toBeDisabled();
  await page.getByRole("button", { name: "Mendaftarkan…" }).click({ force: true }).catch(() => {});
  await expect(page.getByText("Cek emailmu ya.")).toBeVisible();
  expect(posts).toBe(1);
});

test("verifikasi dua langkah pembeli: aktifkan, keluar, lalu masuk dengan kode", async ({ page }) => {
  const email = uniq("totp");
  await createVerifiedBuyer(email, PW);
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.getByRole("link", { name: "Akun" }).click();
  await expect(page).toHaveURL(/\/akun\/keamanan/);

  await page.getByRole("button", { name: "Aktifkan verifikasi dua langkah" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Kode 6 angka").fill(totpNow(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await expect(page.getByText("Verifikasi dua langkah sudah aktif.")).toBeVisible();

  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page.getByRole("link", { name: "Masuk" })).toBeVisible(); // keluar selesai
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/masuk\/kode/);
  expect(page.url()).not.toMatch(/challenge/); // challenge tidak boleh ada di URL
  await page.getByLabel("Kode 6 angka").fill("000000");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Kodenya belum cocok. Coba kode terbaru di aplikasi authenticator-mu." })).toBeVisible();
  await page.getByLabel("Kode 6 angka").fill(totpNow(secret, 30)); // kode yang sama dengan saat mengaktifkan tidak boleh dipakai lagi
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("link", { name: "Akun" })).toBeVisible();
});
