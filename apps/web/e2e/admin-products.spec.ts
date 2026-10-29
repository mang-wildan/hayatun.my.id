import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, PNG_1X1, resetProducts, seedProduct } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const NO_WEIGHT = "Berat wajib diisi untuk produk fisik (dalam gram), karena ongkir dihitung dari beratnya.";

let cookie: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => { await resetProducts(); });
test.beforeEach(async ({ context }) => {
  cookie ??= await adminCookie();
  await context.addCookies([cookie]);
});

async function expectPageOk(page: Page, path: string, heading: string | RegExp) {
  expect((await page.goto(path))!.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}
const stockText = (page: Page) => page.getByTestId("stock-summary");

test("tanpa sesi admin, halaman produk mengarah ke halaman masuk", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/produk");
  await expect(page).toHaveURL(/\/masuk/);
});

test("daftar kosong menjelaskan langkah berikutnya", async ({ page }) => {
  await expectPageOk(page, "/admin/produk", "Produk");
  await expect(page.getByText("Belum ada produk. Tambahkan produk pertamamu.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tambah produk" })).toHaveAttribute("href", "/admin/produk/baru");
});

test("alur lengkap produk digital: buat, sampul, file, tautan, aktifkan", async ({ page }) => {
  const coverResponses: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/cover")) coverResponses.push(`${r.status()} ${r.request().method()}`); });
  page.on("requestfailed", (r) => { if (r.url().includes("/cover")) coverResponses.push(`gagal: ${r.failure()?.errorText}`); });
  await expectPageOk(page, "/admin/produk/baru", "Produk baru");
  await page.getByLabel("Nama produk").fill("E-book Resep Lebaran");
  await page.getByLabel("Deskripsi").fill("Seratus resep untuk hari raya.");
  await page.getByRole("radio", { name: "Digital" }).check();
  await page.getByLabel("Harga (Rp)").fill("75000");
  await expect(page.getByLabel("Berat (gram)")).toHaveCount(0); // hanya untuk produk fisik
  await page.getByRole("button", { name: "Simpan produk" }).click();
  await expect(page).toHaveURL(/\/admin\/produk\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "E-book Resep Lebaran" })).toBeVisible();
  await expect(page.getByText("Nonaktif", { exact: true })).toBeVisible();

  // aktifkan tanpa file ditolak dengan pesan jelas
  await page.getByRole("button", { name: "Aktifkan produk" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Produk digital perlu minimal satu file atau tautan sebelum dijual." })).toBeVisible();

  await page.getByLabel("Pilih sampul").setInputFiles({ name: "sampul.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByText("Sampul tersimpan.")).toBeVisible();
  const cover = page.getByRole("img", { name: "Sampul E-book Resep Lebaran" });
  await expect(cover).toBeVisible();
  // gambar tampil sebelum selesai dimuat, jadi tunggu; bila tetap rusak, tunjukkan status respons permintaan gambarnya
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth), { message: `sampul tidak termuat; respons: ${coverResponses.join(", ") || "tidak ada"}` }).toBeGreaterThan(0);

  // 3 MB lewat proxy Next.js: memastikan unggahan besar tidak terpotong
  await page.getByLabel("Tambah file").setInputFiles({ name: "ebook.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(3 * 1024 * 1024, 7) });
  await expect(page.getByRole("list", { name: "File produk" }).getByText("ebook.pdf")).toBeVisible();
  await expect(page.getByRole("list", { name: "File produk" }).getByText("3,0 MB")).toBeVisible();

  await page.getByLabel("Alamat tautan").fill("https://contoh.id/bonus");
  await page.getByLabel("Nama tautan").fill("Bonus video");
  await page.getByRole("button", { name: "Tambah tautan" }).click();
  await expect(page.getByRole("list", { name: "File produk" }).getByText("Bonus video")).toBeVisible();

  await page.getByRole("button", { name: "Aktifkan produk" }).click();
  await expect(page.getByText("Produk sudah aktif dan tampil di toko.")).toBeVisible();
  await expect(page.getByText("Aktif", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nonaktifkan produk" })).toBeVisible();

  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.products.map((p: { name: string }) => p.name)).toContain("E-book Resep Lebaran");
});

test("tautan harus https dan error tampil di bawah kolomnya", async ({ page }) => {
  const { id } = await seedProduct(cookie, { name: "Template Undangan", activate: false });
  await expectPageOk(page, `/admin/produk/${id}`, "Template Undangan");
  await page.getByLabel("Alamat tautan").fill("http://tidak-aman.id");
  await page.getByLabel("Nama tautan").fill("Unduh");
  await page.getByRole("button", { name: "Tambah tautan" }).click();
  const field = page.getByLabel("Alamat tautan");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Alamat tautan harus diawali https:\/\//);
});

test("produk fisik: berat wajib, stok tampil, stok rendah ditandai", async ({ page }) => {
  await expectPageOk(page, "/admin/produk/baru", "Produk baru");
  await page.getByLabel("Nama produk").fill("Kue Nastar");
  await page.getByRole("radio", { name: "Fisik" }).check();
  await page.getByLabel("Harga (Rp)").fill("120000");
  await page.getByLabel("Stok").fill("2");
  await page.getByRole("button", { name: "Simpan produk" }).click();
  const weight = page.getByLabel("Berat (gram)");
  await expect(weight).toHaveAttribute("aria-invalid", "true");
  await expect(weight).toHaveAccessibleDescription(NO_WEIGHT);

  await weight.fill("600");
  await page.getByRole("button", { name: "Simpan produk" }).click();
  await expect(page).toHaveURL(/\/admin\/produk\/[0-9a-f-]{36}$/);
  await expect(stockText(page)).toHaveText("Tersedia 2 · Ditahan 0 · Terjual 0");
  await expect(page.getByLabel("Pakai kode lisensi")).toHaveCount(0);

  await page.goto("/admin/produk");
  await expect(page.getByText("Stok rendah")).toBeVisible();
});

test("produk berlisensi: kode ganda ditolak, kode tidak pernah ditampilkan kembali", async ({ page }) => {
  const { id } = await seedProduct(cookie, { name: "Aplikasi Kasir", isLicensed: true, activate: false });
  await expectPageOk(page, `/admin/produk/${id}`, "Aplikasi Kasir");
  await expect(stockText(page)).toHaveText("Tersedia 0 · Ditahan 0 · Terjual 0");
  await page.getByLabel("Tempel kode lisensi (satu per baris)").fill("RAHASIA-1\nRAHASIA-2\nRAHASIA-2");
  await page.getByRole("button", { name: "Tambah kode" }).click();
  await expect(page.getByText("2 kode ditambahkan. 1 ditolak karena sudah ada.")).toBeVisible();
  await expect(stockText(page)).toHaveText("Tersedia 2 · Ditahan 0 · Terjual 0");
  await expect(page.getByLabel("Tempel kode lisensi (satu per baris)")).toHaveValue(""); // area tempel dikosongkan
  expect(await page.content()).not.toContain("RAHASIA");
});

test("menonaktifkan produk meminta konfirmasi; Esc dan Batal tidak mengubah apa pun", async ({ page }) => {
  const { id } = await seedProduct(cookie, { name: "Produk Aktif" });
  await expectPageOk(page, `/admin/produk/${id}`, "Produk Aktif");
  await page.getByRole("button", { name: "Nonaktifkan produk" }).click();
  const dialog = page.getByRole("dialog", { name: "Nonaktifkan produk?" });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true); // fokus terkunci di dalam dialog
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Aktif", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nonaktifkan produk" }).click();
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(page.getByText("Aktif", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nonaktifkan produk" }).click();
  await dialog.getByRole("button", { name: "Ya, nonaktifkan" }).click();
  await expect(page.getByText("Nonaktif", { exact: true })).toBeVisible();
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.products.map((p: { name: string }) => p.name)).not.toContain("Produk Aktif");
});

test("menghapus file meminta konfirmasi; file terakhir produk aktif tidak bisa dihapus", async ({ page }) => {
  const { id } = await seedProduct(cookie, { name: "Produk Satu Tautan" }); // aktif dengan satu tautan
  await expectPageOk(page, `/admin/produk/${id}`, "Produk Satu Tautan");
  await page.getByRole("button", { name: "Hapus Unduh" }).click();
  const dialog = page.getByRole("dialog", { name: /Hapus/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ya, hapus" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Produk yang sedang dijual harus punya minimal satu file atau tautan. Nonaktifkan dulu." })).toBeVisible();
  await expect(page.getByRole("list", { name: "File produk" }).getByText("Unduh")).toBeVisible();
});

test("produk yang tidak ada: pesan jelas", async ({ page }) => {
  const res = await page.goto("/admin/produk/00000000-0000-0000-0000-000000000000");
  expect(res!.status()).toBe(404);
  await expect(page.getByText("Produk tidak ditemukan.")).toBeVisible();
});

test.describe("daftar produk responsif (DESIGN §6)", () => {
  test.beforeAll(async () => {
    await seedProduct(cookie ?? (cookie = await adminCookie()), { name: "Daftar Fisik", type: "physical", price: 120000, stockQty: 10 });
    await seedProduct(cookie, { name: "Daftar Digital", price: 75000 });
  });

  test("HP: kartu bertumpuk, bukan tabel", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await expectPageOk(page, "/admin/produk", "Produk");
    await expect(page.getByRole("table")).toHaveCount(0);
    const card = page.getByRole("listitem").filter({ hasText: "Daftar Fisik" });
    await expect(card).toContainText("Fisik");
    await expect(card).toContainText("Rp120.000");
    await expect(card).toContainText("Aktif");
    await expect(card).toContainText("Tersedia 10 · Ditahan 0 · Terjual 0");
    await expect(page.getByRole("listitem").filter({ hasText: "Daftar Digital" })).toContainText("Tanpa batas");
    await card.getByRole("link", { name: "Daftar Fisik" }).click();
    await expect(page).toHaveURL(/\/admin\/produk\/[0-9a-f-]{36}$/);
  });

  test("PC: tabel dengan kolom berlabel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectPageOk(page, "/admin/produk", "Produk");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const h of ["Produk", "Jenis", "Harga", "Status", "Stok"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    const row = table.getByRole("row").filter({ hasText: "Daftar Fisik" });
    await expect(row).toContainText("Rp120.000");
    await expect(row).toContainText("Tersedia 10 · Ditahan 0 · Terjual 0");
  });
});

test.describe("aksesibilitas semua halaman produk (N11–N16)", () => {
  let id: string;
  test.beforeAll(async () => {
    cookie ??= await adminCookie();
    ({ id } = await seedProduct(cookie, { name: "Produk A11y", isLicensed: true, cover: true, licenses: "A\nB" }));
  });
  for (const width of WIDTHS) {
    for (const [label, path] of [["daftar", "/admin/produk"], ["baru", "/admin/produk/baru"], ["detail", ""]] as const) {
      test(`${label} @${width}px: lolos WCAG 2.1 AA dan tanpa gulir ke samping`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        expect((await page.goto(path || `/admin/produk/${id}`))!.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  }

  test("HP: area sentuh minimal 44px di formulir produk", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/admin/produk/${id}`);
    const targets = await page.locator("main button, main input:not([type=file]):not([type=radio]):not([type=checkbox]), main textarea, main a").all();
    expect(targets.length).toBeGreaterThan(5);
    for (const el of targets) {
      if (!(await el.isVisible())) continue;
      const box = (await el.boundingBox())!;
      expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(44);
    }
  });
});
