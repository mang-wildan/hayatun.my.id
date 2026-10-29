import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADDRESS, addProductFile, adminApi, adminCookie, buyerCookie, dropReservedCodes, expireOrderNow, patchOrder, PNG_1X1, resetProducts, seedProduct, setOrderStatus, setSetting, uploadProofApi, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3000, 7)]);
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  buyer = await buyerCookie();
  await context.addCookies([buyer]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setSetting("bankAccount", BANK);
});

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 7)}`;
const pay = async (id: string, who = buyer) => { await uploadProofApi(who, id, PNG_1X1, "image/png"); };
const accept = (id: string) => adminApi(admin, "POST", `/api/admin/payments/${id}/accept`);

// pesanan digital: file ebook.pdf + tautan "Unduh"; opsional kode lisensi
async function digitalOrder(opts: { paid?: boolean; licenses?: string; drop?: boolean; name?: string; who?: typeof buyer } = {}) {
  const who = opts.who ?? buyer;
  const name = opts.name ?? uniq("E-book Pesanan");
  const p = await seedProduct(admin, { name, price: 75000, ...(opts.licenses && { isLicensed: true, licenses: opts.licenses }) });
  await addProductFile(admin, p.id, PDF, "ebook.pdf");
  await userApi(who, "POST", "/api/cart/items", { productId: p.id });
  const id = (await userApi(who, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
  if (opts.paid !== false) {
    await pay(id, who);
    if (opts.drop) await dropReservedCodes(p.id);
    await accept(id);
  }
  return { id, name, productId: p.id };
}
// e-book Rp75.000 + 2 nastar Rp120.000 + ongkir SiCepat REG Rp15.000 = Rp330.000
async function mixedOrder(paid = true) {
  const d = await seedProduct(admin, { name: uniq("E-book Campuran"), price: 75000 });
  const f = await seedProduct(admin, { name: uniq("Nastar Campuran"), type: "physical", price: 120000, stockQty: 10 });
  await userApi(buyer, "POST", "/api/cart/items", { productId: d.id });
  await userApi(buyer, "POST", "/api/cart/items", { productId: f.id, qty: 2 });
  const address = await userApi(buyer, "POST", "/api/addresses", ADDRESS);
  const id = (await userApi(buyer, "POST", "/api/checkout", { addressId: address.id, courier: "SiCepat", service: "REG", expectedTotal: 330000 })).orderId as string;
  if (paid) { await pay(id); await accept(id); }
  return id;
}

const open = async (page: Page, id: string) => { expect((await page.goto(`/pesanan/${id}`))!.status()).toBe(200); };
const timeline = (page: Page) => page.getByRole("list", { name: "Garis waktu pesanan" });
const steps = (page: Page) => timeline(page).getByRole("listitem");
const labels = async (page: Page) => (await steps(page).allInnerTexts()).map((t) => t.replace(/\s*\(sekarang\)\s*$/i, "").trim());
const current = (page: Page) => timeline(page).locator('[aria-current="step"]');
const digital = (page: Page) => page.getByRole("region", { name: "Digital" });
const physical = (page: Page) => page.getByRole("region", { name: "Fisik" });

test.describe("daftar pesanan (F6)", () => {
  test("terbaru dulu: nomor invoice, tanggal, total, dan status; membuka detail", async ({ page }) => {
    const a = await digitalOrder({ paid: false });
    const b = await digitalOrder();
    const c = await mixedOrder(false);
    await page.goto("/pesanan");
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan saya" })).toBeVisible();
    const items = page.getByTestId("pesanan-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).getByRole("link")).toHaveAttribute("href", `/pesanan/${c}`);
    await expect(items.nth(1).getByRole("link")).toHaveAttribute("href", `/pesanan/${b.id}`);
    await expect(items.nth(2).getByRole("link")).toHaveAttribute("href", `/pesanan/${a.id}`);
    await expect(items.nth(0)).toContainText("Rp330.000");
    await expect(items.nth(0)).toContainText("Menunggu pembayaran");
    await expect(items.nth(1)).toContainText("Lunas");
    await expect(items.nth(1)).toContainText(/\d{1,2} \p{L}{3} \d{4}/u);
    await expect(items.nth(1).getByRole("link")).toHaveText(/^INV\/\d{4}\/\d{2}\/\d{4,}$/);
    expect(await items.nth(1).getByRole("link").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
    await items.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/pesanan/${b.id}$`));
  });

  test("belum punya pesanan: pesan kosong dan tautan ke produk", async ({ page }) => {
    await page.goto("/pesanan");
    await expect(page.getByText("Belum ada pesanan. Yuk, lihat produknya.")).toBeVisible();
    await expect(page.getByTestId("pesanan-item")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Lihat produk" })).toHaveAttribute("href", "/");
  });

  test("pesanan orang lain tidak tampil", async ({ page }) => {
    const other = await buyerCookie();
    await digitalOrder({ who: other, paid: false });
    await page.goto("/pesanan");
    await expect(page.getByTestId("pesanan-item")).toHaveCount(0);
  });

  test("menu atas punya tautan Pesanan untuk pembeli yang masuk", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Pesanan", exact: true }).click();
    await expect(page).toHaveURL(/\/pesanan$/);
  });

  test("tanpa masuk diarahkan ke halaman masuk", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    const page = await ctx.newPage();
    await page.goto("/pesanan");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });
});

test.describe("garis waktu (DESIGN)", () => {
  test("menunggu pembayaran, menunggu verifikasi, lalu lunas: langkah sekarang berpindah", async ({ page }) => {
    const o = await digitalOrder({ paid: false });
    await open(page, o.id);
    expect(await labels(page)).toEqual(["Menunggu pembayaran", "Menunggu verifikasi", "Lunas"]);
    await expect(current(page)).toHaveText(/Menunggu pembayaran/);
    await pay(o.id);
    await open(page, o.id);
    await expect(current(page)).toHaveText(/Menunggu verifikasi/);
    await accept(o.id);
    await open(page, o.id);
    await expect(current(page)).toHaveText(/Lunas/);
  });

  test("kedaluwarsa: langkah akhir Kedaluwarsa, tanpa langkah Lunas", async ({ page }) => {
    const o = await digitalOrder({ paid: false });
    await expireOrderNow(o.id);
    await setOrderStatus(o.id, "KEDALUWARSA");
    await open(page, o.id);
    expect(await labels(page)).toEqual(["Menunggu pembayaran", "Kedaluwarsa"]);
    await expect(current(page)).toHaveText(/Kedaluwarsa/);
  });

  test("dibatalkan sebelum bayar dan sesudah lunas punya langkah berbeda", async ({ page }) => {
    const unpaid = await digitalOrder({ paid: false });
    await setOrderStatus(unpaid.id, "DIBATALKAN");
    await open(page, unpaid.id);
    expect(await labels(page)).toEqual(["Menunggu pembayaran", "Dibatalkan"]);
    const paid = await digitalOrder();
    await patchOrder(paid.id, { status: "DIKEMBALIKAN", digital_status: "DICABUT" });
    await open(page, paid.id);
    expect(await labels(page)).toEqual(["Menunggu pembayaran", "Menunggu verifikasi", "Lunas", "Dikembalikan"]);
    await expect(current(page)).toHaveText(/Dikembalikan/);
  });

  test("status tidak disampaikan lewat warna saja: langkah sekarang punya teks penanda", async ({ page }) => {
    const o = await digitalOrder();
    await open(page, o.id);
    await expect(current(page)).toContainText("(sekarang)");
  });
});

test.describe("bagian digital (F7)", () => {
  test("pesanan lunas: status Terkirim, rincian barang, dan hanya bagian Digital", async ({ page }) => {
    const o = await digitalOrder({ name: "E-book Rincian" });
    await open(page, o.id);
    await expect(digital(page).getByTestId("status-digital")).toHaveText("Terkirim");
    await expect(physical(page)).toHaveCount(0);
    await expect(page.getByTestId("barang")).toContainText("E-book Rincian");
    await expect(page.getByTestId("barang")).toContainText("Rp75.000");
  });

  test("Unduh menghasilkan file dengan isi yang sama persis", async ({ page }) => {
    const o = await digitalOrder();
    await open(page, o.id);
    const [download] = await Promise.all([page.waitForEvent("download"), digital(page).getByRole("button", { name: "Unduh ebook.pdf" }).click()]);
    expect(download.suggestedFilename()).toBe("ebook.pdf");
    const { readFile } = await import("node:fs/promises");
    expect(Buffer.compare(await readFile((await download.path())!), PDF)).toBe(0);
    await expect(page).toHaveURL(new RegExp(`/pesanan/${o.id}$`)); // tetap di halaman
    // dan bisa diunduh lagi, tanpa batas (F7.2)
    const [again] = await Promise.all([page.waitForEvent("download"), digital(page).getByRole("button", { name: "Unduh ebook.pdf" }).click()]);
    expect(again.suggestedFilename()).toBe("ebook.pdf");
  });

  test("tautan eksternal dibuka di tab baru", async ({ page }) => {
    const o = await digitalOrder();
    await open(page, o.id);
    const link = digital(page).getByRole("link", { name: "Buka tautan Unduh" });
    await expect(link).toHaveAttribute("href", "https://contoh.id/unduh");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("kode lisensi tampil dengan huruf mono dan bisa disalin", async ({ page }) => {
    const o = await digitalOrder({ licenses: "KODE-AAA-111" });
    await open(page, o.id);
    const code = digital(page).getByTestId("kode-lisensi");
    await expect(code).toHaveText("KODE-AAA-111");
    expect(await code.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
    await digital(page).getByRole("button", { name: "Salin kode lisensi KODE-AAA-111" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("KODE-AAA-111");
    await expect(digital(page).getByText("Tersalin")).toBeVisible();
  });

  test("lisensi tertunda: status dan pesan menyusul; kode muncul setelah admin menambah stok", async ({ page }) => {
    const o = await digitalOrder({ licenses: "KODE-ASLI", drop: true });
    await open(page, o.id);
    await expect(digital(page).getByTestId("status-digital")).toHaveText("Lisensi tertunda");
    await expect(digital(page)).toContainText("Kode lisensi menyusul, kami kabari lewat email.");
    await expect(digital(page).getByTestId("kode-lisensi")).toHaveCount(0);
    await adminApi(admin, "POST", `/api/admin/products/${o.productId}/licenses`, { codes: "KODE-BARU-1" });
    await open(page, o.id);
    await expect(digital(page).getByTestId("status-digital")).toHaveText("Terkirim");
    await expect(digital(page).getByTestId("kode-lisensi")).toHaveText("KODE-BARU-1");
    await expect(digital(page)).not.toContainText("menyusul");
  });

  test("akses dicabut: tanpa tombol unduh dan tanpa kode, dengan penjelasan", async ({ page }) => {
    const o = await digitalOrder({ licenses: "KODE-RAHASIA" });
    await patchOrder(o.id, { status: "DIBATALKAN", digital_status: "DICABUT" });
    await open(page, o.id);
    await expect(digital(page).getByTestId("status-digital")).toHaveText("Akses dicabut");
    await expect(digital(page)).toContainText("Akses unduhan dicabut.");
    await expect(digital(page).getByRole("button", { name: /Unduh/ })).toHaveCount(0);
    await expect(page.getByText("KODE-RAHASIA")).toHaveCount(0);
  });

  test("pesanan belum lunas tidak menampilkan bagian digital", async ({ page }) => {
    const o = await digitalOrder({ paid: false });
    await open(page, o.id);
    await expect(digital(page)).toHaveCount(0);
  });
});

test.describe("bagian fisik (F8)", () => {
  test("Diproses: ekspedisi dan layanan, nomor resi belum ada; tanpa alamat dan kontak", async ({ page }) => {
    const id = await mixedOrder();
    await open(page, id);
    await expect(physical(page).getByTestId("status-fisik")).toHaveText("Diproses");
    await expect(physical(page)).toContainText("SiCepat REG");
    await expect(physical(page)).toContainText("Nomor resi belum ada.");
    await expect(physical(page).getByTestId("nomor-resi")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/Pajajaran|81234567890|Cicendo/);
    expect(await current(page).count()).toBe(1); // garis waktu pembayaran tidak ikut memuat langkah kirim
    await expect(physical(page).getByRole("list", { name: "Tahap pengiriman" }).locator('[aria-current="step"]')).toHaveText(/Diproses/);
  });

  test("Dikirim: nomor resi mono dan bisa disalin; Diterima: langkah akhir", async ({ page }) => {
    const id = await mixedOrder();
    await patchOrder(id, { physical_status: "DIKIRIM", tracking_number: "SCP1234567890" });
    await open(page, id);
    await expect(physical(page).getByTestId("status-fisik")).toHaveText("Dikirim");
    const resi = physical(page).getByTestId("nomor-resi");
    await expect(resi).toHaveText("SCP1234567890");
    expect(await resi.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
    await physical(page).getByRole("button", { name: "Salin nomor resi" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SCP1234567890");
    await expect(physical(page).getByRole("list", { name: "Tahap pengiriman" }).locator('[aria-current="step"]')).toHaveText(/Dikirim/);
    await patchOrder(id, { physical_status: "DITERIMA" });
    await open(page, id);
    await expect(physical(page).getByTestId("status-fisik")).toHaveText("Diterima");
    await expect(physical(page).getByRole("list", { name: "Tahap pengiriman" }).locator('[aria-current="step"]')).toHaveText(/Diterima/);
  });

  test("pesanan campuran: bagian Digital dan Fisik terpisah, masing-masing dengan statusnya", async ({ page }) => {
    const id = await mixedOrder();
    await open(page, id);
    await expect(digital(page).getByTestId("status-digital")).toHaveText("Terkirim");
    await expect(physical(page).getByTestId("status-fisik")).toHaveText("Diproses");
    await expect(digital(page).getByRole("link", { name: "Buka tautan Unduh" })).toBeVisible(); // produk campuran hanya berisi tautan
    await expect(page.getByTestId("barang")).toContainText("Rp330.000");
  });
});

test.describe("akses", () => {
  test("pesanan orang lain: halaman tidak ditemukan", async ({ page }) => {
    const other = await buyerCookie();
    const o = await digitalOrder({ who: other, paid: false });
    expect((await page.goto(`/pesanan/${o.id}`))!.status()).toBe(404);
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: daftar, detail lunas campuran dengan lisensi dan resi, dan detail menunggu`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const waiting = await digitalOrder({ paid: false });
      const lic = await digitalOrder({ licenses: "KODE-A11Y-1" });
      const id = await mixedOrder();
      await patchOrder(id, { physical_status: "DIKIRIM", tracking_number: "SCP1234567890" });
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/pesanan");
      await expect(page.getByTestId("pesanan-item").first()).toBeVisible();
      await scan();
      await open(page, id); await scan();
      await open(page, lic.id); await scan();
      await open(page, waiting.id); await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; tombol Unduh dan Salin minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const o = await digitalOrder({ licenses: "KODE-PANJANG-SEKALI-UNTUK-MENGUJI-PEMBUNGKUSAN-TEKS-0123456789", name: "Nama produk yang sangat panjang supaya rincian pesanan harus membungkus dengan benar" });
    await open(page, o.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.goto("/pesanan");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await open(page, o.id);
    for (const l of [digital(page).getByRole("button", { name: "Unduh ebook.pdf" }), digital(page).getByRole("button", { name: /^Salin kode lisensi/ })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("keyboard: Tab ke tombol Unduh dan Enter mengunduh (N14)", async ({ page }) => {
    const o = await digitalOrder();
    await open(page, o.id);
    const btn = digital(page).getByRole("button", { name: "Unduh ebook.pdf" });
    await btn.focus();
    await expect(btn).toBeFocused();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(download.suggestedFilename()).toBe("ebook.pdf");
  });
});
