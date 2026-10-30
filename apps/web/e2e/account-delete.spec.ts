import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, passwordBuyer, resetProducts, seedProduct, setSetting, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const PASSWORD = "rahasia-hayatun-1";

let admin: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async () => { await setSetting("bankAccount", { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" }); });

async function signedIn(page: Page) {
  const b = await passwordBuyer();
  await page.context().addCookies([b.cookie]);
  return b;
}
async function waitingOrder(who: { value: string; name: string }) {
  const p = await seedProduct(admin, { name: `E-book Hapus ${Math.random().toString(36).slice(2, 7)}`, price: 75000 });
  await userApi(who, "POST", "/api/cart/items", { productId: p.id });
  const id = (await userApi(who, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
  return { id, invoiceNumber: (await userApi(who, "GET", `/api/orders/${id}/payment`)).invoiceNumber as string };
}
const form = (page: Page) => page.getByRole("form", { name: "Hapus akun" });
const submit = async (page: Page, password = PASSWORD) => {
  await form(page).getByLabel("Password").fill(password);
  await form(page).getByRole("button", { name: "Hapus akun" }).click();
};
const confirm = (page: Page) => page.getByRole("dialog", { name: "Hapus akunmu?" });

test.describe("halaman hapus akun (F1.5, F12.2)", () => {
  test("menjelaskan apa yang dihapus dan apa yang disimpan 10 tahun; tautan dari halaman keamanan", async ({ page }) => {
    await signedIn(page);
    await page.goto("/akun/keamanan");
    await page.getByRole("link", { name: "Hapus akun" }).click();
    await expect(page).toHaveURL(/\/akun\/hapus$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hapus akun" })).toBeVisible();
    const main = page.locator("main");
    await expect(main).toContainText("Yang dihapus");
    await expect(main).toContainText("nama, email, nomor HP, alamat");
    await expect(main).toContainText("Yang disimpan 10 tahun");
    await expect(main).toContainText("nomor invoice");
  });

  test("password salah: pesan di bawah kolomnya, permintaan tidak tercatat", async ({ page }) => {
    await signedIn(page);
    await page.goto("/akun/hapus");
    await submit(page, "salah-password");
    await confirm(page).getByRole("button", { name: "Ya, hapus akun" }).click();
    await expect(form(page).getByText("Password salah.")).toBeVisible();
    await expect(form(page).getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Permintaan hapus akun sudah kami terima.")).toHaveCount(0);
  });

  test("konfirmasi dulu: Batal tidak mengirim apa pun", async ({ page }) => {
    await signedIn(page);
    await page.goto("/akun/hapus");
    await submit(page);
    await expect(confirm(page)).toBeVisible();
    await confirm(page).getByRole("button", { name: "Batal", exact: true }).click();
    await expect(confirm(page)).toBeHidden();
    await expect(page.getByText("Permintaan hapus akun sudah kami terima.")).toHaveCount(0);
  });

  test("permintaan diterima: pesan, bisa dibatalkan, dan tetap terlihat saat halaman dimuat ulang", async ({ page }) => {
    await signedIn(page);
    await page.goto("/akun/hapus");
    await submit(page);
    await confirm(page).getByRole("button", { name: "Ya, hapus akun" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Permintaan hapus akun sudah kami terima." })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Permintaan hapus akun sudah kami terima.")).toBeVisible();
    await page.getByRole("button", { name: "Batalkan permintaan" }).click();
    await expect(form(page)).toBeVisible();
    await expect(page.getByText("Permintaan hapus akun sudah kami terima.")).toHaveCount(0);
  });

  test("ada pesanan yang menunda: daftar nomor invoice dan alasannya", async ({ page }) => {
    const b = await signedIn(page);
    const o = await waitingOrder(b.cookie);
    await page.goto("/akun/hapus");
    await submit(page);
    await confirm(page).getByRole("button", { name: "Ya, hapus akun" }).click();
    await expect(page.getByText("Penghapusan menunggu pesanan berikut selesai atau dibatalkan:")).toBeVisible();
    await expect(page.getByRole("list", { name: "Pesanan yang menunda" })).toContainText(`${o.invoiceNumber}`);
    await expect(page.getByRole("list", { name: "Pesanan yang menunda" })).toContainText("Menunggu pembayaran");
    await page.getByRole("link", { name: o.invoiceNumber }).click();
    await expect(page).toHaveURL(new RegExp(`/pesanan/${o.id}$`));
  });

  test("tanpa masuk diarahkan ke halaman masuk", async ({ page }) => {
    await page.goto("/akun/hapus");
    await expect(page).toHaveURL(/\/masuk/);
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: formulir, dialog, kesalahan, dan status permintaan`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const b = await signedIn(page);
      const o = await waitingOrder(b.cookie);
      const scan = async () => { await expect(page).toHaveTitle(/.+/); expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]); }; // judul sempat hilang saat router.refresh berlangsung
      await page.goto("/akun/hapus"); await scan();
      await submit(page, "salah-password"); await expect(confirm(page)).toBeVisible(); await scan();
      await confirm(page).getByRole("button", { name: "Ya, hapus akun" }).click();
      await expect(form(page).getByText("Password salah.")).toBeVisible(); await scan();
      await submit(page);
      await confirm(page).getByRole("button", { name: "Ya, hapus akun" }).click();
      await expect(page.getByRole("link", { name: o.invoiceNumber })).toBeVisible(); await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; kolom dan tombol minimal 44px; Enter mengirim", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await signedIn(page);
    await page.goto("/akun/hapus");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [form(page).getByLabel("Password"), form(page).getByRole("button", { name: "Hapus akun" })]) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await form(page).getByLabel("Password").fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(confirm(page)).toBeVisible();
  });
});


