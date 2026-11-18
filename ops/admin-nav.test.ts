import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { test } from "vitest";

// Run: npx vitest run --project ops ops/admin-nav.test.ts
const source = readFileSync(new URL("../apps/web/components/AdminNav.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const exports: { getAdminNavHref?: (pathname: string) => string | undefined } = {};
runInNewContext(outputText, { exports, require: () => ({}) });
const cases: [string, string | undefined][] = [
  ["/admin", "/admin"],
  ["/admin/", "/admin"],
  ["/admin/pesanan", "/admin/pesanan"],
  ["/admin/pesanan/123", "/admin/pesanan"],
  ["/admin/produk", "/admin/produk"],
  ["/admin/produk/baru", "/admin/produk"],
  ["/admin/produk/123", "/admin/produk"],
  ...["lainnya", "pengiriman", "admin", "log", "pengaturan"].map((section): [string, string] => [`/admin/${section}`, "/admin/lainnya"]),
  ["/admin/produk-lama", undefined],
  ["/admin/unknown", undefined],
  ["/administrator", undefined],
  ["/toko/produk", undefined],
];
test("admin navigation maps exact sections, nested pages, and Lainnya children", () => {
  for (const [pathname, expected] of cases) assert.equal(exports.getAdminNavHref!(pathname), expected, pathname);
});
