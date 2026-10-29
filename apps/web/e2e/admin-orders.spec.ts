import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, adminCookie, bulkOrders, buyerCookie, clearOrders, patchOrder, PNG_1X1, resetProducts, seedProduct, setSetting, uploadProofApi, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const thisMonth = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  await clearOrders();
  buyer = await buyerCookie();
  await context.addCookies([admin]);
  await setSetting("bankAccount", { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" });
});

// pesanan digital Rp75.000; paid = Lunas
async function digitalOrder(opts: { paid?: boolean; name?: string } = {}) {
  const p = await seedProduct(admin, { name: opts.name ?? `E-book ${Math.random().toString(36).slice(2, 7)}`, price: 75000 });
  await userApi(buyer, "POST", "/api/cart/items", { productId: p.id });
  const id = (await userApi(buyer, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
  if (opts.paid !== false) { await uploadProofApi(buyer, id, PNG_1X1, "image/png"); await adminApi(admin, "POST", `/api/admin/payments/${id}/accept`); }
  const { invoiceNumber } = await userApi(buyer, "GET", `/api/orders/${id}/payment`);
  return { id, invoiceNumber: invoiceNumber as string };
}
const items = (page: Page) => page.getByTestId("admin-pesanan-item");
const filter = (page: Page) => page.getByRole("search", { name: "Filter pesanan" });
const apply = async (page: Page) => { await filter(page).getByRole("button", { name: "Terapkan" }).click(); };
const summary = (page: Page) => page.getByRole("table", { name: "Penjualan per bulan" });

test.describe("daftar dan ringkasan (F13.1, F13.2)", () => {
  test("terbaru dulu dengan invoice, tanggal, pembeli, total, dan status; menu Pesanan membukanya", async ({ page }) => {
    const a = await digitalOrder({ paid: false });
    const b = await digitalOrder();
    await page.goto("/admin");
    await page.getByRole("navigation", { name: "Menu admin" }).getByRole("link", { name: "Pesanan" }).click();
    await expect(page).toHaveURL(/\/admin\/pesanan$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan" })).toBeVisible();
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).nth(0)).toContainText(b.invoiceNumber);
    await expect(items(page).nth(1)).toContainText(a.invoiceNumber);
    await expect(items(page).nth(0)).toContainText("Pembeli Tes");
    await expect(items(page).nth(0)).toContainText("Rp75.000");
    await expect(items(page).nth(0)).toContainText("Lunas");
    await expect(items(page).nth(1)).toContainText("Menunggu pembayaran");
    await expect(items(page).nth(0)).toContainText(/\d{1,2} \p{L}{3} \d{4}/u);
    await expect(page.getByTestId("jumlah")).toHaveText("2 pesanan");
    expect(await items(page).nth(0).getByTestId("nomor-invoice").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
  });

  test("ringkasan bulan ini: hanya yang Lunas, produk, ongkir, dan total", async ({ page }) => {
    await digitalOrder();
    await digitalOrder();
    await digitalOrder({ paid: false });
    await page.goto("/admin/pesanan");
    const row = summary(page).getByRole("row", { name: new RegExp(thisMonth) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell").nth(1)).toHaveText("2");
    await expect(row.getByRole("cell").nth(2)).toHaveText(rupiah(150000));
    await expect(row.getByRole("cell").nth(3)).toHaveText("Rp0");
    await expect(row.getByRole("cell").nth(4)).toHaveText(rupiah(150000));
  });

  test("tanpa pesanan: pesan kosong dan ringkasan kosong", async ({ page }) => {
    await page.goto("/admin/pesanan");
    await expect(page.getByText("Tidak ada pesanan yang cocok.")).toBeVisible();
    await expect(page.getByText("Belum ada penjualan.")).toBeVisible();
    await expect(page.getByTestId("jumlah")).toHaveText("0 pesanan");
  });
});

test.describe("filter dan cari (F13.1)", () => {
  test("status: dipilih lewat formulir, tercermin di URL, dan hasilnya sesuai", async ({ page }) => {
    const paid = await digitalOrder();
    await digitalOrder({ paid: false });
    await page.goto("/admin/pesanan");
    await filter(page).getByLabel("Status").selectOption("LUNAS");
    await apply(page);
    await expect(page).toHaveURL(/status=LUNAS/);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(paid.invoiceNumber);
    await expect(filter(page).getByLabel("Status")).toHaveValue("LUNAS"); // pilihan tetap terlihat
    await filter(page).getByRole("link", { name: "Atur ulang" }).click();
    await expect(items(page)).toHaveCount(2);
  });

  test("jenis produk dan cari nomor invoice sebagian", async ({ page }) => {
    const a = await digitalOrder();
    await digitalOrder();
    const f = await seedProduct(admin, { name: uniq("Nastar Filter"), type: "physical", price: 120000, stockQty: 10 });
    await userApi(buyer, "POST", "/api/cart/items", { productId: f.id });
    const address = await userApi(buyer, "POST", "/api/addresses", { recipient: "Budi", phone: "081234567890", address: "Jl. Pajajaran No. 12 RT 03/RW 05, Cicendo", areaId: "Cicendo", postalCode: "40172" });
    await userApi(buyer, "POST", "/api/checkout", { addressId: address.id, courier: "SiCepat", service: "REG", expectedTotal: 135000 });
    await page.goto("/admin/pesanan?type=fisik");
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText("Rp135.000");
    await page.goto("/admin/pesanan?type=digital");
    await expect(items(page)).toHaveCount(2);
    await page.goto("/admin/pesanan");
    await filter(page).getByLabel("Cari nomor invoice").fill(a.invoiceNumber.slice(-4));
    await page.keyboard.press("Enter"); // keyboard: Enter menerapkan
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(a.invoiceNumber);
    await filter(page).getByLabel("Cari nomor invoice").fill("tidak-ada");
    await apply(page);
    await expect(page.getByText("Tidak ada pesanan yang cocok.")).toBeVisible();
  });

  test("rentang tanggal memakai hari WIB, kedua ujung termasuk", async ({ page }) => {
    const a = await digitalOrder({ paid: false });
    const b = await digitalOrder({ paid: false });
    await patchOrder(a.id, { created_at: "2026-01-14T16:59:59Z" }); // 14 Jan 23.59 WIB
    await patchOrder(b.id, { created_at: "2026-01-14T17:00:00Z" }); // 15 Jan 00.00 WIB
    await page.goto("/admin/pesanan");
    await filter(page).getByLabel("Dari tanggal").fill("2026-01-15");
    await filter(page).getByLabel("Sampai tanggal").fill("2026-01-15");
    await apply(page);
    await expect(page).toHaveURL(/from=2026-01-15/);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(b.invoiceNumber);
  });

  test("nilai di URL yang tidak sah tidak merusak halaman: pesan di tempatnya", async ({ page }) => {
    await digitalOrder();
    expect((await page.goto("/admin/pesanan?status=SELESAI"))!.status()).toBe(200);
    await expect(page.getByText("Status tidak dikenal.")).toBeVisible();
  });
});

test.describe("halaman (25 per halaman)", () => {
  test("halaman berikutnya dan sebelumnya, dengan jumlah total", async ({ page }) => {
    await digitalOrder({ paid: false });
    await bulkOrders(29);
    await page.goto("/admin/pesanan");
    await expect(page.getByTestId("jumlah")).toHaveText("30 pesanan");
    await expect(items(page)).toHaveCount(25);
    await expect(page.getByText("Halaman 1 dari 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sebelumnya" })).toHaveCount(0);
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(items(page)).toHaveCount(5);
    await expect(page.getByText("Halaman 2 dari 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Berikutnya" })).toHaveCount(0);
    await page.getByRole("link", { name: "Sebelumnya" }).click();
    await expect(items(page)).toHaveCount(25);
  });

  test("filter ikut terbawa ke halaman berikutnya", async ({ page }) => {
    await digitalOrder({ paid: false });
    await bulkOrders(29);
    await page.goto("/admin/pesanan?status=KEDALUWARSA");
    await expect(page.getByTestId("jumlah")).toHaveText("29 pesanan");
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(page).toHaveURL(/status=KEDALUWARSA/);
    await expect(items(page)).toHaveCount(4);
  });
});

test.describe("membatalkan pesanan (F10)", () => {
  test("hanya pesanan Lunas yang punya tombol Batalkan", async ({ page }) => {
    const paid = await digitalOrder();
    const waiting = await digitalOrder({ paid: false });
    await page.goto("/admin/pesanan");
    await expect(items(page).filter({ hasText: paid.invoiceNumber }).getByRole("button", { name: /Batalkan pesanan/ })).toHaveCount(1);
    await expect(items(page).filter({ hasText: waiting.invoiceNumber }).getByRole("button", { name: /Batalkan pesanan/ })).toHaveCount(0);
  });

  test("catatan wajib; Batal tidak mengubah; konfirmasi mengubah status, pesan singkat, dan ringkasan ikut turun", async ({ page }) => {
    const o = await digitalOrder();
    await page.goto("/admin/pesanan");
    const row = items(page).filter({ hasText: o.invoiceNumber });
    await row.getByRole("button", { name: /Batalkan pesanan/ }).click();
    const dialog = page.getByRole("dialog", { name: `Batalkan pesanan ${o.invoiceNumber}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Dibatalkan")).toBeChecked(); // bawaan
    await dialog.getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(dialog.getByText("Catatan wajib diisi.")).toBeVisible();
    await expect(dialog.getByLabel("Catatan")).toHaveAttribute("aria-invalid", "true");
    await expect(row).toContainText("Lunas");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Lunas");

    await row.getByRole("button", { name: /Batalkan pesanan/ }).click();
    await dialog.getByLabel("Catatan").fill("Pembeli minta batal");
    await dialog.getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${o.invoiceNumber} dibatalkan` })).toBeVisible();
    await expect(row).toContainText("Dibatalkan");
    await expect(row.getByRole("button", { name: /Batalkan pesanan/ })).toHaveCount(0);
    await expect(page.getByText("Belum ada penjualan.")).toBeVisible(); // keluar dari ringkasan
  });

  test("Dikembalikan: status dan pesan sesuai pilihan", async ({ page }) => {
    const o = await digitalOrder();
    await page.goto("/admin/pesanan");
    const row = items(page).filter({ hasText: o.invoiceNumber });
    await row.getByRole("button", { name: /Batalkan pesanan/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Dikembalikan").check();
    await dialog.getByLabel("Catatan").fill("Dana dikembalikan lewat transfer");
    await dialog.getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${o.invoiceNumber} dikembalikan` })).toBeVisible();
    await expect(row).toContainText("Dikembalikan");
  });

  test("admin lain sudah membatalkannya: pesan kesalahan tampil dan daftar diperbarui", async ({ page }) => {
    const o = await digitalOrder();
    await page.goto("/admin/pesanan");
    await adminApi(await adminCookie(), "POST", `/api/admin/orders/${o.id}/cancel`, { status: "DIBATALKAN", note: "admin lain" });
    const row = items(page).filter({ hasText: o.invoiceNumber });
    await row.getByRole("button", { name: /Batalkan pesanan/ }).click();
    await page.getByRole("dialog").getByLabel("Catatan").fill("terlambat");
    await page.getByRole("dialog").getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Pesanan ini tidak bisa diubah" })).toBeVisible();
    await expect(row).toContainText("Dibatalkan");
  });
});

test.describe("akses, tampilan, dan aksesibilitas", () => {
  test("pembeli diarahkan ke halaman masuk", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([await buyerCookie()]);
    const page = await ctx.newPage();
    await page.goto("/admin/pesanan");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });

  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: daftar, ringkasan, tanpa hasil, dan dialog`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const o = await digitalOrder();
      await digitalOrder({ paid: false });
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin/pesanan");
      await expect(items(page)).toHaveCount(2);
      await scan();
      await page.goto("/admin/pesanan?q=tidak-ada");
      await expect(page.getByText("Tidak ada pesanan yang cocok.")).toBeVisible();
      await scan();
      await page.goto("/admin/pesanan");
      await items(page).filter({ hasText: o.invoiceNumber }).getByRole("button", { name: /Batalkan pesanan/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Ya, batalkan" }).click();
      await expect(page.getByText("Catatan wajib diisi.")).toBeVisible();
      await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; kolom filter dan tombol minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await digitalOrder({ name: "Nama produk panjang sekali untuk menguji pembungkusan teks pada kartu pesanan admin" });
    await page.goto("/admin/pesanan");
    await expect(items(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [filter(page).getByLabel("Cari nomor invoice"), filter(page).getByLabel("Status"), filter(page).getByRole("button", { name: "Terapkan" }), items(page).getByRole("button", { name: /Batalkan pesanan/ })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 7)}`;
