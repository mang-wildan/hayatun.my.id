import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, adminCookie, auditCount, buyerCookie, clearQueue, orderStatusOf, PNG_1X1, resetProducts, seedProduct, setSetting, uploadProofApi, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2000, 1)]);
const EMPTY = "Belum ada bukti yang perlu dicek. Bukti baru akan muncul di sini.";
const PROCESSED = "Pesanan ini sudah diproses admin lain.";
const HP = { width: 360, height: 640 };
const PC = { width: 1280, height: 800 };

let admin: Awaited<ReturnType<typeof adminCookie>>;
test.beforeAll(async () => {
  await resetProducts();
  admin = await adminCookie();
});
test.beforeEach(async ({ context }) => {
  await clearQueue();
  await setSetting("bankAccount", BANK);
  await context.addCookies([admin]);
});

// Pesanan digital dengan bukti sudah diunggah; urutan pembuatan = urutan antrean (paling lama dulu)
async function queued(price = 75000, name = `E-book Antre ${Math.random().toString(36).slice(2, 7)}`, proof: "png" | "pdf" = "png") {
  const buyer = await buyerCookie();
  const p = await seedProduct(admin, { name, price });
  await userApi(buyer, "POST", "/api/cart/items", { productId: p.id });
  const orderId = (await userApi(buyer, "POST", "/api/checkout", { expectedTotal: price })).orderId as string;
  await uploadProofApi(buyer, orderId, proof === "png" ? PNG_1X1 : PDF, proof === "png" ? "image/png" : "application/pdf");
  const { invoiceNumber } = await userApi(buyer, "GET", `/api/orders/${orderId}/payment`);
  return { orderId, invoiceNumber: invoiceNumber as string, name, price, buyer };
}
type Q = Awaited<ReturnType<typeof queued>>;

const items = (page: Page) => page.getByTestId("antrean-item");
const panel = (page: Page) => page.getByRole("region", { name: "Periksa bukti" });
// Membuka bukti: di HP dan tablet lewat tombol di kartu, di PC lewat baris (tautan pada nomor invoice)
async function periksa(page: Page, o: Q) {
  const row = items(page).filter({ hasText: o.invoiceNumber });
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  await (wide ? row.getByRole("link", { name: o.invoiceNumber }) : row.getByRole("link", { name: "Periksa bukti" })).click();
  await expect(panel(page)).toBeVisible();
}
const notice = (page: Page) => page.getByRole("status").filter({ hasText: /diterima|ditolak|diproses/ });

test.describe("antrean (F5.1)", () => {
  test("paling lama menunggu di atas; tiap entri memuat invoice, pembeli, total, dan status", async ({ page }) => {
    page.setViewportSize(HP);
    const [a, b, c] = [await queued(75000), await queued(120000), await queued(50000)];
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Verifikasi" })).toBeVisible();
    await expect(items(page)).toHaveCount(3);
    await expect(items(page).nth(0)).toContainText(a.invoiceNumber);
    await expect(items(page).nth(1)).toContainText(b.invoiceNumber);
    await expect(items(page).nth(2)).toContainText(c.invoiceNumber);
    await expect(items(page).nth(0)).toContainText("Pembeli Tes");
    await expect(items(page).nth(0)).toContainText("Rp75.000");
    await expect(items(page).nth(0)).toContainText("Menunggu verifikasi");
    await expect(items(page).nth(0).getByRole("link", { name: "Periksa bukti" })).toBeVisible();
  });

  test("antrean kosong: pesan kosong tampil dan menu tanpa angka", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Menu admin" }).getByRole("link", { name: "Verifikasi", exact: true })).toBeVisible();
  });

  test("menu Verifikasi memuat jumlah antrean, dan angkanya ikut berkurang setelah bukti diputuskan", async ({ page }) => {
    const [a] = [await queued(), await queued()];
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menu admin" });
    await expect(nav.getByRole("link", { name: "Verifikasi, 2 bukti menunggu" })).toBeVisible();
    await adminApi(admin, "POST", `/api/admin/payments/${a.orderId}/accept`);
    await page.reload();
    await expect(nav.getByRole("link", { name: "Verifikasi, 1 bukti menunggu" })).toBeVisible();
  });

  test("HP dan tablet memakai kartu, PC memakai tabel; tidak ada teks ganda", async ({ page }) => {
    const o = await queued();
    for (const [size, table] of [[HP, false], [{ width: 768, height: 1024 }, false], [PC, true]] as const) {
      await page.setViewportSize(size);
      await page.goto("/admin");
      await expect(items(page)).toHaveCount(1);
      await expect(page.getByText(o.invoiceNumber)).toHaveCount(1);
      await expect(page.getByRole("table")).toHaveCount(table ? 1 : 0);
    }
  });

  test("tablet: kartu dua kolom", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await queued(); await queued();
    await page.goto("/admin");
    const [x, y] = await Promise.all([items(page).nth(0).boundingBox(), items(page).nth(1).boundingBox()]);
    expect(Math.abs(x!.y - y!.y)).toBeLessThan(2);
    expect(y!.x).toBeGreaterThan(x!.x + x!.width - 2);
  });

  test("PC: bisa diurutkan per kolom dan dicari dengan nomor invoice atau nama pembeli", async ({ page }) => {
    await page.setViewportSize(PC);
    const [a, b, c] = [await queued(75000), await queued(120000), await queued(50000)];
    await page.goto("/admin");
    const order = async () => (await items(page).allInnerTexts()).map((t) => [a, b, c].find((o) => t.includes(o.invoiceNumber))!.price);
    expect(await order()).toEqual([75000, 120000, 50000]); // bawaan: paling lama dulu
    const total = page.getByRole("columnheader", { name: "Total" });
    await total.getByRole("button").click();
    await expect(total).toHaveAttribute("aria-sort", "ascending");
    expect(await order()).toEqual([50000, 75000, 120000]);
    await total.getByRole("button").click();
    await expect(total).toHaveAttribute("aria-sort", "descending");
    expect(await order()).toEqual([120000, 75000, 50000]);
    await page.getByLabel("Cari invoice atau pembeli").fill(b.invoiceNumber);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(b.invoiceNumber);
    await page.getByLabel("Cari invoice atau pembeli").fill("tidak-ada-yang-cocok");
    await expect(page.getByText("Tidak ada yang cocok dengan pencarianmu.")).toBeVisible();
    await page.getByLabel("Cari invoice atau pembeli").fill("pembeli tes");
    await expect(items(page)).toHaveCount(3);
  });
});

test.describe("memeriksa bukti (F5.2)", () => {
  test("HP: layar penuh dengan total, rekening tujuan, bukti, dan tombol Terima/Tolak yang selalu terlihat", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued(75000, "E-book Periksa");
    await page.goto("/admin");
    await periksa(page, o);
    await expect(page).toHaveURL(new RegExp(`/admin\\?periksa=${o.orderId}$`));
    const box = await panel(page).boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: HP.width, height: HP.height }); // layar penuh
    await expect(panel(page).getByTestId("total-periksa")).toHaveText("Rp75.000");
    await expect(panel(page).getByTestId("rekening-periksa")).toContainText("BCA");
    await expect(panel(page).getByTestId("rekening-periksa")).toContainText("1234567890");
    await expect(panel(page).getByTestId("rekening-periksa")).toContainText("Hayatun Toko");
    await expect(panel(page)).toContainText(o.invoiceNumber);
    await expect(panel(page)).toContainText("E-book Periksa");
    for (const name of ["Terima", "Tolak"]) {
      const b = await panel(page).getByRole("button", { name, exact: true }).boundingBox();
      expect(b!.y + b!.height).toBeLessThanOrEqual(HP.height); // terlihat tanpa menggulir
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    // total & rekening di atas bukti
    const t = await panel(page).getByTestId("total-periksa").boundingBox();
    const img = await panel(page).getByRole("img", { name: `Bukti bayar ${o.invoiceNumber}` }).boundingBox();
    expect(t!.y).toBeLessThan(img!.y);
  });

  test("gambar bukti benar-benar termuat, bisa dibuka ukuran penuh, dan pembukaannya tercatat", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued();
    await page.goto("/admin");
    await periksa(page, o);
    const img = panel(page).getByRole("img", { name: `Bukti bayar ${o.invoiceNumber}` });
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
    await expect(panel(page).getByRole("link", { name: "Buka ukuran penuh" })).toHaveAttribute("href", `/api/admin/payments/${o.orderId}/proof`);
    expect(await auditCount("payment_proof.viewed", o.orderId)).toBeGreaterThanOrEqual(1);
  });

  test("bukti PDF: tautan buka di tab baru, tanpa tampilan sematan", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued(75000, undefined, "pdf");
    await page.goto("/admin");
    await periksa(page, o);
    const link = panel(page).getByRole("link", { name: "Buka bukti (PDF)" });
    await expect(link).toHaveAttribute("href", `/api/admin/payments/${o.orderId}/proof`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(panel(page).locator("iframe, embed, object")).toHaveCount(0);
    await expect(panel(page).getByRole("img", { name: /Bukti bayar/ })).toHaveCount(0);
  });

  test("rekening belum diatur: panel menyebutnya, bukan mengarang rekening", async ({ page }) => {
    await setSetting("bankAccount", null);
    const o = await queued();
    await page.goto("/admin");
    await periksa(page, o);
    await expect(panel(page).getByTestId("rekening-periksa")).toContainText("Rekening tujuan belum diatur");
  });

  test("PC: panel di kanan, daftar tetap terlihat di kiri dan baris yang dibuka ditandai", async ({ page }) => {
    await page.setViewportSize(PC);
    const [a, b] = [await queued(), await queued()];
    await page.goto("/admin");
    await periksa(page, b);
    await expect(items(page)).toHaveCount(2);
    const [list, side] = [await page.getByRole("table").boundingBox(), await panel(page).boundingBox()];
    expect(side!.x).toBeGreaterThanOrEqual(list!.x + list!.width - 2);
    expect(side!.x + side!.width).toBeLessThanOrEqual(PC.width);
    await expect(items(page).filter({ hasText: b.invoiceNumber })).toHaveAttribute("aria-current", "true");
    // pindah ke bukti lain tanpa menutup panel
    await items(page).filter({ hasText: a.invoiceNumber }).getByRole("link", { name: a.invoiceNumber }).click();
    await expect(page).toHaveURL(new RegExp(`periksa=${a.orderId}`));
    await expect(panel(page)).toContainText(a.invoiceNumber);
  });

  test("tombol Kembali menutup pemeriksaan, dan tautan ?periksa= langsung membuka bukti", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued();
    await page.goto(`/admin?periksa=${o.orderId}`);
    await expect(panel(page)).toContainText(o.invoiceNumber);
    await panel(page).getByRole("link", { name: "Kembali ke antrean" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("?periksa= untuk pesanan yang tidak ada di antrean: antrean tetap tampil dengan pesan, bukan halaman error", async ({ page }) => {
    const o = await queued();
    await adminApi(admin, "POST", `/api/admin/payments/${o.orderId}/accept`);
    await page.goto(`/admin?periksa=${o.orderId}`);
    await expect(page.getByText("Bukti ini sudah tidak ada di antrean.")).toBeVisible();
    await expect(page.getByText(EMPTY)).toBeVisible();
  });
});

test.describe("menerima dan menolak (F5.2, F5.3)", () => {
  test("Terima: konfirmasi menyebut invoice; setelahnya pesanan LUNAS, keluar dari antrean, ada pesan singkat", async ({ page }) => {
    await page.setViewportSize(HP);
    const [o, other] = [await queued(), await queued()];
    await page.goto("/admin");
    await periksa(page, o);
    await panel(page).getByRole("button", { name: "Terima", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Terima bukti bayar ${o.invoiceNumber}?` });
    await expect(dialog).toBeVisible();
    expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_VERIFIKASI"); // belum berubah sebelum dikonfirmasi
    await dialog.getByRole("button", { name: "Ya, terima" }).click();
    await expect(notice(page)).toContainText(`${o.invoiceNumber} diterima`);
    await expect(panel(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(other.invoiceNumber);
    expect(await orderStatusOf(o.orderId)).toBe("LUNAS");
  });

  test("Batal pada konfirmasi tidak mengubah apa pun, Esc menutup, fokus kembali ke tombol Terima", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued();
    await page.goto("/admin");
    await periksa(page, o);
    const terima = panel(page).getByRole("button", { name: "Terima", exact: true });
    await terima.click();
    await page.getByRole("dialog").getByRole("button", { name: "Batal" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(terima).toBeFocused();
    await terima.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_VERIFIKASI");
  });

  test("Tolak: alasan wajib, pilihan siap pakai mengisi kolom dan tetap bisa diubah, lalu pembeli bisa mengunggah ulang", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued();
    await page.goto("/admin");
    await periksa(page, o);
    await panel(page).getByRole("button", { name: "Tolak", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Tolak bukti bayar ${o.invoiceNumber}?` });
    await expect(dialog).toBeVisible();
    const reason = dialog.getByLabel("Alasan penolakan");
    // alasan kosong ditolak dengan pesan di bawah kolom, tanpa memanggil API
    await dialog.getByRole("button", { name: "Ya, tolak" }).click();
    await expect(dialog.getByText("Alasan penolakan wajib diisi.")).toBeVisible();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_VERIFIKASI");
    for (const preset of ["Nominal kurang", "Foto tidak terbaca", "Transfer tidak ditemukan"]) {
      await dialog.getByRole("button", { name: preset }).click();
      await expect(reason).toHaveValue(preset);
    }
    await reason.fill("Transfer tidak ditemukan di mutasi rekening");
    await dialog.getByRole("button", { name: "Ya, tolak" }).click();
    await expect(notice(page)).toContainText(`${o.invoiceNumber} ditolak`);
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByText(EMPTY)).toBeVisible();
    expect(await orderStatusOf(o.orderId)).toBe("MENUNGGU_PEMBAYARAN");
    const buyerView = await userApi(o.buyer, "GET", `/api/orders/${o.orderId}/payment`);
    expect(buyerView.lastRejection).toMatchObject({ reason: "Transfer tidak ditemukan di mutasi rekening" });
  });

  test("dua admin bersamaan: yang kalah cepat melihat pesan 'sudah diproses admin lain' dan antrean diperbarui", async ({ page }) => {
    await page.setViewportSize(HP);
    const [o, other] = [await queued(), await queued()];
    await page.goto("/admin");
    await periksa(page, o);
    const admin2 = await adminCookie();
    await adminApi(admin2, "POST", `/api/admin/payments/${o.orderId}/accept`); // admin lain lebih cepat
    await panel(page).getByRole("button", { name: "Terima", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, terima" }).click();
    await expect(page.getByRole("alert").filter({ hasText: PROCESSED })).toBeVisible();
    await expect(items(page)).toHaveCount(1);
    await expect(items(page)).toContainText(other.invoiceNumber);
    expect(await orderStatusOf(o.orderId)).toBe("LUNAS");
  });

  test("tombol terkunci selama permintaan berjalan: klik ganda hanya menghasilkan satu keputusan", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued();
    let calls = 0;
    await page.route("**/api/admin/payments/*/accept", async (route) => { calls++; await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
    await page.goto("/admin");
    await periksa(page, o);
    await panel(page).getByRole("button", { name: "Terima", exact: true }).click();
    const yes = page.getByRole("dialog").getByRole("button", { name: "Ya, terima" });
    await yes.dblclick();
    await expect(notice(page)).toContainText("diterima");
    expect(calls).toBe(1);
  });
});

test.describe("kecepatan (N9)", () => {
  test("Terima = 3 klik, Tolak dengan alasan siap pakai = 4 klik, dan keduanya jauh di bawah 1 menit", async ({ page }) => {
    await page.setViewportSize(HP);
    const [a, b] = [await queued(), await queued()];
    await page.goto("/admin");
    let clicks = 0;
    const click = async (l: ReturnType<Page["getByRole"]>) => { clicks++; await l.click(); };

    const t0 = Date.now();
    await click(items(page).filter({ hasText: a.invoiceNumber }).getByRole("link", { name: "Periksa bukti" }));
    await click(panel(page).getByRole("button", { name: "Terima", exact: true }));
    await click(page.getByRole("dialog").getByRole("button", { name: "Ya, terima" }));
    await expect(notice(page)).toContainText("diterima");
    expect(clicks).toBe(3);

    clicks = 0;
    await click(items(page).filter({ hasText: b.invoiceNumber }).getByRole("link", { name: "Periksa bukti" }));
    await click(panel(page).getByRole("button", { name: "Tolak", exact: true }));
    await click(page.getByRole("dialog").getByRole("button", { name: "Nominal kurang" }));
    await click(page.getByRole("dialog").getByRole("button", { name: "Ya, tolak" }));
    await expect(notice(page)).toContainText("ditolak");
    expect(clicks).toBe(4);
    expect(Date.now() - t0).toBeLessThan(60_000);
  });
});

test.describe("aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: antrean, kosong, pemeriksaan, dan dialog`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin");
      await expect(page.getByText(EMPTY)).toBeVisible();
      await scan();
      const o = await queued();
      await page.goto("/admin");
      await expect(items(page)).toHaveCount(1);
      await scan();
      await periksa(page, o);
      await scan();
      await panel(page).getByRole("button", { name: "Tolak", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan();
    });
  }

  test("tanpa guliran mendatar di 360px, dan semua tombol dan tautan di antrean minimal 44px", async ({ page }) => {
    await page.setViewportSize(HP);
    const o = await queued(1250000, "Nama produk yang sangat panjang supaya kartu antrean harus membungkus teksnya dengan benar");
    await page.goto("/admin");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(HP.width);
    const b = await items(page).filter({ hasText: o.invoiceNumber }).getByRole("link", { name: "Periksa bukti" }).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    await periksa(page, o);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(HP.width);
  });

  test("keyboard: Tab ke tautan, Enter membuka pemeriksaan dengan fokus di dalamnya, Esc pada dialog menutup dialog saja", async ({ page }) => {
    await page.setViewportSize(PC);
    const o = await queued();
    await page.goto("/admin");
    const link = items(page).getByRole("link", { name: o.invoiceNumber });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toBeFocused();
    await panel(page).getByRole("button", { name: "Tolak", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });
});

test.describe("akses", () => {
  test("tanpa sesi admin diarahkan ke halaman masuk, pembeli juga", async ({ browser }) => {
    for (const cookies of [[], [await buyerCookie()]]) {
      const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/masuk/);
      await ctx.close();
    }
  });
});
