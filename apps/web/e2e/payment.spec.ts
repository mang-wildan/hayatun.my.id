import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, adminCookie, buyerCookie, expireOrderNow, PNG_1X1, resetProducts, seedProduct, setOrderStatus, setSetting, uploadProofApi, userApi } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BANK = { bank: "BCA", number: "1234567890", holder: "Hayatun Toko" };
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2000, 1)]);
const FILE_TYPE = "Jenis file tidak didukung. Pakai JPG, PNG, atau PDF ya.";
const TOO_LARGE = "Filenya kebesaran nih, maksimal 5 MB ya. Coba kecilkan dulu.";

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
  await setSetting("store", null);
});

async function newOrder(who = buyer, price = 75000) {
  const d = await seedProduct(admin, { name: `E-book Bayar ${Math.random().toString(36).slice(2, 7)}`, price });
  await userApi(who, "POST", "/api/cart/items", { productId: d.id });
  return (await userApi(who, "POST", "/api/checkout", { expectedTotal: price })).orderId as string;
}
const open = async (page: Page, id: string) => { expect((await page.goto(`/pesanan/${id}`))!.status()).toBe(200); };
const status = (page: Page) => page.getByTestId("status-pesanan");
const pick = (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => page.getByLabel("Bukti bayar").setInputFiles(file);

test.describe("instruksi bayar (F4.1, F4.2)", () => {
  test("batas waktu, total, dan rekening tujuan tampil; nomor invoice dan total tidak berubah dari T30", async ({ page }) => {
    const id = await newOrder();
    await open(page, id);
    await expect(page.getByRole("heading", { level: 1, name: "Pesanan dibuat" })).toBeVisible();
    await expect(page.getByTestId("nomor-invoice")).toHaveText(/^INV\/\d{4}\/\d{2}\/\d{4,}$/);
    await expect(page.getByTestId("total")).toHaveText("Rp75.000");
    await expect(page.getByTestId("batas-waktu")).toHaveText(/^Upload sebelum \d{1,2} \p{L}{3} \d{4}, \d{2}\.\d{2} WIB$/u);
    await expect(page.getByText("BCA", { exact: true })).toBeVisible();
    await expect(page.getByTestId("nomor-rekening")).toHaveText("1234567890");
    await expect(page.getByText("Hayatun Toko")).toBeVisible();
    expect(await page.getByTestId("nomor-rekening").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("JetBrains");
    await expect(page.getByRole("link", { name: "Lihat invoice" })).toHaveAttribute("href", `/invoice/${id}`);
  });

  test("nomor invoice, total, dan nomor rekening bisa disalin; tombol berganti Tersalin lalu kembali", async ({ page }) => {
    await open(page, await newOrder());
    for (const [name, expected] of [["Salin nomor rekening", "1234567890"], ["Salin total transfer", "75000"]] as const) {
      const button = page.getByRole("button", { name });
      await button.click();
      await expect(button).toHaveText("Tersalin");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
      await expect(button).toHaveText("Salin", { timeout: 4000 }); // kembali setelah 2 detik
    }
    await page.getByRole("button", { name: "Salin nomor invoice" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^INV\/\d{4}\/\d{2}\/\d{4,}$/);
  });

  test("rekening belum diatur: pesan jelas dan kontak toko, tanpa angka rekening", async ({ page }) => {
    await setSetting("bankAccount", null);
    await open(page, await newOrder());
    await expect(page.getByText("Rekening tujuan belum diatur.")).toBeVisible();
    await expect(page.getByText("toko@hayatun.my.id")).toBeVisible();
    await expect(page.getByTestId("nomor-rekening")).toHaveCount(0);
    await expect(page.getByLabel("Bukti bayar")).toBeVisible(); // pembeli tetap bisa mengunggah
  });

  test("pesanan milik orang lain: tidak ditemukan", async ({ page }) => {
    const id = await newOrder(await buyerCookie());
    const res = await page.goto(`/pesanan/${id}`);
    expect(res!.status()).toBe(404);
    await expect(page.getByText("Pesanan tidak ditemukan.")).toBeVisible();
  });
});

test.describe("unggah bukti (F4.3, F4.7)", () => {
  test("area unggah besar; memilih file menampilkan pratinjau, nama, ukuran, dan tombol Ganti", async ({ page }) => {
    await open(page, await newOrder());
    const area = page.getByTestId("area-unggah");
    expect((await area.boundingBox())!.height).toBeGreaterThanOrEqual(160);
    await expect(page.getByLabel("Bukti bayar")).toHaveAttribute("accept", /image\/png/);
    await expect(page.getByRole("button", { name: "Upload bukti bayar" })).toBeDisabled(); // belum ada file
    await pick(page, { name: "transfer.png", mimeType: "image/png", buffer: PNG_1X1 });
    const preview = page.getByTestId("pratinjau");
    await expect(preview.getByRole("img", { name: "Pratinjau bukti bayar" })).toBeVisible();
    await expect(preview).toContainText("transfer.png");
    await expect(preview).toContainText("KB");
    await expect(page.getByRole("button", { name: "Upload bukti bayar" })).toBeEnabled();
    await page.getByRole("button", { name: "Ganti" }).click();
    await expect(page.getByTestId("pratinjau")).toHaveCount(0);
  });

  test("jenis atau ukuran yang salah ditolak di browser dengan pesan di bawah kolomnya", async ({ page }) => {
    await open(page, await newOrder());
    const input = page.getByLabel("Bukti bayar");
    await pick(page, { name: "halaman.html", mimeType: "text/html", buffer: Buffer.from("<html></html>") });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(new RegExp(FILE_TYPE));
    await expect(page.getByRole("button", { name: "Upload bukti bayar" })).toBeDisabled();
    await pick(page, { name: "besar.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 7) });
    await expect(input).toHaveAccessibleDescription(new RegExp(TOO_LARGE));
    await pick(page, { name: "ok.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  test("unggah berhasil: status berubah menjadi Menunggu verifikasi dan area unggah hilang", async ({ page }) => {
    const id = await newOrder();
    await open(page, id);
    await pick(page, { name: "transfer.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload bukti bayar" }).click();
    await expect(page.getByText("Bukti bayar terkirim. Kami akan segera mengeceknya.")).toBeVisible();
    await expect(status(page)).toHaveText("Menunggu verifikasi");
    await expect(page.getByLabel("Bukti bayar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Batalkan pesanan" })).toHaveCount(0);
    await page.reload();
    await expect(status(page)).toHaveText("Menunggu verifikasi"); // tersimpan di server
  });

  test("file 5 MB lewat proxy Next.js utuh (N21)", async ({ page }) => {
    await open(page, await newOrder());
    await pick(page, { name: "besar.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 - PDF.length, 3)]) });
    const t = Date.now();
    await page.getByRole("button", { name: "Upload bukti bayar" }).click();
    await expect(status(page)).toHaveText("Menunggu verifikasi");
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  test("server menolak isi yang bukan JPG/PNG/PDF walau namanya meyakinkan: pesan dari server tetap terlihat", async ({ page }) => {
    await open(page, await newOrder());
    await pick(page, { name: "bukti.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await page.getByRole("button", { name: "Upload bukti bayar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: FILE_TYPE })).toBeVisible();
    await expect(status(page)).toHaveText("Menunggu pembayaran"); // status tidak berubah
  });
});

test.describe("bukti ditolak (F5.3, F5.4)", () => {
  test("alasan tampil, pembeli mengunggah ulang, alasan hilang", async ({ page }) => {
    const id = await newOrder();
    await uploadProofApi(buyer, id, PDF);
    await adminApi(admin, "POST", `/api/admin/payments/${id}/reject`, { reason: "Nominal transfer tidak sesuai" });
    await open(page, id);
    const reason = page.getByTestId("alasan-penolakan");
    await expect(reason).toContainText("Bukti bayarmu belum bisa diterima");
    await expect(reason).toContainText("Nominal transfer tidak sesuai");
    await expect(status(page)).toHaveText("Menunggu pembayaran");
    await pick(page, { name: "ulang.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload bukti bayar" }).click();
    await expect(status(page)).toHaveText("Menunggu verifikasi");
    await expect(page.getByTestId("alasan-penolakan")).toHaveCount(0);
  });
});

test.describe("status lain dan batas waktu (F4.8)", () => {
  test("batas waktu lewat walau status belum diubah: tidak ada area unggah, ajakan checkout ulang", async ({ page }) => {
    const id = await newOrder();
    await expireOrderNow(id);
    await open(page, id);
    await expect(page.getByText("Pesanan ini kedaluwarsa. Silakan checkout ulang ya.")).toBeVisible();
    await expect(page.getByLabel("Bukti bayar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Kembali belanja" })).toHaveAttribute("href", "/");
  });

  for (const [s, label] of [["LUNAS", "Lunas"], ["KEDALUWARSA", "Kedaluwarsa"], ["DIBATALKAN", "Dibatalkan"]] as const) {
    test(`${s}: label status dengan ikon, tanpa area unggah dan tanpa tombol batal`, async ({ page }) => {
      const id = await newOrder();
      await setOrderStatus(id, s);
      await open(page, id);
      await expect(page.getByRole("heading", { level: 1, name: "Status pesanan" })).toBeVisible();
      await expect(status(page)).toHaveText(label);
      await expect(status(page).locator("svg")).toHaveCount(1);
      await expect(page.getByLabel("Bukti bayar")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Batalkan pesanan" })).toHaveCount(0);
    });
  }
});

test.describe("batalkan pesanan (F4.6)", () => {
  test("meminta konfirmasi; Esc dan Batal tidak mengubah apa pun; Ya, batalkan membatalkan", async ({ page }) => {
    await open(page, await newOrder());
    await page.getByRole("button", { name: "Batalkan pesanan" }).click();
    const dialog = page.getByRole("dialog", { name: "Batalkan pesanan?" });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(status(page)).toHaveText("Menunggu pembayaran");
    await page.getByRole("button", { name: "Batalkan pesanan" }).click();
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(status(page)).toHaveText("Menunggu pembayaran");
    await page.getByRole("button", { name: "Batalkan pesanan" }).click();
    await dialog.getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(status(page)).toHaveText("Dibatalkan");
    await expect(page.getByLabel("Bukti bayar")).toHaveCount(0);
  });
});

test.describe("keyboard dan aksesibilitas (N11–N16)", () => {
  test("semua kontrol terjangkau dengan Tab dan penanda fokus selalu terlihat (N14)", async ({ page }) => {
    await open(page, await newOrder());
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const label = e.getAttribute("aria-label") ?? (e as HTMLInputElement).labels?.[0]?.textContent ?? e.textContent ?? "";
        const s = getComputedStyle(e);
        return { label: label.trim(), outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0, tag: e.tagName };
      });
      if (info.tag !== "BODY") {
        seen.add(info.label);
        expect(info.outline, `fokus pada "${info.label}" harus terlihat`).toBe(true);
      }
    }
    for (const must of ["Salin nomor invoice", "Salin total transfer", "Salin nomor rekening", "Bukti bayar", "Batalkan pesanan"]) expect([...seen].some((l) => l.startsWith(must)), must).toBe(true);
  });

  for (const width of WIDTHS) {
    test(`@${width}px: lolos WCAG 2.1 AA di tiap keadaan, tanpa gulir ke samping`, async ({ page }) => {
      const pending = await newOrder();
      const rejected = await newOrder();
      await uploadProofApi(buyer, rejected, PDF);
      await adminApi(admin, "POST", `/api/admin/payments/${rejected}/reject`, { reason: "Foto buram" });
      const verifying = await newOrder();
      await uploadProofApi(buyer, verifying, PDF);
      await page.setViewportSize({ width, height: 800 });
      for (const id of [pending, rejected, verifying]) {
        await open(page, id);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations, id).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), id).toBeLessThanOrEqual(width);
      }
    });
  }

  test("HP: area sentuh minimal 44px dan pratinjau tidak melebarkan halaman", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, await newOrder());
    await pick(page, { name: "transfer-dengan-nama-file-yang-sangat-panjang-sekali-supaya-membungkus.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByTestId("pratinjau")).toBeVisible();
    const targets = await page.locator("main button, main a, header a").all();
    expect(targets.length).toBeGreaterThan(5);
    for (const el of targets) {
      if (!(await el.isVisible())) continue;
      const box = (await el.boundingBox())!;
      expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
