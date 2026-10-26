import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", include: ["packages/shared/src/**/*.test.ts"] } },
      {
        test: {
          name: "api",
          include: ["apps/api/src/**/*.test.ts"],
          env: {
            DATABASE_URL: "postgres://hayatun_app:hayatun@127.0.0.1:5432/hayatun_test",
            DATABASE_MIGRATION_URL: "postgres://hayatun_migrate:hayatun@127.0.0.1:5432/hayatun_test",
          },
        },
      },
    ],
  },
});
