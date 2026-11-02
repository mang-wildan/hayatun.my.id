import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, buyerCookie, countOrders, resetProducts, seedProduct, userApi } from "./helpers";

// T64 (F14.1): memilih bayar online di langkah Bayar. Gateway di sini tiruan milik API (PAYMENT_GATEWAY_PROVIDER=fake, tautan https://gateway.fake.test/...);
// peramban dicegat supaya tidak benar-benar keluar. Tiruan menolak nominal di bawah Rp1.000 seperti batas minimum gateway sungguhan.
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const GATEWAY_HOST = /^https:\/\/gateway\.fake\.test\/pay\//;

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context, page }) => {
  buyer = await buyerCookie();
  await context.addCookies([buyer]);
  await page.route("https://gateway.fake.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Gateway tiruan</title><h1>Gateway tiruan</h1>" }));
});

async function cartWith(name: string, price: number) {
  const p = await seedProduct(admin, { name, price });
  await userApi(buyer, "POST", "/api/cart/items", { productId: p.id });
}
const choose = (page: Page, name: string | RegExp) => page.getByRole("radio", { name }).check();
const orderIds = async () => ((await userApi(buyer, "GET", "/api/orders")) as { orders: { orderId: string }[] }).orders.map((o) => o.orderId);

test("langkah Bayar menawarkan Transfer bank (terpilih) dan Bayar online; lolos axe di 360 dan 1280 px", async ({ page }) => {
  await cartWith("E-book Pilih Cara Bayar", 75000);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/checkout/bayar");
    const group = page.getByRole("group", { name: "Cara bayar" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(group.getByRole("radio", { name: "Transfer bank" })).toBeChecked();
    await expect(group.getByRole("radio", { name: /Bayar online/ })).not.toBeChecked();
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations, `${width}px`).toEqual([]);
  }
});

test("bayar online: pesanan dibuat dan pembeli diarahkan ke gateway; halaman pesanan menawarkan lanjut bayar tanpa rekening dan tanpa unggah bukti", async ({ page }) => {
  await cartWith("E-book Bayar Online", 75000);
  const before = await countOrders();
  await page.goto("/checkout/bayar");
  await choose(page, /Bayar online/);
  await page.getByRole("button", { name: "Buat pesanan" }).click();
  await page.waitForURL(GATEWAY_HOST);
  await expect(page.getByRole("heading", { name: "Gateway tiruan" })).toBeVisible();
  expect(await countOrders()).toBe(before + 1);

  const [orderId] = await orderIds();
  const gatewayUrl = page.url();
  await page.goto(`/pesanan/${orderId}`);
  await expect(page.getByTestId("total")).toHaveText("Rp75.000");
  await expect(page.getByRole("link", { name: "Lanjut bayar online" })).toHaveAttribute("href", gatewayUrl);
  await expect(page.getByRole("heading", { name: "Rekening tujuan" })).toHaveCount(0);
  await expect(page.getByLabel(/bukti/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Batalkan pesanan" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations).toEqual([]);
});

test("gateway menolak: pesanan tetap ada, pesan jelas, tombol Coba lagi, dan pesanan tetap bisa dibatalkan", async ({ page }) => {
  await cartWith("E-book Nominal Kecil", 900); // di bawah minimum tiruan
  await page.goto("/checkout/bayar");
  await choose(page, /Bayar online/);
  await page.getByRole("button", { name: "Buat pesanan" }).click();
  await expect(page).toHaveURL(/\/pesanan\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Pembayaran online belum bisa dibuka")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lanjut bayar online" })).toHaveCount(0);
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pembayaran online belum bisa dibuka" })).toBeVisible(); // masih ditolak, pesan tampil lagi
  await page.getByRole("button", { name: "Batalkan pesanan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ya, batalkan/ }).click();
  await expect(page.getByText("Dibatalkan").first()).toBeVisible();
});

test("tanpa menyentuh pilihan: pesanan manual dengan rekening dan unggah bukti, tanpa tautan gateway", async ({ page }) => {
  await cartWith("E-book Tetap Manual", 75000);
  await page.goto("/checkout/bayar");
  await page.getByRole("button", { name: "Buat pesanan" }).click();
  await expect(page).toHaveURL(/\/pesanan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Rekening tujuan" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lanjut bayar online" })).toHaveCount(0);
});
