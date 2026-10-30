import { expect, test, type Page } from "@playwright/test";
import { adminCookie, buyerCookie, clearQueue, orderStatusOf, PNG_1X1, resetProducts, seedProduct, setSetting, ADDRESS, uploadProofApi, userApi } from "./helpers";

// N8: pembelian dari halaman produk sampai instruksi bayar ≤ 5 layar dan ≤ 5 menit.
// N9: memverifikasi satu bukti dari antrean ≤ 3 klik dan ≤ 1 menit.
// Bagian otomatis dari T53; uji dengan 5 orang sungguhan ada di docs/uji-kegunaan.md.
const MAX_SCREENS = 5;
const MAX_CLICKS = 3;
const BUYER_BUDGET_MS = 5 * 60_000;
const ADMIN_BUDGET_MS = 60_000;
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };

let admin: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.afterAll(async () => { await resetProducts(); });
test.beforeEach(async () => {
  await clearQueue();
  await setSetting("bankAccount", BANK);
});

// Klik asli pengguna (bukan klik skrip), dihitung lintas navigasi lewat sessionStorage
async function countClicks(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("click", (e) => { if (e.isTrusted) sessionStorage.setItem("klik", String(Number(sessionStorage.getItem("klik") ?? 0) + 1)); }, true);
  });
}
const clicks = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem("klik") ?? 0));

const screensOf = (visited: string[]) => visited.filter((p, i) => p !== visited[i - 1]).map((p) => p.replace(/[0-9a-f-]{36}/, ":id"));
function trackScreens(page: Page) {
  const visited: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
  return visited;
}

test.describe("pembeli: dari halaman produk sampai instruksi bayar (N8)", () => {
  test("produk digital: ≤ 5 layar dan ≤ 5 menit", async ({ page, context }) => {
    await context.addCookies([await buyerCookie()]);
    const d = await seedProduct(admin, { name: "E-book Kegunaan Digital" });
    const visited = trackScreens(page);
    const t0 = Date.now();
    await page.goto(`/produk/${d.slug}`);
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await page.getByRole("link", { name: /^Keranjang/ }).click();
    await page.getByRole("link", { name: "Lanjut bayar" }).click();
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    await expect(page.getByTestId("nomor-rekening")).toBeVisible(); // instruksi bayar sudah tampil
    expect(Date.now() - t0).toBeLessThan(BUYER_BUDGET_MS);
    expect(screensOf(visited).length).toBeLessThanOrEqual(MAX_SCREENS);
  });

  test("produk fisik (dengan alamat dan pengiriman): tetap ≤ 5 layar dan ≤ 5 menit", async ({ page, context }) => {
    await context.addCookies([await buyerCookie()]);
    const f = await seedProduct(admin, { name: "Nastar Kegunaan", type: "physical", price: 120000, stockQty: 10 });
    const visited = trackScreens(page);
    const t0 = Date.now();
    await page.goto(`/produk/${f.slug}`);
    await page.getByRole("button", { name: "Masukkan keranjang" }).click();
    await page.getByRole("link", { name: /^Keranjang/ }).click();
    await page.getByRole("link", { name: "Lanjut bayar" }).click();
    await page.getByLabel("Nama penerima").fill(ADDRESS.recipient);
    await page.getByLabel("Nomor HP").fill(ADDRESS.phone);
    await page.getByLabel("Alamat lengkap").fill(ADDRESS.address);
    await page.getByLabel("Kecamatan").fill(ADDRESS.areaId);
    await page.getByLabel("Kode pos").fill(ADDRESS.postalCode);
    await page.getByRole("button", { name: "Simpan alamat" }).click();
    await page.getByRole("group", { name: "Layanan pengiriman" }).getByRole("radio").first().check();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("button", { name: "Buat pesanan" }).click();
    await expect(page.getByTestId("nomor-rekening")).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(BUYER_BUDGET_MS);
    expect(screensOf(visited)).toEqual([`/produk/${f.slug}`, "/keranjang", "/checkout/pengiriman", "/checkout/bayar", "/pesanan/:id"]);
  });
});

test.describe("admin: memverifikasi satu bukti dari antrean (N9)", () => {
  async function queued() {
    const b = await buyerCookie();
    const p = await seedProduct(admin, { name: `E-book Antre ${Math.random().toString(36).slice(2, 7)}` });
    await userApi(b, "POST", "/api/cart/items", { productId: p.id });
    const orderId = (await userApi(b, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
    await uploadProofApi(b, orderId, PNG_1X1, "image/png");
    const { invoiceNumber } = await userApi(b, "GET", `/api/orders/${orderId}/payment`);
    return { orderId, invoiceNumber: invoiceNumber as string };
  }
  const open = async (page: Page, invoiceNumber: string) => {
    const row = page.getByTestId("antrean-item").filter({ hasText: invoiceNumber });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    await (wide ? row.getByRole("link", { name: invoiceNumber }) : row.getByRole("link", { name: "Periksa bukti" })).click();
    await expect(page.getByRole("region", { name: "Periksa bukti" })).toBeVisible();
  };

  for (const [label, size] of [["HP", { width: 360, height: 740 }], ["PC", { width: 1280, height: 800 }]] as const) {
    test(`terima @${label}: ≤ 3 klik dan ≤ 1 menit dari antrean`, async ({ page, context }) => {
      await context.addCookies([admin]);
      await page.setViewportSize(size);
      const o = await queued();
      await countClicks(page);
      await page.goto("/admin");
      const t0 = Date.now();
      await open(page, o.invoiceNumber);
      await page.getByRole("region", { name: "Periksa bukti" }).getByRole("button", { name: "Terima", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Ya, terima" }).click();
      await expect(page.getByRole("status").filter({ hasText: /diterima/ })).toBeVisible();
      expect(Date.now() - t0).toBeLessThan(ADMIN_BUDGET_MS);
      expect(await clicks(page)).toBeLessThanOrEqual(MAX_CLICKS);
      expect(await orderStatusOf(o.orderId)).toBe("LUNAS");
    });

    test(`tolak @${label}: alasan cukup diketik (kolom langsung terfokus), tetap ≤ 3 klik dan ≤ 1 menit`, async ({ page, context }) => {
      await context.addCookies([admin]);
      await page.setViewportSize(size);
      const o = await queued();
      await countClicks(page);
      await page.goto("/admin");
      const t0 = Date.now();
      await open(page, o.invoiceNumber);
      await page.getByRole("region", { name: "Periksa bukti" }).getByRole("button", { name: "Tolak", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.type("Foto buram, tolong unggah ulang"); // tanpa mengklik kolom alasan
      await expect(page.getByLabel("Alasan penolakan")).toHaveValue("Foto buram, tolong unggah ulang");
      await page.getByRole("dialog").getByRole("button", { name: "Ya, tolak" }).click();
      await expect(page.getByRole("status").filter({ hasText: /ditolak/ })).toBeVisible();
      expect(Date.now() - t0).toBeLessThan(ADMIN_BUDGET_MS);
      expect(await clicks(page)).toBeLessThanOrEqual(MAX_CLICKS);
      expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_PEMBAYARAN");
    });
  }
});
