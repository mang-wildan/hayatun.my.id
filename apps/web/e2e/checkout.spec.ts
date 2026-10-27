import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADDRESS, adminApi, adminCookie, buyerCookie, countOrders, resetProducts, seedProduct, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const INVOICE_NO = /^INV\/\d{4}\/\d{2}\/\d{4,}$/;

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  buyer = await buyerCookie(); // pembeli baru di setiap tes, jadi keranjang dan alamat mulai kosong
  await context.addCookies([buyer]);
});

const cartAdd = (productId: string, qty = 1) => userApi(buyer, "POST", "/api/cart/items", { productId, qty });
const newDigital = (name: string, price = 75000) => seedProduct(admin, { name, price });
const newPhysical = (name: string, over: { price?: number; stockQty?: number } = {}) => seedProduct(admin, { name, type: "physical", price: over.price ?? 120000, stockQty: over.stockQty ?? 10 });
const totalText = (page: Page) => page.getByTestId("total");

async function fillAddress(page: Page, over: Partial<typeof ADDRESS> = {}) {
  const a = { ...ADDRESS, ...over };
  await page.getByLabel("Nama penerima").fill(a.recipient);
  await page.getByLabel("Nomor HP").fill(a.phone);
  await page.getByLabel("Alamat lengkap").fill(a.address);
  await page.getByLabel("Kecamatan").fill(a.areaId);
  await page.getByLabel("Kode pos").fill(a.postalCode);
}

test.describe("langkah dan layar", () => {
  test("tanpa login mengarah ke halaman masuk", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/checkout/bayar");
    await expect(page).toHaveURL(/\/masuk/);
  });

  test("keranjang kosong: kembali ke keranjang", async ({ page }) => {
    await page.goto("/checkout/bayar");
    await expect(page).toHaveURL(/\/keranjang$/);
    await page.goto("/checkout/pengiriman");
    await expect(page).toHaveURL(/\/keranjang$/);
  });

  test("keranjang digital: tanpa langkah Pengiriman; dari produk sampai pesanan dibuat dalam 4 layar", async ({ page }) => {
    const d = await newDigital("E-book Alur Digital");
    const visited: string[] = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });

    await page.goto(`/produk/${d.slug}`);
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await page.getByRole("link", { name: /^Keranjang/ }).click();
    await expect(page.getByRole("link", { name: "Lanjut bayar" })).toHaveAttribute("href", "/checkout/bayar");
    await page.getByRole("link", { name: "Lanjut bayar" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Bayar" })).toBeVisible();
    const steps = page.getByRole("list", { name: "Langkah checkout" });
    await expect(steps.getByRole("listitem")).toHaveText(["Keranjang", "Bayar"]);
    await expect(steps.getByRole("listitem").last()).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("E-book Alur Digital")).toBeVisible();
    await expect(totalText(page)).toHaveText("Rp75.000");
    await expect(page.getByText(/Ongkir/)).toHaveCount(0);

    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page).toHaveURL(/\/pesanan\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    await expect(page.getByTestId("nomor-invoice")).toHaveText(INVOICE_NO);
    await expect(page.getByTestId("total")).toHaveText("Rp75.000");
    await expect(page.getByRole("link", { name: "Lihat invoice" })).toHaveAttribute("href", /^\/invoice\/[0-9a-f-]{36}$/);

    expect(visited.filter((p, i) => p !== visited[i - 1]).length).toBeLessThanOrEqual(5); // N8
    await page.goto("/keranjang");
    await expect(page.getByText("Keranjangmu masih kosong.")).toBeVisible();
  });

  test("keranjang campuran dengan alamat baru: 5 layar dari produk sampai pesanan dibuat (N8)", async ({ page }) => {
    const d = await newDigital("E-book Campur Checkout", 75000);
    const f = await newPhysical("Nastar Campur Checkout", { price: 120000 });
    const visited: string[] = [];
    page.on("framenavigated", (fr) => { if (fr === page.mainFrame()) visited.push(new URL(fr.url()).pathname); });

    await cartAdd(d.id);
    await page.goto(`/produk/${f.slug}`);
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await page.getByRole("link", { name: /^Keranjang/ }).click();
    await expect(page.getByRole("link", { name: "Lanjut bayar" })).toHaveAttribute("href", "/checkout/pengiriman");
    await page.getByRole("link", { name: "Lanjut bayar" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Pengiriman" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Langkah checkout" }).getByRole("listitem")).toHaveText(["Keranjang", "Pengiriman", "Bayar"]);
    const next = page.getByRole("button", { name: "Lanjut" });
    await fillAddress(page);
    await page.getByRole("button", { name: "Simpan alamat" }).click();
    await expect(page.getByRole("radio", { name: /Budi Santoso/ })).toBeChecked();

    const services = page.getByRole("group", { name: "Layanan pengiriman" });
    await expect(services.getByRole("radio")).toHaveCount(2);
    await expect(services.getByRole("radio").first()).toHaveAccessibleName("SiCepat REG · 1-2 hari · Rp15.000"); // termurah dulu
    await expect(services.getByRole("radio").last()).toHaveAccessibleName("JNE REG · 2-3 hari · Rp18.000");
    await expect(next).toBeDisabled(); // belum memilih layanan
    await services.getByRole("radio").first().check();
    await next.click();

    await expect(page).toHaveURL(/\/checkout\/bayar\?/);
    await expect(page.getByText("Dikirim ke Budi Santoso")).toBeVisible();
    await expect(page.getByTestId("ongkir")).toHaveText("Rp15.000");
    await expect(totalText(page)).toHaveText("Rp210.000"); // 75.000 + 120.000 + 15.000
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    await expect(page.getByTestId("total")).toHaveText("Rp210.000");

    const screens = visited.filter((p, i) => p !== visited[i - 1]).map((p) => p.replace(/[0-9a-f-]{36}/, ":id"));
    expect(screens).toEqual([`/produk/${f.slug}`, "/keranjang", "/checkout/pengiriman", "/checkout/bayar", "/pesanan/:id"]);
  });
});

test.describe("pengiriman", () => {
  test("alamat tersimpan dipakai langsung; form alamat baru hanya muncul bila diminta", async ({ page }) => {
    const f = await newPhysical("Nastar Alamat Tersimpan");
    await cartAdd(f.id);
    await userApi(buyer, "POST", "/api/addresses", ADDRESS);
    await userApi(buyer, "POST", "/api/addresses", { ...ADDRESS, recipient: "Siti Aminah" });
    await page.goto("/checkout/pengiriman");
    await expect(page.getByLabel("Nama penerima")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /Budi Santoso/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Siti Aminah/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Layanan pengiriman" })).toHaveCount(0); // belum memilih alamat
    await page.getByRole("radio", { name: /Siti Aminah/ }).check();
    await expect(page.getByRole("group", { name: "Layanan pengiriman" }).getByRole("radio")).toHaveCount(2);
    await page.getByRole("button", { name: "Tambah alamat baru" }).click();
    await expect(page.getByLabel("Nama penerima")).toBeVisible();
  });

  test("kesalahan isian tampil tepat di bawah kolomnya", async ({ page }) => {
    const f = await newPhysical("Nastar Validasi Alamat");
    await cartAdd(f.id);
    await page.goto("/checkout/pengiriman");
    await page.getByRole("button", { name: "Simpan alamat" }).click();
    const name = page.getByLabel("Nama penerima");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription("Nama penerima diisi dulu ya.");
    await fillAddress(page, { postalCode: "4017", phone: "12345" });
    await page.getByRole("button", { name: "Simpan alamat" }).click();
    await expect(page.getByLabel("Kode pos")).toHaveAccessibleDescription("Kode pos terdiri dari 5 angka.");
    await expect(page.getByLabel("Nomor HP")).toHaveAccessibleDescription("Format nomor HP belum benar. Contoh: 081234567890.");
  });

  test("keranjang digital tidak diminta alamat: langsung diarahkan ke Bayar", async ({ page }) => {
    const d = await newDigital("E-book Tanpa Alamat");
    await cartAdd(d.id);
    await page.goto("/checkout/pengiriman");
    await expect(page).toHaveURL(/\/checkout\/bayar$/);
    await expect(page.getByLabel("Nama penerima")).toHaveCount(0);
  });

  test("Bayar untuk produk fisik tanpa alamat dan layanan: kembali ke Pengiriman", async ({ page }) => {
    const f = await newPhysical("Nastar Tanpa Pilihan");
    await cartAdd(f.id);
    await page.goto("/checkout/bayar");
    await expect(page).toHaveURL(/\/checkout\/pengiriman/);
  });
});

test.describe("keranjang menuju checkout", () => {
  test("item bermasalah: tombol Lanjut bayar tidak aktif", async ({ page }) => {
    const d = await newDigital("E-book Ditarik Checkout");
    await cartAdd(d.id);
    await adminApi(admin, "POST", `/api/admin/products/${d.id}/deactivate`);
    await page.goto("/keranjang");
    await expect(page.getByRole("button", { name: "Lanjut bayar" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Lanjut bayar" })).toHaveCount(0);
  });

  test("HP: tombol Lanjut bayar menempel di bawah layar walau keranjang panjang", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    for (let i = 0; i < 6; i++) await cartAdd((await newDigital(`E-book Panjang ${i}`)).id);
    await page.goto("/keranjang");
    const go = page.getByRole("link", { name: "Lanjut bayar" });
    await expect(go).toBeInViewport({ ratio: 1 });
    await page.mouse.wheel(0, 3000);
    await expect(go).toBeInViewport({ ratio: 1 });
  });
});

test.describe("membuat pesanan", () => {
  test("total berubah sejak dilihat: pembeli diberi tahu dan melihat total baru", async ({ page }) => {
    const d = await newDigital("E-book Harga Berubah", 75000);
    await cartAdd(d.id);
    await page.goto("/checkout/bayar");
    await expect(totalText(page)).toHaveText("Rp75.000");
    await adminApi(admin, "PATCH", `/api/admin/products/${d.id}`, { price: 80000 });
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Totalnya berubah sejak kamu lihat. Cek lagi rinciannya ya." })).toBeVisible();
    await expect(totalText(page)).toHaveText("Rp80.000");
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    await expect(page.getByTestId("total")).toHaveText("Rp80.000");
  });

  test("stok habis di antara keranjang dan konfirmasi: item disebut, tidak ada pesanan sebagian", async ({ page }) => {
    const f = await newPhysical("Nastar Keburu Habis", { stockQty: 5 });
    await cartAdd(f.id, 2);
    await userApi(buyer, "POST", "/api/addresses", ADDRESS);
    await page.goto("/checkout/pengiriman");
    await page.getByRole("radio", { name: /Budi Santoso/ }).check();
    await page.getByRole("group", { name: "Layanan pengiriman" }).getByRole("radio").first().check();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("button", { name: "Buat pesanan" })).toBeVisible();
    const before = await countOrders();
    await adminApi(admin, "PATCH", `/api/admin/products/${f.id}`, { stockQty: 1 });
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Ada item yang tidak bisa dibeli. Cek keranjangmu dulu ya." });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Nastar Keburu Habis");
    await expect(page.getByRole("link", { name: "Kembali ke keranjang" })).toHaveAttribute("href", "/keranjang");
    expect(await countOrders()).toBe(before);
  });

  test("email belum terverifikasi: pesannya jelas dan tombol buat pesanan tidak ada", async ({ page, context }) => {
    const d = await newDigital("E-book Belum Verifikasi");
    const unverified = await buyerCookie(undefined, { verified: false });
    await context.clearCookies();
    await context.addCookies([unverified]);
    await userApi(unverified, "POST", "/api/cart/items", { productId: d.id });
    await page.goto("/checkout/bayar");
    await expect(page.getByRole("alert").filter({ hasText: "Verifikasi emailmu dulu ya sebelum checkout. Cek kotak masuk atau minta tautan baru." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat pesanan" })).toHaveCount(0);
  });

  test("ditekan dua kali dengan cepat: hanya satu pesanan", async ({ page }) => {
    const d = await newDigital("E-book Klik Ganda");
    await cartAdd(d.id);
    await page.goto("/checkout/bayar");
    const before = await countOrders();
    const button = page.getByRole("button", { name: "Buat pesanan" });
    await button.dblclick();
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    expect(await countOrders()).toBe(before + 1);
  });

  test("halaman pesanan milik orang lain: tidak ditemukan", async ({ page }) => {
    const d = await newDigital("E-book Milik Orang");
    const other = await buyerCookie();
    await userApi(other, "POST", "/api/cart/items", { productId: d.id });
    const order = await userApi(other, "POST", "/api/checkout", { expectedTotal: 75000 });
    const res = await page.goto(`/pesanan/${order.orderId}`);
    expect(res!.status()).toBe(404);
    await expect(page.getByText("Pesanan tidak ditemukan.")).toBeVisible();
  });
});

async function axeAtAllWidths(page: Page, path: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    expect((await page.goto(path))!.status(), `${path} @${width}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations, `${path} @${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} @${width}`).toBeLessThanOrEqual(width);
  }
}

test.describe("aksesibilitas checkout (N11–N16)", () => {
  let bayarPath: string;
  test.beforeEach(async () => {
    await cartAdd((await newDigital("E-book A11y Checkout")).id);
    await cartAdd((await newPhysical("Kue A11y Checkout Dengan Nama Yang Cukup Panjang Supaya Membungkus")).id, 2);
    const address = await userApi(buyer, "POST", "/api/addresses", ADDRESS);
    bayarPath = `/checkout/bayar?alamat=${address.id}&kurir=SiCepat&layanan=REG`;
  });

  test("keranjang, pengiriman, dan bayar lolos WCAG 2.1 AA di tiga lebar layar, tanpa gulir ke samping", async ({ page }) => {
    for (const path of ["/keranjang", "/checkout/pengiriman", bayarPath]) await axeAtAllWidths(page, path);
  });

  test("HP: area sentuh minimal 44px di pengiriman dan bayar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ["/checkout/pengiriman", bayarPath]) {
      await page.goto(path);
      const targets = await page.locator("main button, main a, main input:not([type=radio]):not([type=checkbox]), main textarea, header a").all();
      expect(targets.length, path).toBeGreaterThan(2);
      for (const el of targets) {
        if (!(await el.isVisible())) continue;
        const box = (await el.boundingBox())!;
        expect(Math.min(box.width, box.height), `${path} ${await el.evaluate((e) => e.outerHTML.slice(0, 80))}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

test("halaman pesanan dibuat lolos WCAG 2.1 AA di tiga lebar layar", async ({ page }) => {
  await cartAdd((await newDigital("E-book A11y Selesai")).id);
  const order = await userApi(buyer, "POST", "/api/checkout", { expectedTotal: 75000 });
  await axeAtAllWidths(page, `/pesanan/${order.orderId}`);
});
