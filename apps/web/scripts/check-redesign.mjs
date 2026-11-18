/* global document, innerWidth */
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
const { fetch } = globalThis;
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Isolated visual fixture: no production API, credentials, or database writes.
const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/auth/me") { res.statusCode = 401; res.end('{}'); return; }
  res.end(JSON.stringify({ products: [
    { id: "sample", slug: "contoh", name: "Contoh produk untuk uji tampilan", type: "digital", price: 45000, available: true, coverUrl: null },
    { id: "physical", slug: "contoh-fisik", name: "Contoh produk fisik", type: "physical", price: 65000, available: false, coverUrl: null },
  ] }));
});
await new Promise((resolve) => api.listen(4100, "127.0.0.1", resolve));
const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "apps/web", "-H", "127.0.0.1", "-p", "3100"], {
  cwd: new URL("../../..", import.meta.url), env: { ...process.env, API_INTERNAL_URL: "http://127.0.0.1:4100" }, stdio: "inherit",
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch("http://127.0.0.1:3100")).ok) { ready = true; break; } } catch { /* Server belum siap; coba kembali sampai batas waktu. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "Isolated Next server must start");
  browser = await chromium.launch();
  await mkdir("test-results/redesign", { recursive: true });
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [320, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const route of ["/", "/masuk"]) {
        await page.goto(`http://127.0.0.1:3100${route}`);
        await page.locator("h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator("h1").count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${route} ${width} ${colorScheme}`);
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        assert.deepEqual(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map((n) => n.target) })), [], `${route} ${width} ${colorScheme}`);
        await page.screenshot({ path: `test-results/redesign/${route === "/" ? "store" : "login"}-${width}-${colorScheme}.png`, fullPage: true });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log("PASS: storefront/login, 320/768/1280px, light/dark, axe AA, overflow, runtime errors.");
} finally {
  await browser?.close();
  web.kill();
  api.closeAllConnections();
  api.close();
}
