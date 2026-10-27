import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, adminCookie, buyerCookie, resetProducts, seedProduct } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BLOCKED = "Ada item yang tidak bisa dibeli. Hapus item itu dulu untuk melanjutkan.";

let admin: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies([await buyerCookie()]); // pembeli baru di setiap tes, jadi keranjang selalu mulai kosong
});

const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
const topCart = (page: Page) => page.getByRole("link", { name: /^Keranjang/ });

async function addFromDetail(page: Page, slug: string, times = 1) {
  await page.goto(`/produk/${slug}`);
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    if (i < times - 1) await page.getByText("Masuk ke keranjang.").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  }
}

test.describe("dari halaman produk", () => {
  test("tanpa login: diarahkan masuk dengan penjelasan", async ({ browser }) => {
    const p = await seedProduct(admin, { name: "E-book Anon" });
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/produk/${p.slug}`);
    await expect(topCart(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await expect(page).toHaveURL(/\/masuk/);
    await expect(page.getByText("Masuk dulu ya supaya keranjangmu tersimpan.")).toBeVisible();
  });

  test("produk habis tidak punya tombol", async ({ page }) => {
    const p = await seedProduct(admin, { name: "Putri Salju Kosong", type: "physical", stockQty: 0 });
    await page.goto(`/produk/${p.slug}`);
    await expect(page.getByText("Habis", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /keranjang/i })).toHaveCount(0);
  });

  test("setelah masuk keranjang, jumlah di bar atas ikut berubah", async ({ page }) => {
    const p = await seedProduct(admin, { name: "E-book Satu" });
    await page.goto(`/produk/${p.slug}`);
    await expect(topCart(page)).toHaveAccessibleName("Keranjang");
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await expect(topCart(page)).toHaveAccessibleName("Keranjang, 1 item");
    await expect(topCart(page)).toHaveAttribute("href", "/keranjang");
  });

  test("melewati stok menampilkan pesan dari server", async ({ page }) => {
    const p = await seedProduct(admin, { name: "Kastengel Terbatas", type: "physical", stockQty: 2 });
    await page.goto(`/produk/${p.slug}`);
    const add = page.getByRole("button", { name: "Masukkan keranjang" });
    await add.click();
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await add.click();
    await expect.poll(async () => (await page.request.get("/api/cart")).json().then((c) => c.items[0]?.qty)).toBe(2);
    await add.click();
    await expect(page.getByRole("alert").filter({ hasText: "Stok tersisa 2, jadi jumlahnya tidak bisa lebih dari itu." })).toBeVisible();
  });
});

test.describe("halaman keranjang", () => {
  test("tanpa login mengarah ke halaman masuk", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/keranjang");
    await expect(page).toHaveURL(/\/masuk/);
  });

  test("keranjang kosong menjelaskan langkah berikutnya", async ({ page }) => {
    expect((await page.goto("/keranjang"))!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Keranjang" })).toBeVisible();
    await expect(page.getByText("Keranjangmu masih kosong.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Mulai belanja" })).toHaveAttribute("href", "/");
  });

  test("digital dan fisik dalam satu keranjang; subtotal benar; digital tanpa pengatur jumlah", async ({ page }) => {
    const d = await seedProduct(admin, { name: "E-book Campur", price: 75000 });
    const f = await seedProduct(admin, { name: "Nastar Campur", type: "physical", price: 120000, stockQty: 10 });
    await addFromDetail(page, d.slug);
    await addFromDetail(page, f.slug, 2);
    await page.goto("/keranjang");
    const digital = row(page, "E-book Campur");
    const fisik = row(page, "Nastar Campur");
    await expect(digital).toContainText("Rp75.000");
    await expect(digital.getByRole("link", { name: "E-book Campur" })).toHaveAttribute("href", `/produk/${d.slug}`);
    await expect(digital.getByRole("button", { name: /jumlah/i })).toHaveCount(0);
    await expect(fisik.getByTestId("jumlah")).toHaveText("2");
    await expect(fisik).toContainText("Rp240.000");
    await expect(page.getByTestId("subtotal")).toHaveText("Rp315.000");
  });

  test("mengubah jumlah memperbarui total; batas bawah 1 dan batas atas sesuai stok", async ({ page }) => {
    const f = await seedProduct(admin, { name: "Kastengel Atur", type: "physical", price: 95000, stockQty: 3 });
    await addFromDetail(page, f.slug);
    await page.goto("/keranjang");
    const item = row(page, "Kastengel Atur");
    await expect(item.getByRole("button", { name: "Kurangi jumlah Kastengel Atur" })).toBeDisabled();
    await item.getByRole("button", { name: "Tambah jumlah Kastengel Atur" }).click();
    await expect(item.getByTestId("jumlah")).toHaveText("2");
    await expect(page.getByTestId("subtotal")).toHaveText("Rp190.000");
    await item.getByRole("button", { name: "Tambah jumlah Kastengel Atur" }).click();
    await expect(item.getByTestId("jumlah")).toHaveText("3");
    await expect(item.getByRole("button", { name: "Tambah jumlah Kastengel Atur" })).toBeDisabled(); // stok hanya 3
    await item.getByRole("button", { name: "Kurangi jumlah Kastengel Atur" }).click();
    await expect(page.getByTestId("subtotal")).toHaveText("Rp190.000");
    await page.reload();
    await expect(row(page, "Kastengel Atur").getByTestId("jumlah")).toHaveText("2"); // tersimpan di server
  });

  test("menghapus item", async ({ page }) => {
    const d = await seedProduct(admin, { name: "E-book Hapus", price: 50000 });
    const e = await seedProduct(admin, { name: "E-book Tetap", price: 25000 });
    await addFromDetail(page, d.slug);
    await addFromDetail(page, e.slug);
    await page.goto("/keranjang");
    await page.getByRole("button", { name: "Hapus E-book Hapus" }).click();
    await expect(page.getByText("E-book Hapus dihapus dari keranjang.")).toBeVisible();
    await expect(row(page, "E-book Hapus")).toHaveCount(0);
    await expect(page.getByTestId("subtotal")).toHaveText("Rp25.000");
    await page.getByRole("button", { name: "Hapus E-book Tetap" }).click();
    await expect(page.getByText("Keranjangmu masih kosong.")).toBeVisible();
  });

  test("produk dinonaktifkan admin: ditandai, tidak dihitung, dan pembeli diberi tahu", async ({ page }) => {
    const d = await seedProduct(admin, { name: "E-book Ditarik", price: 75000 });
    const f = await seedProduct(admin, { name: "Nastar Aman", type: "physical", price: 120000, stockQty: 5 });
    await addFromDetail(page, d.slug);
    await addFromDetail(page, f.slug);
    await adminApi(admin, "POST", `/api/admin/products/${d.id}/deactivate`);
    await page.goto("/keranjang");
    const item = row(page, "E-book Ditarik");
    await expect(item.getByText("Tidak dijual lagi", { exact: true })).toBeVisible();
    await expect(item.getByRole("button", { name: "Hapus E-book Ditarik" })).toBeVisible();
    await expect(page.getByTestId("subtotal")).toHaveText("Rp120.000"); // item yang ditarik tidak ikut
    await expect(page.getByText(BLOCKED)).toBeVisible();
    await page.getByRole("button", { name: "Hapus E-book Ditarik" }).click();
    await expect(page.getByText(BLOCKED)).toHaveCount(0);
  });

  test("stok habis dan stok kurang dari jumlah di keranjang", async ({ page }) => {
    const gone = await seedProduct(admin, { name: "Putri Salju Ludes", type: "physical", stockQty: 5 });
    const few = await seedProduct(admin, { name: "Nastar Menipis", type: "physical", price: 100000, stockQty: 5 });
    await addFromDetail(page, gone.slug);
    await addFromDetail(page, few.slug, 4);
    await adminApi(admin, "PATCH", `/api/admin/products/${gone.id}`, { stockQty: 0 });
    await adminApi(admin, "PATCH", `/api/admin/products/${few.id}`, { stockQty: 2 });
    await page.goto("/keranjang");
    await expect(row(page, "Putri Salju Ludes").getByText("Habis", { exact: true })).toBeVisible();
    await expect(row(page, "Putri Salju Ludes").getByRole("button", { name: /jumlah/i })).toHaveCount(0);
    const few$ = row(page, "Nastar Menipis");
    await expect(few$.getByText("Stok tersisa 2. Kurangi jumlahnya.")).toBeVisible();
    await expect(few$.getByRole("button", { name: "Tambah jumlah Nastar Menipis" })).toBeDisabled();
    await few$.getByRole("button", { name: "Kurangi jumlah Nastar Menipis" }).click();
    await few$.getByRole("button", { name: "Kurangi jumlah Nastar Menipis" }).click();
    await expect(few$.getByText("Stok tersisa 2. Kurangi jumlahnya.")).toHaveCount(0);
    await expect(page.getByTestId("subtotal")).toHaveText("Rp200.000");
    await expect(page.getByText(BLOCKED)).toBeVisible(); // yang habis masih di keranjang
  });
});

test.describe("aksesibilitas keranjang (N11–N16)", () => {
  test.beforeEach(async ({ page }) => {
    const d = await seedProduct(admin, { name: "E-book A11y", price: 75000, cover: true });
    const f = await seedProduct(admin, { name: "Kue A11y Dengan Nama Yang Cukup Panjang Sekali Supaya Membungkus", type: "physical", price: 120000, stockQty: 6 });
    const off = await seedProduct(admin, { name: "Template A11y Ditarik" });
    await addFromDetail(page, d.slug);
    await addFromDetail(page, f.slug, 2);
    await addFromDetail(page, off.slug);
    await adminApi(admin, "POST", `/api/admin/products/${off.id}/deactivate`);
  });

  for (const width of WIDTHS) {
    test(`@${width}px: lolos WCAG 2.1 AA dan tanpa gulir ke samping`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      expect((await page.goto("/keranjang"))!.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test("HP: area sentuh minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/keranjang");
    const targets = await page.locator("main button, main a, header a").all();
    expect(targets.length).toBeGreaterThan(6);
    for (const el of targets) {
      if (!(await el.isVisible())) continue;
      const box = (await el.boundingBox())!;
      expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(44);
    }
  });
});
