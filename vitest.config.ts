import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: [{ test: { name: "shared", include: ["packages/shared/src/**/*.test.ts"] } }] },
});
