import { defineConfig } from "@playwright/test";
import { E2E_API_ENV, WEB_URL } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1, // semua tes berbagi satu database
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_URL,
    // di container tanpa build Playwright yang cocok, arahkan ke Chromium yang sudah ada
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: "npm -w apps/api run start",
      cwd: "../..",
      url: "http://127.0.0.1:4000/api/health",
      env: E2E_API_ENV,
      stdout: "pipe", // log server API (sudah disamarkan, N30) ikut tampil di laporan CI, supaya kegagalan email dll. bisa dilacak
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm -w apps/web run build && npm -w apps/web run start",
      cwd: "../..",
      url: `${WEB_URL}/api/health`, // lewat rewrite Next.js, jadi sekaligus membuktikan web dan API tersambung
      env: { API_INTERNAL_URL: E2E_API_ENV.API_INTERNAL_URL },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
