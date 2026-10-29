import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADDRESS, adminApi, adminCookie, auditCount, buyerCookie, clearShipments, PNG_1X1, resetProducts, seedProduct, setSetting, uploadProofApi, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const SHORT = "Nomor resi minimal 8 karakter.";

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  await clearShipments();
  buyer = await buyerCookie();
  await context.addCookies([admin]);
  await setSetting("bankAccount", { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" });
});

// 1 nastar Rp120.000 + ongkir SiCepat REG Rp15.000 = Rp135.000, sudah Lunas: bagian fisik Diproses
async function processing(name = `Nastar ${Math.random().toString(36).slice(2, 7)}`, who = buyer) {
  const f = await seedProduct(admin, { name, type: "physical", price: 120000, stockQty: 20 });
  await userApi(who, "POST", "/api/cart/items", { productId: f.id });
  const address = await userApi(who, "POST", "/api/addresses", ADDRESS);
  const id = (await userApi(who, "POST", "/api/checkout", { addressId: address.id, courier: "SiCepat", service: "REG", expectedTotal: 135000 })).orderId as string;
  await uploadProofApi(who, id, PNG_1X1, "image/png");
  await adminApi(admin, "POST", `/api/admin/payments/${id}/accept`);
  return { id, name };
}
const item = (page: Page, o: { name: string }) => page.getByTestId("pengiriman-item").filter({ hasText: o.name });
const toShip = (page: Page) => page.getByRole("region", { name: "Perlu dikirim" });
const sent = (page: Page) => page.getByRole("region", { name: "Sudah dikirim" });
const notice = (page: Page) => page.getByRole("status").filter({ hasText: "Resi tersimpan" });
const save = async (row: Locator, resi: string, button: "Simpan resi" | "Ubah resi" = "Simpan resi") => {
  await row.getByLabel("Nomor resi").fill(resi);
  await row.getByRole("button", { name: button }).click();
};

test.describe("daftar pengiriman (F8.1)", () => {
  test("pesanan Diproses lengkap dengan penerima, alamat, telepon, ekspedisi, dan barang; pembukaan alamat tercatat", async ({ page }) => {
    const o = await processing("Nastar Lengkap");
    await page.goto("/admin/pengiriman");
    await expect(page.getByRole("heading", { level: 1, name: "Pengiriman" })).toBeVisible();
    const row = item(page, o);
    await expect(toShip(page).getByTestId("pengiriman-item")).toHaveCount(1);
    await expect(row).toContainText("Budi Santoso");
    await expect(row).toContainText("Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo");
    await expect(row).toContainText("+6281234567890");
    await expect(row).toContainText("SiCepat REG");
    await expect(row).toContainText("Nastar Lengkap × 1");
    await expect(row.getByTestId("nomor-invoice")).toHaveText(/^INV\/\d{4}\/\d{2}\/\d{4,}$/);
    expect(await auditCount("order.address_viewed", o.id)).toBeGreaterThanOrEqual(1);
  });

  test("tidak ada yang perlu dikirim: pesan kosong", async ({ page }) => {
    await page.goto("/admin/pengiriman");
    await expect(page.getByText("Belum ada pesanan yang perlu dikirim.")).toBeVisible();
    await expect(page.getByTestId("pengiriman-item")).toHaveCount(0);
  });

  test("menu Lainnya membuka halaman dengan tautan Pengiriman", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("navigation", { name: "Menu admin" }).getByRole("link", { name: "Lainnya" }).click();
    await expect(page).toHaveURL(/\/admin\/lainnya$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lainnya" })).toBeVisible();
    await page.getByRole("link", { name: "Pengiriman" }).click();
    await expect(page).toHaveURL(/\/admin\/pengiriman$/);
  });

  test("pembeli tidak bisa membuka halaman admin", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([await buyerCookie()]);
    const page = await ctx.newPage();
    await page.goto("/admin/pengiriman");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });
});

test.describe("mengisi dan mengubah resi (F8.2, F8.4, F8.5)", () => {
  test("resi disimpan: pesan singkat, pindah ke Sudah dikirim, dan pembeli melihatnya di detail pesanan", async ({ page, browser }) => {
    const o = await processing("Nastar Kirim");
    await page.goto("/admin/pengiriman");
    await save(item(page, o), "SCP1234567890");
    await expect(notice(page)).toBeVisible();
    await expect(toShip(page).getByTestId("pengiriman-item")).toHaveCount(0);
    await expect(sent(page).getByTestId("pengiriman-item").filter({ hasText: o.name })).toHaveCount(1);
    await expect(sent(page).getByLabel("Nomor resi")).toHaveValue("SCP1234567890");

    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([buyer]);
    const buyerPage = await ctx.newPage();
    await buyerPage.goto(`/pesanan/${o.id}`);
    const fisik = buyerPage.getByRole("region", { name: "Fisik" });
    await expect(fisik.getByTestId("status-fisik")).toHaveText("Dikirim");
    await expect(fisik.getByTestId("nomor-resi")).toHaveText("SCP1234567890");
    await ctx.close();
  });

  test("resi kosong atau terlalu pendek ditolak dengan pesan di bawah kolomnya, tanpa mengubah status", async ({ page }) => {
    const o = await processing("Nastar Salah");
    await page.goto("/admin/pengiriman");
    const row = item(page, o);
    await save(row, "SCP123");
    await expect(row.getByText(SHORT)).toBeVisible();
    await expect(row.getByLabel("Nomor resi")).toHaveAttribute("aria-invalid", "true");
    await expect(toShip(page).getByTestId("pengiriman-item")).toHaveCount(1);
    await save(row, "");
    await expect(row.getByText("Nomor resi wajib diisi.")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await save(row, "SCP12345"); // koreksi: pesan hilang dan tersimpan
    await expect(notice(page)).toBeVisible();
  });

  test("resi diubah lewat bagian Sudah dikirim: nilai baru tersimpan dan tercatat di log", async ({ page }) => {
    const o = await processing("Nastar Ubah");
    await page.goto("/admin/pengiriman");
    await save(item(page, o), "SCP1111111111");
    await expect(sent(page).getByTestId("pengiriman-item")).toHaveCount(1);
    await save(sent(page).getByTestId("pengiriman-item"), "SCP2222222222", "Ubah resi");
    await expect(notice(page)).toBeVisible();
    await page.reload();
    await expect(sent(page).getByLabel("Nomor resi")).toHaveValue("SCP2222222222");
    expect(await auditCount("order.tracking_changed", o.id)).toBe(1);
  });

  test("Enter di kolom resi menyimpan (keyboard)", async ({ page }) => {
    const o = await processing("Nastar Enter");
    await page.goto("/admin/pengiriman");
    await item(page, o).getByLabel("Nomor resi").fill("SCP1234567890");
    await page.keyboard.press("Enter");
    await expect(notice(page)).toBeVisible();
  });

  test("admin lain sudah mengirimnya lebih dulu: kolom resi tetap bisa dipakai tanpa error", async ({ page }) => {
    const o = await processing("Nastar Dua Admin");
    await page.goto("/admin/pengiriman");
    await adminApi(await adminCookie(), "POST", `/api/admin/shipments/${o.id}/tracking`, { trackingNumber: "SCP1234567890" });
    await save(item(page, o), "SCP1234567890"); // sama dengan yang sudah tersimpan: tidak ada perubahan
    await expect(notice(page)).toBeVisible();
  });
});

test.describe("pembeli menerima pesanan (F8.3)", () => {
  test("Pesanan diterima: ada konfirmasi, Batal tidak mengubah, Ya mengubah status dan menghapus tombol", async ({ page, context }) => {
    const o = await processing("Nastar Terima");
    await adminApi(admin, "POST", `/api/admin/shipments/${o.id}/tracking`, { trackingNumber: "SCP1234567890" });
    await context.clearCookies();
    await context.addCookies([buyer]);
    await page.goto(`/pesanan/${o.id}`);
    const fisik = page.getByRole("region", { name: "Fisik" });
    await fisik.getByRole("button", { name: "Pesanan diterima" }).click();
    const dialog = page.getByRole("dialog", { name: "Pesanan sudah kamu terima?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toBeHidden();
    await expect(fisik.getByTestId("status-fisik")).toHaveText("Dikirim");
    await fisik.getByRole("button", { name: "Pesanan diterima" }).click();
    await dialog.getByRole("button", { name: "Ya, sudah diterima" }).click();
    await expect(fisik.getByTestId("status-fisik")).toHaveText("Diterima");
    await expect(fisik.getByRole("button", { name: "Pesanan diterima" })).toHaveCount(0);
  });

  test("tombol hanya muncul saat Dikirim, bukan saat Diproses", async ({ page, context }) => {
    const o = await processing("Nastar Belum Kirim");
    await context.clearCookies();
    await context.addCookies([buyer]);
    await page.goto(`/pesanan/${o.id}`);
    await expect(page.getByRole("region", { name: "Fisik" }).getByRole("button", { name: "Pesanan diterima" })).toHaveCount(0);
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: daftar dengan dua bagian, kesalahan, Lainnya, dan dialog`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const a = await processing("Nastar A11y Satu");
      const b = await processing("Nastar A11y Dua");
      await adminApi(admin, "POST", `/api/admin/shipments/${b.id}/tracking`, { trackingNumber: "SCP1234567890" });
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin/pengiriman");
      await expect(item(page, a)).toBeVisible();
      await scan();
      await save(item(page, a), "pendek");
      await expect(item(page, a).getByText(SHORT)).toBeVisible();
      await scan();
      await page.goto("/admin/lainnya"); await scan();
      await context.clearCookies();
      await context.addCookies([buyer]);
      await page.goto(`/pesanan/${b.id}`);
      await page.getByRole("button", { name: "Pesanan diterima" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; kolom dan tombol resi minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const o = await processing("Nastar dengan nama yang sangat panjang supaya kartu pengiriman harus membungkus teksnya dengan benar");
    await page.goto("/admin/pengiriman");
    await expect(item(page, o)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [item(page, o).getByLabel("Nomor resi"), item(page, o).getByRole("button", { name: "Simpan resi" })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
