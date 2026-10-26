import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "../../db/schema.js";
import { insertUser, resetDb, testDb } from "../../test/db.js";
import { recordAudit } from "./index.js";

const { db, pool } = testDb();
beforeEach(resetDb);
afterAll(() => pool.end());

describe("recordAudit (F15.3)", () => {
  it("mencatat pelaku, aksi, entitas, rincian, dan waktu", async () => {
    const adminId = await insertUser(db, { role: "admin" });
    await recordAudit(db, { actorId: adminId, action: "admin.bootstrap", entityType: "user", entityId: adminId, details: { via: "cli", ulang: false } });
    const [row] = await db.select().from(auditLogs);
    expect(row).toMatchObject({ actorId: adminId, action: "admin.bootstrap", entityType: "user", entityId: adminId, details: { via: "cli", ulang: false } });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("pelaku boleh kosong untuk aksi sistem, rincian default kosong", async () => {
    await recordAudit(db, { actorId: null, action: "order.expired", entityType: "order", entityId: "INV/2026/10/0001" });
    expect((await db.select().from(auditLogs))[0]).toMatchObject({ actorId: null, details: {} });
  });

  it("rincian hanya menerima nilai sederhana (bukan objek data pribadi)", async () => {
    // @ts-expect-error objek bersarang ditolak oleh tipe
    await recordAudit(db, { actorId: null, action: "x", entityType: "x", entityId: "1", details: { buyer: { email: "a@b.id" } } }).catch(() => {});
  });
});
