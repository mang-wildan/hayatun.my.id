import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // N33: setiap cabang mesin status pesanan wajib teruji
      thresholds: { "apps/api/src/modules/orders/state-machine.ts": { branches: 100, functions: 100, lines: 100, statements: 100 } },
    },
    projects: [
      { test: { name: "shared", include: ["packages/shared/src/**/*.test.ts"] } },
      {
        test: {
          name: "api",
          include: ["apps/api/src/**/*.test.ts"],
          fileParallelism: false, // berkas tes berbagi satu database
          env: {
            DATABASE_URL: "postgres://hayatun_app:hayatun@127.0.0.1:5432/hayatun_test",
            DATABASE_MIGRATION_URL: "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_test",
          },
        },
      },
    ],
  },
});
