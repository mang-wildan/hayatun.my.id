import { PgBoss } from "pg-boss";

export interface SendOptions { retryLimit?: number; retryDelaySec?: number; startAfter?: Date }

export interface JobQueue {
  send(name: string, data: object, opts?: SendOptions): Promise<void>;
  work(name: string, handler: (data: any) => Promise<void>): Promise<void>;
}

export async function createPgBossQueue(url: string): Promise<JobQueue & { stop(): Promise<void> }> {
  const boss = new PgBoss({ connectionString: url, migrate: false, createSchema: false }); // skema dibuat oleh db:migrate
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
    async work(name, handler) {
      await ensure(name);
      await boss.work(name, async (jobs) => { for (const j of jobs) await handler(j.data); });
    },
    stop: () => boss.stop(),
  };
}

// untuk tes: tidak menjalankan apa pun sampai runAll() dipanggil
export function createMemoryQueue() {
  const jobs: { name: string; data: object }[] = [];
  const handlers = new Map<string, (data: any) => Promise<void>>();
  return {
    jobs,
    async send(name: string, data: object) { jobs.push({ name, data }); },
    async work(name: string, handler: (data: any) => Promise<void>) { handlers.set(name, handler); },
    async runAll() {
      while (jobs.length) { const j = jobs.shift()!; await handlers.get(j.name)?.(j.data); }
    },
  };
}
