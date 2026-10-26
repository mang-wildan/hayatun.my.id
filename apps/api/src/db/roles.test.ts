import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

// butuh `npm -w apps/api run db:migrate` sudah dijalankan
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => app.end());

describe("hak role aplikasi pada audit_logs (F15.4)", () => {
  it("boleh INSERT dan SELECT", async () => {
    await app.query(
      "insert into audit_logs (action, entity_type, entity_id, details) values ('test', 'x', '1', '{}')",
    );
    expect((await app.query("select count(*)::int as n from audit_logs")).rows[0].n).toBeGreaterThan(0);
  });
  it("tidak boleh UPDATE", async () => {
    await expect(app.query("update audit_logs set action = 'ubah'")).rejects.toMatchObject({ code: "42501" });
  });
  it("tidak boleh DELETE", async () => {
    await expect(app.query("delete from audit_logs")).rejects.toMatchObject({ code: "42501" });
  });
  it("tidak boleh TRUNCATE", async () => {
    await expect(app.query("truncate audit_logs")).rejects.toMatchObject({ code: "42501" });
  });
});
