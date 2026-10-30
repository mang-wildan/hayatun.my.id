import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, resetProducts, seedProduct } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const EMPTY = "Produk Hayatun sedang disiapkan. Mampir lagi sebentar lagi ya.";

let cookie: Awaited<ReturnType<typeof adminCookie>>;
let ebook: { id: string; slug: string };
let nastar: { id: string; slug: string };
let habis: { id: string; slug: string };

test.beforeAll(async () => {
  await resetProducts();
  cookie = await adminCookie();
  ebook = await seedProduct(cookie, { name: "E-book Resep Lebaran", price: 75000, cover: true, description: "Seratus resep untuk hari raya." });
  await seedProduct(cookie, { name: "Template Undangan", price: 25000, cover: true });
  await seedProduct(cookie, { name: "Aplikasi Kasir Toko", price: 350000, isLicensed: true, licenses: "A\nB" });
  nastar = await seedProduct(cookie, { name: "Kue Kering Nastar Premium Isi Selai Nanas Homemade", type: "physical", price: 120000, weightG: 600, stockQty: 10, cover: true, description: "Toples isi 500 gram." });
  await seedProduct(cookie, { name: "Kastengel Keju", type: "physical", price: 95000, stockQty: 4 });
  habis = await seedProduct(cookie, { name: "Putri Salju Habis", type: "physical", price: 80000, stockQty: 0 });
  await seedProduct(cookie, { name: "Produk Belum Aktif", activate: false });
});

// banyak kartu produk dalam satu baris = jumlah kolom kisi
async function columns(page: Page, section: string) {
  const cards = page.getByTestId(`kelompok-${section}`).getByRole("listitem");
  const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  return tops.filter((t) => t === tops[0]).length;
}

test.describe("beranda dan katalog (F2, DESIGN §6)", () => {
  test("produk dikelompokkan Digital dan Fisik; produk nonaktif tidak tampil", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E-book, template, aplikasi, dan produk pilihan dari Hayatun.");
    const digital = page.getByTestId("kelompok-digital");
    const fisik = page.getByTestId("kelompok-fisik");
    await expect(page.getByRole("heading", { level: 2, name: "Digital" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Fisik" })).toBeVisible();
    await expect(digital.getByRole("listitem")).toHaveCount(3);
    await expect(fisik.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("Produk Belum Aktif")).toHaveCount(0);
    await expect(page.getByText(EMPTY)).toHaveCount(0);
  });

  test("kartu: label jenis, nama, harga; seluruh kartu adalah satu tautan ke detail", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("listitem").filter({ hasText: "E-book Resep Lebaran" });
    await expect(card).toContainText("E-book Resep Lebaran");
    await expect(card).toContainText("Rp75.000");
    await expect(card.getByText("Digital", { exact: true })).toBeVisible(); // label jenis
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByRole("link")).toHaveAttribute("href", `/produk/${ebook.slug}`);
  });

  test("kisi 2 kolom di HP, 3 di tablet, 4 di PC", async ({ page }) => {
    for (const [width, cols] of [[360, 2], [768, 3], [1280, 4]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      expect(await columns(page, "digital"), `digital @${width}`).toBe(Math.min(cols, 3));
      expect(await columns(page, "fisik"), `fisik @${width}`).toBe(Math.min(cols, 3));
    }
    // 8 produk fisik memastikan baris penuh di PC
    await seedProduct(cookie, { name: "Fisik 4", type: "physical" });
    await seedProduct(cookie, { name: "Fisik 5", type: "physical" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    expect(await columns(page, "fisik")).toBe(4);
  });

  test("sampul dalam bingkai 4:5 tanpa dipotong, di atas latar rose lembut", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const frame = page.getByRole("listitem").filter({ hasText: "E-book Resep Lebaran" }).getByTestId("sampul");
    const box = (await frame.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(4 / 5, 2);
    expect(await frame.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(252, 231, 243)"); // #FCE7F3
    const img = frame.getByRole("img", { name: "E-book Resep Lebaran" });
    expect(await img.evaluate((e) => getComputedStyle(e).objectFit)).toBe("contain");
    // sampul disajikan lewat pengoptimal gambar Next (dikecilkan ke WebP), asalnya tetap sampul produk ini
    await expect(img).toHaveAttribute("src", new RegExp(`^/_next/image\\?url=%2Fapi%2Fcatalog%2F${ebook.slug}%2Fcover%3Fv%3D\\d+&w=\\d+&q=60$`));
    const served = await page.request.get((await img.getAttribute("src"))!); // gambar uji 1x1 piksel tidak bisa di-decode browser, jadi yang dicek jawaban pengoptimalnya
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toMatch(/^image\//);
  });

  test("produk tanpa sampul tetap punya bingkai yang sama; nama panjang dipotong dua baris", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const noCover = page.getByRole("listitem").filter({ hasText: "Kastengel Keju" });
    const withCover = page.getByRole("listitem").filter({ hasText: "Kue Kering Nastar Premium" });
    expect((await noCover.getByTestId("sampul").boundingBox())!.height).toBeCloseTo((await withCover.getByTestId("sampul").boundingBox())!.height, 0);
    const name = withCover.getByTestId("nama");
    expect(await name.evaluate((e) => getComputedStyle(e).webkitLineClamp)).toBe("2");
  });

  test("produk habis diberi label dan tidak menampilkan angka stok", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("listitem").filter({ hasText: "Putri Salju Habis" });
    await expect(card.getByText("Habis", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Kastengel Keju" }).getByText("Habis", { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toMatch(/Tersedia \d|stok:? \d|reserved/i);
  });

  test("tombol pil penyaring bekerja lewat tautan tanpa JavaScript", async ({ page }) => {
    await page.goto("/");
    const pills = page.getByRole("navigation", { name: "Jenis produk" });
    await expect(pills.getByRole("link", { name: "Semua" })).toHaveAttribute("aria-current", "page");
    await pills.getByRole("link", { name: "Digital" }).click();
    await expect(page).toHaveURL(/\?jenis=digital$/);
    await expect(pills.getByRole("link", { name: "Digital" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("kelompok-digital")).toBeVisible();
    await expect(page.getByTestId("kelompok-fisik")).toHaveCount(0);
    await page.goto("/?jenis=fisik");
    await expect(page.getByTestId("kelompok-digital")).toHaveCount(0);
    await expect(page.getByTestId("kelompok-fisik")).toBeVisible();
    await page.goto("/?jenis=ngawur"); // nilai asing diperlakukan sebagai "Semua"
    await expect(page.getByTestId("kelompok-digital")).toBeVisible();
    await expect(page.getByTestId("kelompok-fisik")).toBeVisible();
  });

  test("pil penyaring berukuran sentuh ≥ 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    for (const link of await page.getByRole("navigation", { name: "Jenis produk" }).getByRole("link").all()) {
      expect(Math.min(...Object.values((await link.boundingBox())!).slice(2))).toBeGreaterThanOrEqual(44);
    }
  });

  test("baris pertama produk sudah terlihat tanpa menggulir di HP (DESIGN §6)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto("/");
    await expect(page.getByTestId("kelompok-digital").getByRole("listitem").first()).toBeInViewport();
  });
});

test.describe("detail produk", () => {
  test("produk digital: sampul, label, nama, harga, deskripsi", async ({ page }) => {
    await page.goto(`/produk/${ebook.slug}`);
    await expect(page).toHaveTitle(/E-book Resep Lebaran/);
    await expect(page.getByRole("heading", { level: 1, name: "E-book Resep Lebaran" })).toBeVisible();
    await expect(page.getByText("Rp75.000")).toBeVisible();
    await expect(page.getByText("Seratus resep untuk hari raya.")).toBeVisible();
    await expect(page.getByText("Digital", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "E-book Resep Lebaran" })).toBeVisible();
    await expect(page.getByText(/Berat/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Semua produk|Kembali/ })).toHaveAttribute("href", "/");
  });

  test("produk fisik menampilkan berat", async ({ page }) => {
    await page.goto(`/produk/${nastar.slug}`);
    await expect(page.getByText("Berat: 600 g")).toBeVisible();
    await expect(page.getByText("Fisik", { exact: true })).toBeVisible();
  });

  test("produk habis diberi label; belum ada tombol beli (keranjang di T24)", async ({ page }) => {
    await page.goto(`/produk/${habis.slug}`);
    await expect(page.getByText("Habis", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /keranjang/i })).toHaveCount(0);
  });

  test("slug tidak dikenal atau produk nonaktif: halaman 404 yang ramah", async ({ page }) => {
    for (const slug of ["tidak-ada", "produk-belum-aktif"]) {
      const res = await page.goto(`/produk/${slug}`);
      expect(res!.status()).toBe(404);
      await expect(page.getByText("Produk tidak ditemukan.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Lihat semua produk" })).toHaveAttribute("href", "/");
    }
  });
});

test.describe("aksesibilitas dan performa dasar (N11–N17)", () => {
  for (const width of WIDTHS) {
    for (const path of ["/", "/?jenis=digital", "DETAIL"]) {
      test(`${path === "DETAIL" ? "detail produk" : path} @${width}px: lolos WCAG 2.1 AA dan tanpa gulir ke samping`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        expect((await page.goto(path === "DETAIL" ? `/produk/${ebook.slug}` : path))!.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  }

  test("gambar di bawah layar pertama dimuat malas; ruangnya sudah dipesan supaya halaman tidak melompat (CLS)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto("/");
    const imgs = page.locator("img");
    const total = await imgs.count();
    expect(total).toBeGreaterThan(3);
    const lazy = await imgs.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).loading === "lazy").length);
    expect(lazy).toBeGreaterThan(0);
    await expect(imgs.first()).not.toHaveAttribute("loading", "lazy"); // yang pertama dimuat segera (LCP)
    const frames = await page.getByTestId("sampul").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(frames.every((h) => h > 100)).toBe(true); // ukuran sudah tetap sebelum gambar selesai dimuat
  });

  test("beranda tanpa produk aktif menampilkan keadaan kosong", async ({ page, browser }) => {
    await resetProducts();
    await page.goto("/");
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page.getByTestId("kelompok-digital")).toHaveCount(0);
    void browser;
  });
});
