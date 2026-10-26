import { afterAll, describe, expect, it } from "vitest";
import { createMemoryQueue, createPgBossQueue } from "./queue.js";

// butuh `npm -w apps/api run db:migrate` sudah dijalankan; memakai role aplikasi yang terbatas
describe("createPgBossQueue", () => {
  const queuePromise = createPgBossQueue(process.env.DATABASE_URL!);
  afterAll(async () => (await queuePromise).stop());

  it("mengirim dan memproses tugas, dengan atau tanpa opsi retry", async () => {
    const q = await queuePromise;
    const got: unknown[] = [];
    await q.work("t03.test", async (d) => { got.push(d); });
    await q.send("t03.test", { a: 1 });
    await q.send("t03.test", { a: 2 }, { retryLimit: 3, retryDelaySec: 600 });
    await expect.poll(() => got.length, { timeout: 15_000 }).toBe(2);
  }, 20_000);
});

describe("createMemoryQueue", () => {
  it("menahan tugas sampai runAll dipanggil", async () => {
    const q = createMemoryQueue();
    const got: unknown[] = [];
    await q.work("x", async (d) => { got.push(d); });
    await q.send("x", { a: 1 });
    expect(got).toEqual([]);
    await q.runAll();
    expect(got).toEqual([{ a: 1 }]);
  });
});
