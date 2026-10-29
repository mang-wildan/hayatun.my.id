import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, buyerCookie, enableTotp, latestEmailTo, resetAdmins, totpEnabledOf } from "./helpers";
import { WEB_URL } from "./env";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

let A: { email: string; cookie: Awaited<ReturnType<typeof adminCookie>> };
let B: { email: string; cookie: Awaited<ReturnType<typeof adminCookie>> };
test.beforeEach(async ({ context }) => {
  await resetAdmins();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  A = { email: `admin-a-${stamp}@hayatun.test`, cookie: await adminCookie(`admin-a-${stamp}@hayatun.test`) };
  B = { email: `admin-b-${stamp}@hayatun.test`, cookie: await adminCookie(`admin-b-${stamp}@hayatun.test`) };
  await context.addCookies([A.cookie]);
});
test.afterAll(resetAdmins);

const item = (page: Page, email: string) => page.getByTestId("admin-item").filter({ hasText: email });
const note = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const inviteForm = (page: Page) => page.getByRole("form", { name: "Undang admin" });
const searchForm = (page: Page) => page.getByRole("form", { name: "Cari pembeli" });
const asB = (path: string) => fetch(`${WEB_URL}${path}`, { headers: { Cookie: `${B.cookie.name}=${B.cookie.value}` } });

test.describe("daftar dan undang admin (F15.1)", () => {
  test("menu Lainnya membuka halaman Admin, dan daftar menampilkan status tiap admin", async ({ page }) => {
    await page.goto("/admin/lainnya");
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    await expect(page.getByTestId("admin-item")).toHaveCount(2);
    await expect(item(page, A.email)).toContainText("Aktif");
    await expect(item(page, B.email)).toContainText("Aktif");
  });

  test("undangan terkirim: pesan, muncul sebagai Diundang, dan email undangan sampai ke alamatnya", async ({ page }) => {
    const email = `baru-${Date.now()}@hayatun.test`;
    await page.goto("/admin/admin");
    await inviteForm(page).getByLabel("Email admin baru").fill(email);
    await inviteForm(page).getByRole("button", { name: "Kirim undangan" }).click();
    await expect(note(page, `Undangan dikirim ke ${email}`)).toBeVisible();
    await expect(item(page, email)).toContainText("Diundang");
    const mail = await latestEmailTo(email, "Undangan jadi admin Hayatun");
    expect(mail.text).toContain("/admin/undangan?token=");
  });

  test("email salah, admin aktif, dan akun pembeli ditolak dengan pesan di bawah kolom; Enter mengirim", async ({ page }) => {
    const buyer = `pembeli-${Date.now()}@hayatun.test`;
    await buyerCookie(buyer);
    await page.goto("/admin/admin");
    const field = inviteForm(page).getByLabel("Email admin baru");
    await field.fill("bukan-email");
    await field.press("Enter");
    await expect(inviteForm(page).getByText("Format email belum benar.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await field.fill(B.email);
    await inviteForm(page).getByRole("button", { name: "Kirim undangan" }).click();
    await expect(inviteForm(page).getByText("Email ini sudah menjadi admin aktif.")).toBeVisible();
    await field.fill(buyer);
    await inviteForm(page).getByRole("button", { name: "Kirim undangan" }).click();
    await expect(inviteForm(page).getByText("Email ini sudah dipakai akun pembeli.")).toBeVisible();
  });
});

test.describe("menonaktifkan admin (F15.5, F15.6)", () => {
  test("konfirmasi menyebut admin; Batal tidak mengubah; konfirmasi menonaktifkan dan sesinya langsung mati", async ({ page }) => {
    await page.goto("/admin/admin");
    expect((await asB("/api/admin/admins")).status).toBe(200);
    await item(page, B.email).getByRole("button", { name: /Nonaktifkan/ }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`^Nonaktifkan .*${B.email.split("@")[0]}`) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(item(page, B.email)).toContainText("Aktif");
    await item(page, B.email).getByRole("button", { name: /Nonaktifkan/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, nonaktifkan" }).click();
    await expect(item(page, B.email)).toContainText("Dinonaktifkan");
    await expect(item(page, B.email).getByRole("button", { name: /Nonaktifkan/ })).toHaveCount(0);
    expect((await asB("/api/admin/admins")).status).toBe(401);
  });

  test("admin terakhir tidak bisa dinonaktifkan: pesan tampil dan tetap Aktif", async ({ page }) => {
    await page.goto("/admin/admin");
    await item(page, B.email).getByRole("button", { name: /Nonaktifkan/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, nonaktifkan" }).click();
    await expect(item(page, B.email)).toContainText("Dinonaktifkan");
    await item(page, A.email).getByRole("button", { name: /Nonaktifkan/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, nonaktifkan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Admin terakhir tidak bisa dinonaktifkan." })).toBeVisible();
    await expect(item(page, A.email)).toContainText("Aktif");
  });

  test("menonaktifkan diri sendiri (masih ada admin lain): sesi berakhir dan diarahkan ke halaman masuk", async ({ page }) => {
    await page.goto("/admin/admin");
    await item(page, A.email).getByRole("button", { name: /Nonaktifkan/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, nonaktifkan" }).click();
    await expect(page).toHaveURL(/\/masuk/);
  });
});

test.describe("membantu pembeli yang kehilangan HP", () => {
  test("cari lewat email, matikan verifikasi dua langkah dengan konfirmasi, dan pembeli diberi tahu", async ({ page }) => {
    const email = `pembeli-hp-${Date.now()}@hayatun.test`;
    await buyerCookie(email);
    await enableTotp(email);
    await page.goto("/admin/admin");
    await searchForm(page).getByLabel("Email pembeli").fill(email.toUpperCase());
    await searchForm(page).getByRole("button", { name: "Cari" }).click();
    const result = page.getByRole("region", { name: "Hasil pencarian pembeli" });
    await expect(result).toContainText("Pembeli Tes");
    await expect(result).toContainText("Verifikasi dua langkah: Aktif");
    await result.getByRole("button", { name: "Matikan verifikasi dua langkah" }).click();
    const dialog = page.getByRole("dialog", { name: "Matikan verifikasi dua langkah Pembeli Tes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    expect(await totpEnabledOf(email)).toBe(true);
    await result.getByRole("button", { name: "Matikan verifikasi dua langkah" }).click();
    await dialog.getByRole("button", { name: "Ya, matikan" }).click();
    await expect(note(page, "Verifikasi dua langkah Pembeli Tes dimatikan")).toBeVisible();
    await expect(result).toContainText("Verifikasi dua langkah: Belum aktif");
    expect(await totpEnabledOf(email)).toBe(false);
    expect((await latestEmailTo(email, "Verifikasi dua langkahmu dimatikan oleh toko")).text).toContain("bukan kamu");
  });

  test("email tidak dikenal atau kosong: pesan di bawah kolom", async ({ page }) => {
    await page.goto("/admin/admin");
    await searchForm(page).getByRole("button", { name: "Cari" }).click();
    await expect(searchForm(page).getByText("Email diisi dulu ya.")).toBeVisible();
    await searchForm(page).getByLabel("Email pembeli").fill("tidak-ada@hayatun.test");
    await searchForm(page).getByRole("button", { name: "Cari" }).click();
    await expect(searchForm(page).getByText("Akun pembeli dengan email itu tidak ditemukan.")).toBeVisible();
  });
});

test.describe("akses, tampilan, dan aksesibilitas", () => {
  test("pembeli diarahkan ke halaman masuk", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([await buyerCookie()]);
    const page = await ctx.newPage();
    await page.goto("/admin/admin");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });

  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: daftar, kesalahan, hasil pencarian, dan dialog`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      const email = `pembeli-a11y-${Date.now()}@hayatun.test`;
      await buyerCookie(email);
      await enableTotp(email);
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin/admin"); await scan();
      await inviteForm(page).getByLabel("Email admin baru").fill("bukan-email");
      await inviteForm(page).getByRole("button", { name: "Kirim undangan" }).click();
      await expect(inviteForm(page).getByText("Format email belum benar.")).toBeVisible(); await scan();
      await searchForm(page).getByLabel("Email pembeli").fill(email);
      await searchForm(page).getByRole("button", { name: "Cari" }).click();
      await expect(page.getByRole("region", { name: "Hasil pencarian pembeli" })).toBeVisible(); await scan();
      await item(page, B.email).getByRole("button", { name: /Nonaktifkan/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible(); await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; kolom dan tombol minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/admin/admin");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [inviteForm(page).getByLabel("Email admin baru"), inviteForm(page).getByRole("button", { name: "Kirim undangan" }), item(page, B.email).getByRole("button", { name: /Nonaktifkan/ }), searchForm(page).getByRole("button", { name: "Cari" })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
