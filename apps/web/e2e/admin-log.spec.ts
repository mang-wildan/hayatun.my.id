import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCookie, auditTotal, buyerCookie, clearAudit, resetAdmins, seedAudit, seedAuditBulk } from "./helpers";

const WIDTHS = [360, 768, 1280];
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

let email: string;
test.beforeEach(async ({ context }) => {
  await resetAdmins();
  await clearAudit();
  email = `admin-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hayatun.test`;
  await context.addCookies([await adminCookie(email)]);
});
test.afterAll(async () => { await resetAdmins(); await clearAudit(); });

const items = (page: Page) => page.getByTestId("log-item");

async function seedSome() {
  await seedAudit([
    { actorEmail: email, action: "payment.accepted", entityId: "e2e-a", minutesAgo: 30 },
    { actorEmail: email, action: "payment_proof.viewed", entityId: "e2e-b", minutesAgo: 20 },
    { actorEmail: email, action: "user.viewed", entityType: "user", entityId: "e2e-c", minutesAgo: 10 },
    { action: "order.expired", entityId: "e2e-d", minutesAgo: 1 },
  ]);
}

test.describe("halaman log aktivitas (F15.3, F15.4)", () => {
  test("menu Lainnya membuka Log aktivitas; terbaru dulu dengan aksi, pelaku, dan waktu WIB", async ({ page }) => {
    await seedSome();
    await page.goto("/admin/lainnya");
    await page.getByRole("link", { name: "Log aktivitas" }).click();
    await expect(page).toHaveURL(/\/admin\/log$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log aktivitas" })).toBeVisible();
    await expect(items(page)).toHaveCount(4);
    await expect(items(page).nth(0)).toContainText("Pesanan kedaluwarsa");
    await expect(items(page).nth(0)).toContainText("Sistem");
    await expect(items(page).nth(1)).toContainText("Membuka data pembeli");
    await expect(items(page).nth(1)).toContainText("Admin Tes");
    await expect(items(page).nth(1)).toContainText(/WIB/);
    await expect(items(page).nth(3)).toContainText("Pembayaran diterima");
    await expect(items(page).nth(2)).toContainText("Membuka bukti bayar");
  });

  test("tampil apa adanya tanpa tombol ubah atau hapus", async ({ page }) => {
    await seedSome();
    await page.goto("/admin/log");
    await expect(items(page).first()).toBeVisible();
    await expect(items(page).getByRole("button")).toHaveCount(0);
    await expect(items(page).getByRole("link")).toHaveCount(0);
  });

  test("filter jenis aksi mengubah daftar dan alamat; Semua aksi mengembalikan", async ({ page }) => {
    await seedSome();
    await page.goto("/admin/log");
    await page.getByLabel("Jenis aksi").selectOption({ label: "Membuka data pembeli" });
    await expect(page).toHaveURL(/action=user\.viewed/);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText("Membuka data pembeli");
    await page.getByLabel("Jenis aksi").selectOption({ label: "Semua aksi" });
    await expect(items(page)).toHaveCount(4);
  });

  test("lebih dari 50 catatan: halaman bernomor, Berikutnya dan Sebelumnya", async ({ page }) => {
    await seedAuditBulk(email, 120);
    await page.goto("/admin/log");
    await expect(items(page)).toHaveCount(50);
    await expect(page.getByText("Halaman 1 dari 3")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sebelumnya" })).toHaveCount(0);
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("Halaman 2 dari 3")).toBeVisible();
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(items(page)).toHaveCount(20);
    await expect(page.getByRole("link", { name: "Berikutnya" })).toHaveCount(0);
    await page.getByRole("link", { name: "Sebelumnya" }).click();
    await expect(page.getByText("Halaman 2 dari 3")).toBeVisible();
  });

  test("belum ada catatan: pesan kosong; membuka halaman tidak menambah catatan", async ({ page }) => {
    await page.goto("/admin/log");
    await expect(page.getByText("Belum ada catatan.")).toBeVisible();
    const before = await auditTotal();
    await page.reload();
    await page.goto("/admin/log?page=1");
    expect(await auditTotal()).toBe(before);
  });

  test("halaman di luar jangkauan atau tidak valid tidak membuat error", async ({ page }) => {
    await seedSome();
    await page.goto("/admin/log?page=99");
    await expect(page.getByRole("heading", { level: 1, name: "Log aktivitas" })).toBeVisible();
    await expect(page.getByText("Belum ada catatan.")).toBeVisible();
    await page.goto("/admin/log?page=abc");
    await expect(items(page)).toHaveCount(4);
  });

  test("pembeli diarahkan ke halaman masuk", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
    await ctx.addCookies([await buyerCookie()]);
    const page = await ctx.newPage();
    await page.goto("/admin/log");
    await expect(page).toHaveURL(/\/masuk/);
    await ctx.close();
  });
});

test.describe("tampilan dan aksesibilitas", () => {
  for (const width of WIDTHS) {
    test(`tanpa pelanggaran WCAG di ${width}px: daftar, terfilter, dan kosong`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
      await seedSome();
      await seedAuditBulk(email, 60);
      const scan = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
      await page.goto("/admin/log"); await expect(items(page).first()).toBeVisible(); await scan();
      await page.getByLabel("Jenis aksi").selectOption({ label: "Membuka data pembeli" });
      await expect(items(page)).toHaveCount(1); await scan();
      await page.goto("/admin/log?page=99"); await expect(page.getByText("Belum ada catatan.")).toBeVisible(); await scan();
    });
  }

  test("tanpa guliran mendatar di 360px; filter dan tautan halaman minimal 44px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await seedAuditBulk(email, 60);
    await page.goto("/admin/log");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const l of [page.getByLabel("Jenis aksi"), page.getByRole("link", { name: "Berikutnya" })]) {
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
