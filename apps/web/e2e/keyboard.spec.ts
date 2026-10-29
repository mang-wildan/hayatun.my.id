import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADDRESS, adminCookie, buyerCookie, clearQueue, orderStatusOf, PNG_1X1, resetProducts, seedProduct, setSetting, uploadProofApi, userApi } from "./helpers";

// N14: checkout, unggah bukti, dan verifikasi admin selesai hanya dengan keyboard. Tidak ada klik, fill, check, atau setInputFiles;
// hanya Tab, Shift+Tab, Enter, Spasi, Esc, ketikan, dan pemilih file yang dibuka lewat Enter.
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const MAX_TAB = 80;

let admin: Awaited<ReturnType<typeof adminCookie>>;
let buyer: Awaited<ReturnType<typeof buyerCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.afterAll(async () => { await resetProducts(); }); // katalog kembali kosong untuk spec lain
test.beforeEach(async ({ context }) => {
  await clearQueue();
  await setSetting("bankAccount", BANK);
  buyer = await buyerCookie();
  await context.addCookies([buyer]);
});

// Penanda fokus harus terlihat (outline atau bayangan) pada elemen yang sedang fokus
async function expectFocusVisible(page: Page, what: string) {
  const ok = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as HTMLElement);
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "");
  });
  expect(ok, `penanda fokus pada ${what} terlihat`).toBe(true);
}
const isFocused = (l: Locator) => l.evaluate((el) => el === document.activeElement).catch(() => false);

// Tab maju sampai elemen itu fokus; gagal bila tak terjangkau dalam MAX_TAB langkah
async function tabTo(page: Page, target: Locator, what: string) {
  for (let i = 0; i <= MAX_TAB; i++) {
    if (await isFocused(target)) { await expectFocusVisible(page, what); return; }
    await page.keyboard.press("Tab");
  }
  throw new Error(`${what} tidak terjangkau dengan Tab dalam ${MAX_TAB} langkah`);
}
async function press(page: Page, target: Locator, what: string, key = "Enter") {
  await tabTo(page, target, what);
  await page.keyboard.press(key);
}
async function typeInto(page: Page, field: Locator, what: string, text: string) {
  await tabTo(page, field, what);
  await page.keyboard.type(text);
}

// Enter atau Spasi pada input file membuka pemilih file. Chromium headless kadang melewatkan satu tekanan, jadi dicoba bergantian.
async function openChooser(page: Page) {
  for (const key of ["Enter", "Space", "Enter", "Space"]) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null), page.keyboard.press(key)]);
    if (chooser) return chooser;
  }
  throw new Error("pemilih file tidak terbuka lewat Enter atau Spasi");
}

// Fokus tidak pernah mendarat di konten halaman di luar dialog (DESIGN §5). <dialog> modal bawaan boleh melepas fokus ke
// antarmuka browser setelah kontrol terakhir (activeElement jadi body), tetapi tidak ke tautan atau tombol di belakangnya.
async function expectTrapped(page: Page) {
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body), `Tab ke-${i + 1} tidak keluar ke konten di belakang dialog`).toBe(true);
  }
  // kembali ke dalam dialog dengan Shift+Tab bila fokus terlepas, supaya langkah berikutnya bisa lanjut
  for (let i = 0; i < 12 && !(await dialog.evaluate((d) => d.contains(document.activeElement))); i++) await page.keyboard.press("Shift+Tab");
}

const digital = (name: string, price = 75000) => seedProduct(admin, { name, price });

test.describe("checkout hanya dengan keyboard", () => {
  test("produk digital: dari halaman produk sampai pesanan dibuat", async ({ page }) => {
    const d = await digital("E-book Keyboard Digital");
    await page.goto(`/produk/${d.slug}`);
    await press(page, page.getByRole("button", { name: "Masukkan keranjang" }), "Masukkan keranjang");
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await press(page, page.getByRole("link", { name: /^Keranjang/ }), "tautan Keranjang");
    await expect(page.getByRole("heading", { level: 1, name: "Keranjang" })).toBeVisible();
    await press(page, page.getByRole("link", { name: "Lanjut bayar" }), "Lanjut bayar");
    await expect(page.getByRole("heading", { level: 1, name: "Bayar" })).toBeVisible();
    await press(page, page.getByRole("button", { name: "Buat pesanan" }), "Buat pesanan");
    await expect(page).toHaveURL(/\/pesanan\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
  });

  test("produk fisik: alamat diketik, layanan dipilih dengan Spasi, sampai pesanan dibuat", async ({ page }) => {
    const f = await seedProduct(admin, { name: "Nastar Keyboard", type: "physical", price: 120000, stockQty: 10 });
    await page.goto(`/produk/${f.slug}`);
    await press(page, page.getByRole("button", { name: "Masukkan keranjang" }), "Masukkan keranjang");
    await expect(page.getByText("Masuk ke keranjang.")).toBeVisible();
    await press(page, page.getByRole("link", { name: /^Keranjang/ }), "tautan Keranjang");
    await press(page, page.getByRole("link", { name: "Lanjut bayar" }), "Lanjut bayar");
    await expect(page.getByRole("heading", { level: 1, name: "Pengiriman" })).toBeVisible();
    await typeInto(page, page.getByLabel("Nama penerima"), "Nama penerima", ADDRESS.recipient);
    await typeInto(page, page.getByLabel("Nomor HP"), "Nomor HP", ADDRESS.phone);
    await typeInto(page, page.getByLabel("Alamat lengkap"), "Alamat lengkap", ADDRESS.address);
    await typeInto(page, page.getByLabel("Kecamatan"), "Kecamatan", ADDRESS.areaId);
    await typeInto(page, page.getByLabel("Kode pos"), "Kode pos", ADDRESS.postalCode);
    await press(page, page.getByRole("button", { name: "Simpan alamat" }), "Simpan alamat");
    const services = page.getByRole("group", { name: "Layanan pengiriman" });
    await expect(services.getByRole("radio").first()).toBeVisible();
    await press(page, services.getByRole("radio").first(), "layanan pengiriman", "Space");
    await expect(services.getByRole("radio").first()).toBeChecked();
    await press(page, page.getByRole("button", { name: "Lanjut" }), "Lanjut");
    await expect(page.getByRole("heading", { level: 1, name: "Bayar" })).toBeVisible();
    await press(page, page.getByRole("button", { name: "Buat pesanan" }), "Buat pesanan");
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
  });
});

test.describe("unggah bukti hanya dengan keyboard", () => {
  test("pilih file lewat Enter pada kolom bukti, lalu Upload bukti bayar", async ({ page }) => {
    const d = await digital("E-book Keyboard Unggah");
    await userApi(buyer, "POST", "/api/cart/items", { productId: d.id });
    const orderId = (await userApi(buyer, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
    await page.goto(`/pesanan/${orderId}`);
    const input = page.getByLabel("Bukti bayar");
    await tabTo(page, input, "kolom Bukti bayar");
    const chooser = await openChooser(page);
    await chooser.setFiles({ name: "transfer.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByTestId("pratinjau")).toContainText("transfer.png");
    await press(page, page.getByRole("button", { name: "Upload bukti bayar" }), "Upload bukti bayar");
    await expect(page.getByTestId("status-pesanan")).toContainText("Menunggu verifikasi");
    expect(await orderStatusOf(orderId)).toBe("MENUNGGU_VERIFIKASI");
  });

  test("Shift+Tab kembali ke kontrol sebelumnya, dan kontrol Batalkan pesanan terjangkau dengan dialog yang menjebak fokus", async ({ page }) => {
    const d = await digital("E-book Keyboard Batal");
    await userApi(buyer, "POST", "/api/cart/items", { productId: d.id });
    const orderId = (await userApi(buyer, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
    await page.goto(`/pesanan/${orderId}`);
    const cancel = page.getByRole("button", { name: "Batalkan pesanan" });
    await press(page, cancel, "Batalkan pesanan");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectTrapped(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cancel, "fokus kembali ke tombol pemicu").toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await isFocused(cancel)).toBe(false);
    await expectFocusVisible(page, "kontrol sebelum Batalkan pesanan");
  });
});

test.describe("verifikasi admin hanya dengan keyboard", () => {
  async function queued() {
    const b = await buyerCookie();
    const p = await digital(`E-book Antre ${Math.random().toString(36).slice(2, 7)}`);
    await userApi(b, "POST", "/api/cart/items", { productId: p.id });
    const orderId = (await userApi(b, "POST", "/api/checkout", { expectedTotal: 75000 })).orderId as string;
    await uploadProofApi(b, orderId, PNG_1X1, "image/png");
    const { invoiceNumber } = await userApi(b, "GET", `/api/orders/${orderId}/payment`);
    return { orderId, invoiceNumber: invoiceNumber as string };
  }

  test("terima: tautan invoice, tombol Terima, dialog yang menjebak fokus, Ya, terima", async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([admin]);
    await page.setViewportSize({ width: 1280, height: 800 });
    const o = await queued();
    await page.goto("/admin");
    const row = page.getByTestId("antrean-item").filter({ hasText: o.invoiceNumber });
    await press(page, row.getByRole("link", { name: o.invoiceNumber }), "tautan invoice");
    const panel = page.getByRole("region", { name: "Periksa bukti" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
    await press(page, panel.getByRole("button", { name: "Terima", exact: true }), "Terima");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectTrapped(page);
    await press(page, page.getByRole("dialog").getByRole("button", { name: "Ya, terima" }), "Ya, terima");
    await expect(page.getByRole("status").filter({ hasText: /diterima/ })).toBeVisible();
    expect(await orderStatusOf(o.orderId)).toBe("LUNAS");
  });

  test("tolak: alasan diketik di dialog lalu Ya, tolak; Esc menutup dialog dan fokus kembali ke Tolak", async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([admin]);
    await page.setViewportSize({ width: 1280, height: 800 });
    const o = await queued();
    await page.goto("/admin");
    const row = page.getByTestId("antrean-item").filter({ hasText: o.invoiceNumber });
    await press(page, row.getByRole("link", { name: o.invoiceNumber }), "tautan invoice");
    const panel = page.getByRole("region", { name: "Periksa bukti" });
    const reject = panel.getByRole("button", { name: "Tolak", exact: true });
    await press(page, reject, "Tolak");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(reject, "fokus kembali ke Tolak setelah Esc").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible(); // tunggu dialog terbuka sebelum Tab
    await typeInto(page, page.getByLabel("Alasan penolakan"), "Alasan penolakan", "Foto buram, tolong unggah ulang");
    await press(page, page.getByRole("dialog").getByRole("button", { name: "Ya, tolak" }), "Ya, tolak");
    await expect(page.getByRole("status").filter({ hasText: /ditolak/ })).toBeVisible();
    expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_PEMBAYARAN");
  });
});
