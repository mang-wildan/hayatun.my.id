import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buyerCookie, setSetting } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const PRIVACY_H2 = ["Data yang kami kumpulkan", "Untuk apa data dipakai", "Berapa lama data disimpan", "Pihak ketiga yang menerima data", "Keamanan data", "Menghapus akunmu", "Kontak"];
const TERMS_H2 = ["Memesan", "Pembayaran", "Produk digital", "Produk fisik", "Pembatalan dan pengembalian", "Akun", "Kontak"];
const VENDORS = /Biteship|RajaOngkir|Komerce|KiriminAja|Midtrans|Xendit|Mailgun|SendGrid|Mailchimp|Amazon|Google|Cloudflare/i;

test.beforeEach(async () => { await setSetting("store", null); });

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const h2s = async (page: Page) => page.getByRole("heading", { level: 2 }).allInnerTexts();
const section = (page: Page, name: string) => page.getByRole("region", { name });
const footer = (page: Page) => page.getByRole("contentinfo");

test.describe("kebijakan privasi (F12.4)", () => {
  test("terbuka tanpa masuk, satu h1, dan judul bagian sesuai urutan", async ({ page }) => {
    expect((await page.goto("/kebijakan-privasi"))!.status()).toBe(200);
    await expect(page).toHaveTitle(/Kebijakan privasi/);
    await expect(h1(page)).toHaveCount(1);
    await expect(h1(page)).toHaveText("Kebijakan privasi");
    expect(await h2s(page)).toEqual(PRIVACY_H2);
  });

  test("data apa yang dikumpulkan dan untuk apa", async ({ page }) => {
    await page.goto("/kebijakan-privasi");
    const data = section(page, "Data yang kami kumpulkan");
    for (const t of ["nama", "email", "password", "alamat", "nomor HP", "bukti transfer", "invoice"]) await expect(data).toContainText(t);
    await expect(data).toContainText("hanya bila pesananmu berisi produk fisik");
    await expect(data).toContainText("hash"); // password tidak disimpan apa adanya
    const purpose = section(page, "Untuk apa data dipakai");
    for (const t of ["memproses", "verifikasi", "email", "keamanan"]) await expect(purpose).toContainText(t);
  });

  test("berapa lama disimpan: angka yang sama dengan perilaku aplikasi", async ({ page }) => {
    await page.goto("/kebijakan-privasi");
    const keep = section(page, "Berapa lama data disimpan");
    await expect(keep).toContainText(/bukti transfer[^.]*1 tahun/i);
    await expect(keep).toContainText(/invoice dan transaksi[^.]*10 tahun/i);
    await expect(keep).toContainText("3×24 jam");
    await expect(keep).toContainText("30 hari");
    await expect(keep).toContainText(/log aktivitas[^.]*2 tahun/i);
    await expect(keep).toContainText(/log teknis[^.]*90 hari/i);
  });

  test("pihak ketiga: kategori tanpa nama merek, ekspedisi hanya wilayah, kode pos, dan berat", async ({ page }) => {
    await page.goto("/kebijakan-privasi");
    const third = section(page, "Pihak ketiga yang menerima data");
    await expect(third).toContainText("penyedia email");
    await expect(third).toContainText("ekspedisi");
    for (const t of ["wilayah tujuan", "kode pos", "berat"]) await expect(third).toContainText(t);
    await expect(third).toContainText(/tidak[^.]*nama[^.]*nomor HP/i);
    await expect(third).toContainText("payment gateway");
    await expect(third).toContainText("tidak dijual");
    expect(await page.locator("main").innerText()).not.toMatch(VENDORS);
  });

  test("keamanan dan cara meminta hapus akun, dengan tautan ke halaman hapus akun", async ({ page }) => {
    await page.goto("/kebijakan-privasi");
    await expect(section(page, "Keamanan data")).toContainText("dienkripsi");
    const del = section(page, "Menghapus akunmu");
    await expect(del).toContainText("3×24 jam");
    await expect(del).toContainText("10 tahun");
    await expect(del).toContainText("pesanan yang masih berjalan");
    await expect(del.getByRole("link", { name: "Hapus akun" })).toHaveAttribute("href", "/akun/hapus");
  });
});

test.describe("syarat dan ketentuan", () => {
  test("terbuka tanpa masuk, satu h1, dan judul bagian sesuai urutan", async ({ page }) => {
    expect((await page.goto("/syarat-dan-ketentuan"))!.status()).toBe(200);
    await expect(page).toHaveTitle(/Syarat dan ketentuan/);
    await expect(h1(page)).toHaveCount(1);
    await expect(h1(page)).toHaveText("Syarat dan ketentuan");
    expect(await h2s(page)).toEqual(TERMS_H2);
  });

  test("hanya memuat aturan yang benar-benar dijalankan aplikasi", async ({ page }) => {
    await page.goto("/syarat-dan-ketentuan");
    await expect(section(page, "Pembayaran")).toContainText("24 jam");
    await expect(section(page, "Pembayaran")).toContainText("transfer");
    await expect(section(page, "Pembayaran")).toContainText("verifikasi");
    await expect(section(page, "Produk digital")).toContainText("15 menit");
    await expect(section(page, "Produk digital")).toContainText("kode lisensi");
    await expect(section(page, "Produk fisik")).toContainText("nomor resi");
    await expect(section(page, "Produk fisik")).toContainText("14 hari");
    await expect(section(page, "Pembatalan dan pengembalian")).toContainText("di luar aplikasi");
    expect(await page.locator("main").innerText()).not.toMatch(VENDORS);
  });

  test("tautan silang ke kebijakan privasi", async ({ page }) => {
    await page.goto("/syarat-dan-ketentuan");
    await expect(page.locator("main").getByRole("link", { name: "Kebijakan privasi" })).toHaveAttribute("href", "/kebijakan-privasi");
  });
});

test.describe("kontak toko dari pengaturan", () => {
  for (const [path, name] of [["/kebijakan-privasi", "Kontak"], ["/syarat-dan-ketentuan", "Kontak"]] as const) {
    test(`${path}: memakai nama, email, dan telepon dari pengaturan toko`, async ({ page }) => {
      await setSetting("store", { name: "Toko Uji", email: "halo@tokouji.id", phone: "081200000000" });
      await page.goto(path);
      const contact = section(page, name);
      await expect(contact).toContainText("Toko Uji");
      await expect(contact.getByRole("link", { name: "halo@tokouji.id" })).toHaveAttribute("href", "mailto:halo@tokouji.id");
      await expect(contact).toContainText("081200000000");
    });

    test(`${path}: tanpa pengaturan hanya memakai alamat email pengirim, tanpa telepon karangan`, async ({ page }) => {
      await page.goto(path);
      const contact = section(page, name);
      await expect(contact.getByRole("link", { name: "toko@hayatun.my.id" })).toBeVisible();
      await expect(contact).not.toContainText(/\b08\d{8,}/);
      await expect(contact).not.toContainText(/\+62/);
    });
  }
});

test.describe("tautan di semua halaman toko", () => {
  for (const path of ["/", "/daftar", "/masuk", "/kebijakan-privasi", "/syarat-dan-ketentuan"]) {
    test(`footer di ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(footer(page).getByRole("link", { name: "Kebijakan privasi" })).toHaveAttribute("href", "/kebijakan-privasi");
      await expect(footer(page).getByRole("link", { name: "Syarat dan ketentuan" })).toHaveAttribute("href", "/syarat-dan-ketentuan");
    });
  }

  test("footer juga ada untuk pembeli yang masuk", async ({ page, context }) => {
    await context.addCookies([await buyerCookie()]);
    await page.goto("/pesanan");
    await expect(footer(page).getByRole("link", { name: "Kebijakan privasi" })).toBeVisible();
  });

  test("formulir daftar menyebut persetujuan dengan tautan ke kedua halaman", async ({ page }) => {
    await page.goto("/daftar");
    const form = page.locator("form");
    await expect(form).toContainText("Dengan mendaftar, kamu menyetujui");
    await expect(form.getByRole("link", { name: "Syarat dan ketentuan" })).toHaveAttribute("href", "/syarat-dan-ketentuan");
    await expect(form.getByRole("link", { name: "Kebijakan privasi" })).toHaveAttribute("href", "/kebijakan-privasi");
  });

  test("keyboard: Tab sampai tautan footer dan Enter membukanya", async ({ page }) => {
    await page.goto("/");
    const link = footer(page).getByRole("link", { name: "Kebijakan privasi" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/kebijakan-privasi$/);
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: kedua halaman, beranda dengan footer, dan formulir daftar`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      await setSetting("store", { name: "Toko Uji", email: "halo@tokouji.id", phone: "081200000000" });
      for (const path of ["/kebijakan-privasi", "/syarat-dan-ketentuan", "/", "/daftar"]) {
        await page.goto(path);
        await expect(footer(page)).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations, path).toEqual([]);
      }
    });
  }

  test("tanpa guliran mendatar di 360px, dokumen selebar maksimal 800px di layar lebar, dan tautan footer minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    for (const path of ["/kebijakan-privasi", "/syarat-dan-ketentuan"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
    for (const name of ["Kebijakan privasi", "Syarat dan ketentuan"]) {
      expect((await footer(page).getByRole("link", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/kebijakan-privasi");
    expect((await page.getByRole("article").boundingBox())!.width).toBeLessThanOrEqual(800);
  });

  test("tanpa emoji", async ({ page }) => {
    for (const path of ["/kebijakan-privasi", "/syarat-dan-ketentuan"]) {
      await page.goto(path);
      expect(await page.locator("main").innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
