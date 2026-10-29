import type { Logger } from "pino";
import { PgBoss } from "pg-boss";

export interface SendOptions { retryLimit?: number; retryDelaySec?: number; startAfter?: Date }

export interface JobQueue {
  send(name: string, data: object, opts?: SendOptions): Promise<void>;
  work<T = unknown>(name: string, handler: (data: T) => Promise<void>): Promise<void>;
  schedule(name: string, cron: string): Promise<void>; // tugas berkala; zona waktu cron UTC
}

export async function createPgBossQueue(url: string, logger?: Logger): Promise<JobQueue & { stop(): Promise<void> }> {
  const boss = new PgBoss({ connectionString: url, migrate: false, createSchema: false }); // skema dibuat oleh db:migrate
  // tanpa pendengar, error internal pg-boss (polling, pemeliharaan) hilang tanpa jejak
  boss.on("error", (err) => logger?.error({ errorName: err.name }, "error antrean pg-boss"));
  await boss.start();
  const known = new Set<string>();
  const ensure = async (name: string) => {
    if (!known.has(name)) { await boss.createQueue(name); known.add(name); }
  };
  return {
    async send(name, data, opts = {}) {
      await ensure(name);
      const o: Record<string, unknown> = {};
      if (opts.retryLimit !== undefined) o.retryLimit = opts.retryLimit;
      if (opts.retryDelaySec !== undefined) o.retryDelay = opts.retryDelaySec;
      if (opts.startAfter) o.startAfter = opts.startAfter;
      await boss.send(name, data, o);
    },
    async work<T>(name: string, handler: (data: T) => Promise<void>) {
      await ensure(name);
      // bawaan pg-boss: 1 tugas per 2 detik (30 per menit), sehingga tumpukan email menahan email yang lebih penting.
      // Ambil sampai 10 sekaligus dan lanjut tanpa jeda selama batch penuh.
      await boss.work(name, { batchSize: 10, pollingIntervalSeconds: 1, burstWhenBatchFull: true }, async (jobs) => { for (const j of jobs) await handler(j.data as T); });
    },
    async schedule(name, cron) {
      await ensure(name);
      await boss.schedule(name, cron, {});
    },
    stop: () => boss.stop(),
  };
}

// untuk tes: tidak menjalankan apa pun sampai runAll() dipanggil
export function createMemoryQueue() {
  const jobs: { name: string; data: object }[] = [];
  const handlers = new Map<string, (data: unknown) => Promise<void>>();
  const schedules: { name: string; cron: string }[] = [];
  return {
    jobs,
    schedules,
    async schedule(name: string, cron: string) { schedules.push({ name, cron }); },
    async send(name: string, data: object) { jobs.push({ name, data }); },
    async work<T>(name: string, handler: (data: T) => Promise<void>) { handlers.set(name, handler as (data: unknown) => Promise<void>); },
    async runAll() {
      while (jobs.length) { const j = jobs.shift()!; await handlers.get(j.name)?.(j.data); }
    },
  };
}
