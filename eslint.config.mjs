import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".claude/**", "**/node_modules/**", "**/.next/**", "**/dist/**", "**/drizzle/**", "**/test-results/**", "**/playwright-report/**", "**/*.d.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
  // Berkas CommonJS untuk alat luar (PM2 memuat ops/ecosystem.config.cjs dengan require)
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", process: "readonly" } }, rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["apps/web/**/*.{ts,tsx}"], settings: { next: { rootDir: "apps/web" } }, plugins: { "@next/next": nextPlugin }, rules: { ...nextPlugin.configs["core-web-vitals"].rules } },
);
