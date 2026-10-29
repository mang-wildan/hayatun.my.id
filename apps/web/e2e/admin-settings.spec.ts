import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, buyerCookie, latestEmailTo, resetProducts, seedProduct, setSetting, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const NOT_SET = "Rekening belum diatur. Pembeli belum bisa melihat tujuan transfer.";

const ADMIN_EMAIL = `pengaturan-${Date.now()}@hayatun.test`;
let admin: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie(ADMIN_EMAIL);
});
// pengaturan toko dipakai spec lain (invoice, legal): kembalikan ke bawaan
test.afterAll(async () => { await setSetting("store", null); await setSetting("bankAccount", null); });
test.beforeEach(async ({ context }) => {
  await context.addCookies([admin]);
  await setSetting("store", { name: "Toko Awal", email: "awal@tokouji.id", phone: "+6281200000001" });
  await setSetting("bankAccount", BANK);
});

const storeForm = (page: Page) => page.getByRole("form", { name: "Informasi toko" });
const bankForm = (page: Page) => page.getByRole("form", { name: "Rekening tujuan transfer" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Ubah rekening tujuan transfer?" });
const saved = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const fillBank = async (page: Page, v: { bank: string; number: string; holder: string }) => {
  await bankForm(page).getByLabel("Bank").fill(v.bank);
  await bankForm(page).getByLabel("Nomor rekening").fill(v.number);
  await bankForm(page).getByLabel("Atas nama").fill(v.holder);
};

test.describe("halaman pengaturan toko (F13.3, N32)", () => {
  test("menu Lainnya membuka Pengaturan toko", async ({ page }) => {
    await page.goto("/admin/lainnya");
    await page.getByRole("link", { name: "Pengaturan toko" }).click();
    await expect(page).toHaveURL(/\/admin\/pengaturan$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pengaturan toko" })).toBeVisible();
  });

  test("terisi dengan nilai yang sekarang berlaku", async ({ page }) => {
    await page.goto("/admin/pengaturan");
    await expect(storeForm(page).getByLabel("Nama toko")).toHaveValue("Toko Awal");
    await expect(storeForm(page).getByLabel("Email kontak")).toHaveValue("awal@tokouji.id");
    await expect(storeForm(page).getByLabel("Telepon")).toHaveValue("+6281200000001");
    await expect(bankForm(page).getByLabel("Bank")).toHaveValue("BCA");
    await expect(bankForm(page).getByLabel("Nomor rekening")).toHaveValue("1234567890");
    await expect(bankForm(page).getByLabel("Atas nama")).toHaveValue("Hayatun Toko");
    await expect(page.getByText(NOT_SET)).toHaveCount(0);
  });

  test("rekening belum diatur: pemberitahuan tampil dan hilang setelah disimpan", async ({ page }) => {
    await setSetting("bankAccount", null);
    await page.goto("/admin/pengaturan");
    await expect(page.getByText(NOT_SET)).toBeVisible();
    await fillBank(page, BANK);
    await bankForm(page).getByRole("button", { name: "Simpan rekening" }).click();
    await dialog(page).getByRole("button", { name: "Ya, simpan rekening" }).click();
    await expect(saved(page, "Rekening tersimpan")).toBeVisible();
    await page.reload();
    await expect(page.getByText(NOT_SET)).toHaveCount(0);
  });

  test("pembeli yang bukan admin diarahkan ke halaman masuk", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([await buyerCookie()]);
    const page = await ctx.newPage();
    await page.goto("/admin/pengaturan");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });
});

test.describe("informasi toko", () => {
  test("disimpan, bertahan setelah dimuat ulang, dan langsung tampil di halaman legal; Enter menyimpan", async ({ page }) => {
    await page.goto("/admin/pengaturan");
    await storeForm(page).getByLabel("Nama toko").fill("Toko Baru");
    await storeForm(page).getByLabel("Email kontak").fill("baru@tokouji.id");
    await storeForm(page).getByLabel("Telepon").fill("0812-9999-0000");
    await storeForm(page).getByLabel("Telepon").press("Enter");
    await expect(saved(page, "Informasi toko tersimpan")).toBeVisible();
    await page.reload();
    await expect(storeForm(page).getByLabel("Nama toko")).toHaveValue("Toko Baru");
    await expect(storeForm(page).getByLabel("Telepon")).toHaveValue("+6281299990000");
    await page.goto("/kebijakan-privasi");
    await expect(page.getByRole("region", { name: "Kontak" })).toContainText("Toko Baru");
    await expect(page.getByRole("region", { name: "Kontak" }).getByRole("link", { name: "baru@tokouji.id" })).toBeVisible();
  });

  test("kolom salah: pesan di bawah kolomnya, tidak ada pesan tersimpan", async ({ page }) => {
    await page.goto("/admin/pengaturan");
    await storeForm(page).getByLabel("Nama toko").fill("");
    await storeForm(page).getByLabel("Email kontak").fill("bukan-email");
    await storeForm(page).getByLabel("Telepon").fill("123");
    await storeForm(page).getByRole("button", { name: "Simpan informasi" }).click();
    await expect(storeForm(page).getByText("Nama toko diisi dulu ya.")).toBeVisible();
    await expect(storeForm(page).getByLabel("Nama toko")).toHaveAttribute("aria-invalid", "true");
    await expect(storeForm(page).getByText("Format email belum benar.")).toBeVisible();
    await expect(storeForm(page).getByText("Format nomor HP belum benar. Contoh: 081234567890.")).toBeVisible();
    await expect(saved(page, "tersimpan")).toHaveCount(0);
  });
});

test.describe("rekening tujuan transfer (F15.7)", () => {
  test("konfirmasi dulu: Batal tidak mengubah apa pun", async ({ page }) => {
    await page.goto("/admin/pengaturan");
    await fillBank(page, { bank: "Mandiri", number: "9876543210", holder: "Hayatun Jaya" });
    await bankForm(page).getByRole("button", { name: "Simpan rekening" }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("semua admin");
    await dialog(page).getByRole("button", { name: "Batal", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(saved(page, "Rekening tersimpan")).toHaveCount(0);
    await page.reload();
    await expect(bankForm(page).getByLabel("Bank")).toHaveValue("BCA");
  });

  test("diubah: tersimpan, pembeli melihat rekening baru di halaman bayar, dan admin menerima email", async ({ page }) => {
    const buyer = await buyerCookie();
    const p = await seedProduct(admin, { name: `E-book Rekening ${Date.now()}`, price: 75000 });
    await userApi(buyer, "POST", "/api/cart/items", { productId: p.id });
    const orderId = (await userApi(buyer, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;

    await page.goto("/admin/pengaturan");
    await fillBank(page, { bank: "Mandiri", number: "9876 5432 10", holder: "Hayatun Jaya" });
    await bankForm(page).getByRole("button", { name: "Simpan rekening" }).click();
    await dialog(page).getByRole("button", { name: "Ya, simpan rekening" }).click();
    await expect(saved(page, "Rekening tersimpan")).toBeVisible();
    await expect(bankForm(page).getByLabel("Nomor rekening")).toHaveValue("9876543210");

    const mail = await latestEmailTo(ADMIN_EMAIL, "Rekening tujuan transfer diubah", "Hayatun Jaya");
    for (const t of ["BCA", "1234567890", "Mandiri", "9876543210", "Hayatun Jaya"]) expect(mail.text).toContain(t);

    const ctx = await page.context().browser()!.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([buyer]);
    const buyerPage = await ctx.newPage();
    await buyerPage.goto(`/pesanan/${orderId}`);
    await expect(buyerPage.getByTestId("nomor-rekening")).toHaveText("9876543210");
    await ctx.close();
  });

  test("kolom salah ditolak di bawah kolomnya setelah konfirmasi; rekening lama tetap", async ({ page }) => {
    await page.goto("/admin/pengaturan");
    await fillBank(page, { bank: "", number: "12ab", holder: "H" });
    await bankForm(page).getByRole("button", { name: "Simpan rekening" }).click();
    await dialog(page).getByRole("button", { name: "Ya, simpan rekening" }).click();
    await expect(bankForm(page).getByText("Nama bank diisi dulu ya.")).toBeVisible();
    await expect(bankForm(page).getByText("Nomor rekening hanya boleh berisi angka.")).toBeVisible();
    await expect(bankForm(page).getByText("Atas nama terlalu pendek.")).toBeVisible();
    await expect(bankForm(page).getByLabel("Nomor rekening")).toHaveAttribute("aria-invalid", "true");
    await expect(saved(page, "Rekening tersimpan")).toHaveCount(0);
    await page.reload();
    await expect(bankForm(page).getByLabel("Bank")).toHaveValue("BCA");
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: halaman, pemberitahuan belum diatur, kesalahan, dan dialog`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin/pengaturan"); await scan();
      await setSetting("bankAccount", null);
      await page.goto("/admin/pengaturan");
      await expect(page.getByText(NOT_SET)).toBeVisible(); await scan();
      await storeForm(page).getByLabel("Nama toko").fill("");
      await storeForm(page).getByRole("button", { name: "Simpan informasi" }).click();
      await expect(storeForm(page).getByText("Nama toko diisi dulu ya.")).toBeVisible(); await scan();
      await fillBank(page, BANK);
      await bankForm(page).getByRole("button", { name: "Simpan rekening" }).click();
      await expect(dialog(page)).toBeVisible(); await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; kolom dan tombol minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/admin/pengaturan");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [storeForm(page).getByLabel("Nama toko"), bankForm(page).getByLabel("Nomor rekening"), storeForm(page).getByRole("button", { name: "Simpan informasi" }), bankForm(page).getByRole("button", { name: "Simpan rekening" })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

