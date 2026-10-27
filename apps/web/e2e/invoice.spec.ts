import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADDRESS, adminCookie, buyerCookie, resetProducts, seedProduct, setOrderStatus, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  buyer = await buyerCookie();
  await context.addCookies([buyer]);
});

async function digitalOrder(who = buyer, name = "E-book Invoice") {
  const d = await seedProduct(admin, { name, price: 75000 });
  await userApi(who, "POST", "/api/cart/items", { productId: d.id });
  return (await userApi(who, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
}

// e-book Rp75.000 + 2 nastar Rp120.000 + ongkir SiCepat REG Rp15.000 = Rp330.000
async function mixedOrder() {
  const d = await seedProduct(admin, { name: "E-book Campuran", price: 75000 });
  const f = await seedProduct(admin, { name: "Nastar Campuran", type: "physical", price: 120000, stockQty: 10 });
  await userApi(buyer, "POST", "/api/cart/items", { productId: d.id });
  await userApi(buyer, "POST", "/api/cart/items", { productId: f.id, qty: 2 });
  const address = await userApi(buyer, "POST", "/api/addresses", ADDRESS);
  return (await userApi(buyer, "POST", "/api/checkout", { addressId: address.id, courier: "SiCepat", service: "REG", expectedTotal: 330000 })).orderId as string;
}

const body = (page: Page) => page.locator("main");

test.describe("isi invoice (F6.2, F6.3)", () => {
  test("pesanan campuran: semua bagian invoice tampil", async ({ page }) => {
    const id = await mixedOrder();
    expect((await page.goto(`/invoice/${id}`))!.status()).toBe(200);
    await expect(page).toHaveTitle(/Invoice/);
    await expect(page.getByRole("heading", { level: 1, name: "Invoice" })).toBeVisible();
    await expect(page.getByTestId("nomor-invoice")).toHaveText(/^INV\/\d{4}\/\d{2}\/\d{4,}$/);
    expect(await page.getByTestId("nomor-invoice").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
    await expect(page.getByTestId("tanggal-terbit")).toHaveText(/^\d{1,2} \p{L}{3} \d{4}, \d{2}\.\d{2} WIB$/u);
    await expect(page.getByTestId("status-invoice")).toHaveText("Belum Lunas");

    const doc = body(page);
    await expect(doc).toContainText("Hayatun"); // nama toko
    await expect(doc).toContainText("toko@hayatun.my.id"); // kontak toko
    await expect(doc).toContainText("Pembeli Tes");
    await expect(doc).toContainText("Transfer bank");

    const table = page.getByRole("table");
    for (const h of ["Produk", "Jumlah", "Harga satuan", "Subtotal"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    const nastar = table.getByRole("row").filter({ hasText: "Nastar Campuran" });
    await expect(nastar).toContainText("2");
    await expect(nastar).toContainText("Rp120.000");
    await expect(nastar).toContainText("Rp240.000");
    await expect(table.getByRole("row").filter({ hasText: "E-book Campuran" })).toContainText("Rp75.000");

    await expect(page.getByTestId("subtotal")).toHaveText("Rp315.000");
    await expect(page.getByTestId("ongkir")).toHaveText("Rp15.000");
    await expect(page.getByTestId("total")).toHaveText("Rp330.000");

    await expect(page.getByRole("heading", { name: "Alamat pengiriman" })).toBeVisible();
    await expect(doc).toContainText("Budi Santoso");
    await expect(doc).toContainText(ADDRESS.address);
    await expect(doc).toContainText("SiCepat REG");
  });

  test("pesanan digital: tanpa alamat dan tanpa ongkir", async ({ page }) => {
    const id = await digitalOrder();
    await page.goto(`/invoice/${id}`);
    await expect(page.getByTestId("total")).toHaveText("Rp75.000");
    await expect(page.getByRole("heading", { name: "Alamat pengiriman" })).toHaveCount(0);
    await expect(page.getByTestId("ongkir")).toHaveCount(0);
  });

  test("tanpa PPN, pajak, atau faktur pajak (F6.3)", async ({ page }) => {
    await page.goto(`/invoice/${await mixedOrder()}`);
    expect(await body(page).innerText()).not.toMatch(/ppn|pajak|\btax\b|faktur/i);
  });

  test.describe("label status memakai teks, bukan warna saja", () => {
    for (const [status, label] of [["MENUNGGU_PEMBAYARAN", "Belum Lunas"], ["LUNAS", "Lunas"], ["KEDALUWARSA", "Dibatalkan"], ["DIKEMBALIKAN", "Dibatalkan"]] as const) {
      test(`${status} → ${label}`, async ({ page }) => {
        const id = await digitalOrder();
        await setOrderStatus(id, status);
        await page.goto(`/invoice/${id}`);
        await expect(page.getByTestId("status-invoice")).toHaveText(label);
        await expect(page.getByTestId("status-invoice").locator("svg")).toHaveCount(1); // ikon menyertai teks
      });
    }
  });

  test("dibuka dari halaman pesanan dibuat lewat tautan Lihat invoice", async ({ page }) => {
    const d = await seedProduct(admin, { name: "E-book Lewat Tautan", price: 75000 });
    await userApi(buyer, "POST", "/api/cart/items", { productId: d.id });
    await page.goto("/checkout/bayar");
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await page.getByRole("link", { name: "Lihat invoice" }).click();
    await expect(page).toHaveURL(/\/invoice\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Invoice" })).toBeVisible();
  });
});

test.describe("akses (F6.6)", () => {
  test("admin bisa membuka invoice pembeli mana pun", async ({ context, page }) => {
    const id = await digitalOrder();
    await context.clearCookies();
    await context.addCookies([admin]);
    expect((await page.goto(`/invoice/${id}`))!.status()).toBe(200);
    await expect(page.getByTestId("nomor-invoice")).toBeVisible();
  });

  test("pembeli lain, id tidak ada, dan id ngawur: halaman 404 yang sama", async ({ context, page }) => {
    const id = await digitalOrder();
    await context.clearCookies();
    await context.addCookies([await buyerCookie()]);
    const texts: string[] = [];
    for (const target of [id, "00000000-0000-0000-0000-000000000000", "ngawur"]) {
      const res = await page.goto(`/invoice/${target}`);
      expect(res!.status(), target).toBe(404);
      await expect(page.getByText("Invoice tidak ditemukan.")).toBeVisible();
      texts.push(await body(page).innerText());
    }
    expect(new Set(texts).size).toBe(1); // tidak membocorkan apakah invoice itu ada
  });

  test("tanpa login mengarah ke halaman masuk", async ({ browser }) => {
    const id = await digitalOrder();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/invoice/${id}`);
    await expect(page).toHaveURL(/\/masuk/);
  });
});

test.describe("cetak (F6.4, DESIGN §6)", () => {
  test("tombol cetak memanggil fitur cetak browser", async ({ page }) => {
    const id = await digitalOrder();
    await page.goto(`/invoice/${id}`);
    await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
    await page.getByRole("button", { name: "Cetak / Simpan sebagai PDF" }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  });

  test("tampilan layar: dokumen putih selebar maksimal 800 px di atas latar toko", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/invoice/${await digitalOrder()}`);
    const doc = page.getByTestId("dokumen");
    expect((await doc.boundingBox())!.width).toBeLessThanOrEqual(800);
    expect(await doc.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
    await expect(page.getByRole("link", { name: "Hayatun" })).toBeVisible(); // bar atas toko
  });

  test("versi cetak: tanpa bar atas dan tombol, latar putih, teks arang, nama toko rose tua", async ({ page }) => {
    await page.goto(`/invoice/${await digitalOrder()}`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "Cetak / Simpan sebagai PDF" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Hayatun" })).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    const doc = page.getByTestId("dokumen");
    expect(await doc.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(24, 24, 27)"); // ink #18181B
    expect(await page.getByTestId("nama-toko").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(157, 23, 77)"); // brand #9D174D
    expect(await doc.evaluate((e) => getComputedStyle(e).boxShadow)).toBe("none");
  });
});

test.describe("aksesibilitas invoice (N11–N16)", () => {
  for (const width of WIDTHS) {
    test(`@${width}px: lolos WCAG 2.1 AA, tanpa gulir ke samping`, async ({ page }) => {
      const id = await mixedOrder();
      await page.setViewportSize({ width, height: 800 });
      expect((await page.goto(`/invoice/${id}`))!.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test("HP: angka dan kata di tabel tidak terpotong di tengah", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/invoice/${await mixedOrder()}`);
    for (const cell of await page.locator(".invoice-table td.num").all()) {
      expect(await cell.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap"); // "Rp75.000" tetap satu baris
    }
    for (const cell of await page.locator(".invoice-table th, .invoice-table td").all()) {
      expect(await cell.evaluate((e) => getComputedStyle(e).overflowWrap)).toBe("normal"); // kata hanya patah di spasi
    }
  });

  test("HP: tombol cetak berukuran sentuh minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/invoice/${await digitalOrder()}`);
    const box = (await page.getByRole("button", { name: "Cetak / Simpan sebagai PDF" }).boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  });
});
