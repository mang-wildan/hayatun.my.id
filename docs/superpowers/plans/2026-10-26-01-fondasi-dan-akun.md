# Rencana 1: Fondasi dan Akun — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo Hayatun yang berjalan: pembeli bisa daftar, verifikasi email, login, logout, reset password, dan memakai TOTP opsional; admin pertama bisa menerima undangan dan login dengan TOTP wajib; tampilan dasar toko dan admin memakai token desain; CI menjalankan semua tes.

**Architecture:** npm workspaces dengan `apps/api` (Express 5, satu-satunya yang menyentuh PostgreSQL), `apps/web` (Next.js 16 App Router, hanya tampilan, memanggil API), dan `packages/shared` (skema Zod, format, pesan). Email dikirim lewat antrean tugas pg-boss ke SMTP. Data pribadi dienkripsi per field dengan AES-256-GCM, dan email dicari lewat blind index HMAC.

**Tech Stack:** Node.js 24 LTS, TypeScript 6.0.x, Next.js 16.4.x, React 19.3.x, Express 5.3.x, PostgreSQL 16, drizzle-orm 0.45.x + drizzle-kit 0.31.x, pg 8.x, pg-boss 12.x, Zod 4.x, @node-rs/argon2 2.x, otplib 13.x, nodemailer, pino 10.x + pino-http 11.x, helmet 8.x, cookie-parser, Vitest 5.x, Supertest 7.x, @playwright/test 1.64.x, @axe-core/playwright 4.14.x, Mailpit (SMTP tiruan untuk tes).

**Spec:** `docs/SPEC.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`. Peta semua rencana: `docs/superpowers/plans/2026-10-26-peta-rencana.md`.

## Global Constraints

- Node.js 24 LTS. `"engines": { "node": ">=24" }` di `package.json` root.
- TypeScript **6.0.x** (bukan 7.x: TS 7 memakai compiler baru yang belum pasti didukung semua alat Next.js dan Vitest). Mode `strict`.
- Hanya `apps/api` yang boleh mengimpor `pg`, `drizzle-orm`, `pg-boss`, atau membaca disk privat (ARCHITECTURE K2). `apps/web` tidak pernah menyambung ke database.
- Express dan Next.js hanya mendengarkan di `127.0.0.1` (ARCHITECTURE §6).
- Nama environment variable hanya dari ARCHITECTURE §9. Rencana ini memakai: `NODE_ENV`, `APP_URL`, `APP_TIMEZONE`, `LOG_LEVEL`, `LOG_DIR`, `WEB_PORT`, `API_PORT`, `API_INTERNAL_URL`, `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEYS`, `DATA_ENCRYPTION_ACTIVE_KEY_ID`, `BLIND_INDEX_KEY`, `TOTP_ISSUER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `ADMIN_BOOTSTRAP_EMAIL`.
- Waktu disimpan UTC (`timestamptz`), ditampilkan WIB dengan format `26 Okt 2026, 14.30 WIB` (DESIGN §4).
- Uang selalu bilangan bulat Rupiah, ditampilkan `Rp150.000` (DESIGN §4).
- Semua teks untuk pengguna dalam Bahasa Indonesia santai dengan sapaan "kamu". Tanpa emoji. Pesan error menyebut apa yang terjadi dan apa yang bisa dilakukan (SPEC N10).
- Kolom data pribadi berakhiran `_enc` dan selalu dienkripsi: nama, email, nomor HP, alamat, rahasia TOTP (SPEC F12.1, N2).
- `audit_logs.details` tidak pernah berisi data pribadi (ARCHITECTURE §4).
- Log tidak pernah berisi password, token, cookie, header authorization, email, nomor HP, alamat, atau kode lisensi (SPEC N30).
- Password: Argon2id, minimal 8 karakter, maksimal 128, ditolak bila ada di daftar password umum (SPEC N3).
- Sesi: cookie `hayatun_sid`, `HttpOnly`, `Secure` (kecuali `NODE_ENV=test`/`development`), `SameSite=Lax`, `Path=/`. Admin berakhir setelah 30 menit tidak aktif. Pembeli berakhir 30 hari sejak dibuat (SPEC N4).
- Login gagal 5 kali dalam 15 menit untuk satu email: tolak percobaan berikutnya selama 15 menit dan kirim email ke pemilik akun (SPEC F1.8).
- Tautan reset password: sekali pakai, kedaluwarsa 60 menit (SPEC F1.3).
- Warna, huruf, ukuran, dan komponen hanya dari DESIGN §2–§5, lewat token CSS. Tidak ada kode warna langsung di komponen.
- Area sentuh minimal 44 × 44 px. Teks isi 16 px. Tanpa gulir ke samping di lebar 360 px. WCAG 2.1 AA (SPEC N11–N13).
- Commit kecil per task, pesan bergaya Conventional Commits dalam bahasa Inggris.

## Keputusan rencana ini (belum tertulis di dokumen yang disetujui)

| # | Keputusan | Alasan |
|---|-----------|--------|
| R1 | Tautan verifikasi email berlaku **24 jam**. | SPEC tidak menyebut angka. 24 jam memberi waktu cukup tanpa tautan hidup selamanya. |
| R2 | Undangan admin berlaku **72 jam**. | Admin pertama perlu waktu memasang aplikasi authenticator. |
| R3 | Tantangan TOTP setelah password benar berlaku **5 menit**. | Cukup untuk membuka aplikasi authenticator. |
| R4 | `users.status` ditambah nilai `invited` (selain `active`, `disabled`, `deleted`). | Admin yang diundang belum punya password. |
| R5 | Nama maksimal 100 karakter. Email maksimal 254 karakter. | Batas wajar dan standar panjang email. |
| R6 | Format `DATA_ENCRYPTION_KEYS`: `k1:<base64 32 byte>,k2:<base64 32 byte>`. | Mendukung rotasi kunci (ARCHITECTURE K5). |
| R7 | Daftar password umum: 10.000 password teratas dari SecLists (lisensi MIT), disimpan sebagai file teks di repo. | SPEC N3, tanpa mengirim password ke layanan luar. |
| R9 | Sesi admin juga punya batas mutlak **12 jam** sejak login, selain aturan diam 30 menit. | Supaya admin yang terus aktif tetap login ulang setiap hari. |
| R8 | `apps/web` memakai `rewrites` `/api/:path*` → `API_INTERNAL_URL` untuk pengembangan dan tes end-to-end. Di produksi Nginx yang meneruskan `/api/*`. | Satu domain di semua lingkungan tanpa CORS. |

## Review Focus

1. **Email dengan huruf besar atau spasi** (`"  Budi@Mail.COM "`). Daftar, login, cek duplikat, dan reset harus memperlakukannya sama dengan `budi@mail.com`. Diuji di Task 4 (`blindIndex`) dan Task 9 (daftar lalu login dengan variasi huruf).
2. **Input sangat panjang** (password 10.000 karakter, nama 1.000 karakter). Harus ditolak cepat dengan pesan yang jelas, bukan membuat Argon2 lambat atau mengembalikan error 500. Diuji di Task 2 (skema) dan Task 9 (route register).
3. **Tautan dipakai dua kali bersamaan** (klik ganda tautan verifikasi atau reset). Tepat satu berhasil; yang lain mendapat "Tautannya sudah dipakai". Tidak ada error 500. Diuji di Task 9 dan Task 11.
4. **Sesi admin habis di tengah pengisian** (diam 31 menit). API membalas 401, lalu web mengarahkan ke halaman masuk dengan pesan "Sesimu sudah habis, silakan masuk lagi ya." bukan halaman kosong. Diuji di Task 7 (API) dan Task 14 (web).
5. **SMTP mati saat daftar.** Pendaftaran tetap berhasil (202). Email diulang oleh antrean; pembeli bisa meminta kirim ulang. Diuji di Task 8 dan Task 9.

---

## Struktur file

```
hayatun/  (= /home/user)
├─ package.json                     workspaces, skrip root, engines
├─ tsconfig.base.json
├─ eslint.config.mjs
├─ vitest.config.ts                 projects: shared, api
├─ .env.example                     nama variabel tanpa nilai
├─ .gitignore
├─ .github/workflows/ci.yml
├─ docker-compose.test.yml          postgres:16 + mailpit untuk lokal
├─ packages/shared/
│  ├─ package.json
│  └─ src/
│     ├─ index.ts
│     ├─ money.ts                   formatRupiah
│     ├─ datetime.ts                formatWIB
│     └─ schemas/auth.ts            skema Zod + pesan error
├─ apps/api/
│  ├─ package.json
│  ├─ drizzle.config.ts
│  ├─ drizzle/                      file migrasi SQL hasil drizzle-kit + 0001_roles.sql
│  └─ src/
│     ├─ server.ts                  titik masuk produksi
│     ├─ app.ts                     createApp(deps)
│     ├─ config.ts                  loadConfig(env)
│     ├─ logger.ts                  createLogger, daftar redaksi
│     ├─ errors.ts                  HttpError, errorHandler
│     ├─ db/client.ts
│     ├─ db/schema.ts               tabel rencana ini
│     ├─ jobs/queue.ts              antarmuka JobQueue + pg-boss + memori
│     ├─ modules/crypto/index.ts
│     ├─ modules/audit/index.ts
│     ├─ modules/notifications/{mailer.ts,templates.ts,worker.ts}
│     ├─ modules/auth/{password.ts,common-passwords.txt,tokens.ts,sessions.ts,middleware.ts,lockout.ts,totp.ts,routes.ts,service.ts}
│     ├─ modules/health/routes.ts
│     ├─ scripts/bootstrap-admin.ts
│     └─ test/{setup.ts,context.ts}
└─ apps/web/
   ├─ package.json
   ├─ next.config.ts
   ├─ playwright.config.ts
   ├─ app/
   │  ├─ globals.css                token DESIGN §2–§5
   │  ├─ layout.tsx                 huruf, lang="id"
   │  ├─ (toko)/layout.tsx          bar atas toko
   │  ├─ (toko)/page.tsx            beranda sementara
   │  ├─ (toko)/daftar/page.tsx
   │  ├─ (toko)/masuk/page.tsx
   │  ├─ (toko)/masuk/kode/page.tsx
   │  ├─ (toko)/masuk/atur-kode/page.tsx
   │  ├─ (toko)/verifikasi-email/page.tsx
   │  ├─ (toko)/lupa-password/page.tsx
   │  ├─ (toko)/reset-password/page.tsx
   │  ├─ (toko)/akun/keamanan/page.tsx
   │  ├─ admin/undangan/page.tsx
   │  └─ admin/(panel)/{layout.tsx,page.tsx}
   ├─ components/{TopBar,AdminShell,Button,TextField,FormMessage}.tsx
   ├─ lib/{api-server.ts,api-client.ts}
   └─ e2e/{helpers.ts,auth.spec.ts,admin.spec.ts,a11y.spec.ts}
```

---

### Task 1: Monorepo, paket bersama, dan format

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.test.yml`
- Create: `packages/shared/package.json`, `packages/shared/src/{index.ts,money.ts,datetime.ts}`
- Test: `packages/shared/src/money.test.ts`, `packages/shared/src/datetime.test.ts`

**Interfaces:**
- Produces: `formatRupiah(amount: number): string`, `formatWIB(date: Date): string` dari `@hayatun/shared`.

- [ ] **Step 1: Inisialisasi repo**

Run: `cd /home/user && git init -b main`. Buat `package.json` root: `"private": true`, `"workspaces": ["packages/*", "apps/*"]`, `"engines": {"node": ">=24"}`, skrip `lint`, `typecheck` (`tsc -b`), `test` (`vitest run`), `test:e2e` (`npm -w apps/web run test:e2e`), `build`. `.gitignore`: `node_modules`, `.next`, `dist`, `.env`, `coverage`, `test-results`, `playwright-report`, `.superpowers`. `.env.example`: semua nama variabel di Global Constraints, satu per baris, tanpa nilai. `docker-compose.test.yml`: `postgres:16` (port 5432, user/password/db `hayatun`) dan `axllent/mailpit` (SMTP 1025, API 8025).

- [ ] **Step 2: Tulis tes yang gagal**

```ts
// packages/shared/src/money.test.ts
expect(formatRupiah(150000)).toBe("Rp150.000");
expect(formatRupiah(0)).toBe("Rp0");
expect(formatRupiah(1234567)).toBe("Rp1.234.567");
expect(() => formatRupiah(1.5)).toThrow();

// packages/shared/src/datetime.test.ts
expect(formatWIB(new Date("2026-10-26T07:30:00Z"))).toBe("26 Okt 2026, 14.30 WIB");
expect(formatWIB(new Date("2026-12-31T17:05:00Z"))).toBe("1 Jan 2027, 00.05 WIB");
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npx vitest run --project shared`
Expected: FAIL, `formatRupiah` dan `formatWIB` belum ada.

- [ ] **Step 4: Implementasi**

`formatRupiah` menolak bukan bilangan bulat, memakai pemisah ribuan titik, tanpa spasi setelah "Rp". `formatWIB` memakai zona `Asia/Jakarta` dan singkatan bulan Indonesia tetap (`Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`), tidak bergantung pada data locale ICU mesin.

- [ ] **Step 5: Jalankan tes dan pemeriksaan tipe**

Run: `npx vitest run --project shared && npm run typecheck`
Expected: PASS, 0 error tipe.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold monorepo and shared formatters"
```

---

### Task 2: Skema validasi akun

**Files:**
- Create: `packages/shared/src/schemas/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/auth.test.ts`

**Interfaces:**
- Produces dari `@hayatun/shared`: `emailSchema`, `passwordSchema`, `nameSchema`, `totpCodeSchema`, `registerSchema` (`{name, email, password}`), `loginSchema` (`{email, password}`), `resetPasswordSchema` (`{token, password}`), `acceptInviteSchema` (`{token, name, password}`), dan tipe hasil `z.infer` masing-masing.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
const msg = (r: z.ZodSafeParseResult<unknown>) => r.success ? null : r.error.issues[0].message;
expect(msg(emailSchema.safeParse("budi@"))).toBe("Format emailnya belum benar, coba cek lagi ya.");
expect(emailSchema.parse("  Budi@Mail.COM ")).toBe("budi@mail.com");
expect(msg(emailSchema.safeParse("a".repeat(250) + "@x.id"))).toBe("Emailnya terlalu panjang, maksimal 254 karakter.");
expect(msg(passwordSchema.safeParse("1234567"))).toBe("Password minimal 8 karakter ya.");
expect(msg(passwordSchema.safeParse("a".repeat(129)))).toBe("Password maksimal 128 karakter.");
expect(msg(nameSchema.safeParse("   "))).toBe("Namanya diisi dulu ya.");
expect(msg(nameSchema.safeParse("x".repeat(101)))).toBe("Nama maksimal 100 karakter.");
expect(msg(totpCodeSchema.safeParse("12345"))).toBe("Kodenya 6 angka, coba cek lagi di aplikasi authenticator-mu.");
expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run --project shared`
Expected: FAIL, modul `schemas/auth` belum ada.

- [ ] **Step 3: Implementasi skema dengan Zod 4**

Email: `trim` dan `toLowerCase` sebelum validasi. Nama: `trim`, 1–100 karakter. Kode TOTP: hapus spasi, tepat 6 angka. Pemeriksaan password umum **tidak** di sini (ada di API, Task 5), supaya daftar password tidak ikut ke browser.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): add auth validation schemas with Indonesian messages"
```

---

### Task 3: Kerangka API — konfigurasi, log, error, health, database, antrean

**Files:**
- Create: `apps/api/package.json`, `apps/api/drizzle.config.ts`, `apps/api/src/{config.ts,logger.ts,errors.ts,app.ts,server.ts}`, `apps/api/src/db/{client.ts,schema.ts}`, `apps/api/src/jobs/queue.ts`, `apps/api/src/modules/health/routes.ts`, `apps/api/src/test/{setup.ts,context.ts}`
- Create: `apps/api/drizzle/0000_*.sql` (hasil `drizzle-kit generate`), `apps/api/drizzle/0001_roles.sql`
- Test: `apps/api/src/config.test.ts`, `apps/api/src/logger.test.ts`, `apps/api/src/modules/health/health.test.ts`, `apps/api/src/db/roles.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config`, dengan `Config` berisi semua variabel Global Constraints yang sudah diparse (`apiPort: number`, `encryptionKeys: Record<string, Buffer>`, `activeKeyId: string`, `blindIndexKey: Buffer`, `secureCookies: boolean`, dan lainnya).
  - `createLogger(config: Config): pino.Logger` dan konstanta `REDACT_PATHS: string[]`.
  - `class HttpError extends Error { constructor(status: number, message: string, code?: string) }`, dan `errorHandler` untuk Express.
  - `createDb(url: string): { db: Db; pool: pg.Pool }`, dengan `type Db = NodePgDatabase<typeof schema>`.
  - Tabel di `db/schema.ts`: `users`, `sessions`, `authTokens`, `loginAttempts`, `auditLogs`, `storeSettings` dengan kolom sesuai ARCHITECTURE §4, ditambah `users.status` bernilai `invited` (R4) dan `authTokens.type` bernilai `verify_email | reset_password | admin_invite | mfa_challenge`.
  - `interface JobQueue { send(name: string, data: object, opts?: { retryLimit?: number; retryDelaySec?: number; startAfter?: Date }): Promise<void>; work(name: string, handler: (data: any) => Promise<void>): Promise<void>; }`, dengan `createPgBossQueue(url: string): Promise<JobQueue & { stop(): Promise<void> }>` dan `createMemoryQueue(): JobQueue & { jobs: { name: string; data: object }[]; runAll(): Promise<void> }`.
  - `interface AppDeps { config: Config; db: Db; logger: pino.Logger; queue: JobQueue; now: () => Date }` dan `createApp(deps: AppDeps): express.Express`.
  - Helper tes `createTestContext(overrides?: Partial<AppDeps>): Promise<TestContext>`, dengan `TestContext = { app; db; config; queue: ReturnType<typeof createMemoryQueue>; clock: { now: Date; advance(ms: number): void } }`. Semua tabel di-truncate sebelum setiap tes.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// config.test.ts
expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
const c = loadConfig(validEnv({ DATA_ENCRYPTION_KEYS: "k1:" + b64(32), DATA_ENCRYPTION_ACTIVE_KEY_ID: "k1" }));
expect(c.encryptionKeys.k1.length).toBe(32);
expect(() => loadConfig(validEnv({ DATA_ENCRYPTION_KEYS: "k1:" + b64(16) }))).toThrow(/32 byte/);
expect(() => loadConfig(validEnv({ DATA_ENCRYPTION_ACTIVE_KEY_ID: "k9" }))).toThrow(/k9/);

// logger.test.ts — tulis ke stream memori
log.info({ req: { headers: { cookie: "hayatun_sid=abc", authorization: "x" } }, email: "a@b.id", password: "p", token: "t" }, "hai");
expect(output).not.toMatch(/abc|a@b\.id|"p"|"t"/);

// health.test.ts
await request(ctx.app).get("/api/health").expect(200, { status: "ok" });
// dengan db yang query-nya melempar error:
await request(brokenCtx.app).get("/api/health").expect(503, { status: "error", message: "Database tidak bisa dihubungi." });

// roles.test.ts — sambung sebagai pengguna aplikasi (DATABASE_URL), bukan pengguna migrasi
await db.insert(auditLogs).values({ action: "test", entityType: "x", entityId: "1", details: {} });
await expect(db.update(auditLogs).set({ action: "ubah" })).rejects.toMatchObject({ code: "42501" });
await expect(db.delete(auditLogs)).rejects.toMatchObject({ code: "42501" });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `docker compose -f docker-compose.test.yml up -d && npx vitest run --project api`
Expected: FAIL, modul belum ada.

- [ ] **Step 3: Implementasi config, logger, dan errors**

`loadConfig` memakai Zod dan melempar error yang menyebut nama variabel yang salah. `REDACT_PATHS` mencakup `password`, `*.password`, `token`, `*.token`, `email`, `*.email`, `phone`, `*.phone`, `address`, `*.address`, `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`. `errorHandler`: `HttpError` dikirim sebagai `{ message, code }` dengan status aslinya; `ZodError` menjadi 422 `{ message: <issue pertama>, fields: { <path>: <pesan> } }`; error lain menjadi 500 `{ message: "Ada yang salah di sisi kami. Coba lagi sebentar lagi ya." }` dan dicatat lengkap di log.

- [ ] **Step 4: Implementasi database dan migrasi**

Tulis `db/schema.ts`, lalu jalankan `npx drizzle-kit generate`. `0001_roles.sql` (dijalankan oleh pengguna migrasi):

```sql
-- app role: no UPDATE/DELETE on audit_logs (SPEC F15.4)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hayatun_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM hayatun_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO hayatun_app;
```

Skrip `npm -w apps/api run db:migrate` menjalankan migrasi dengan `DATABASE_MIGRATION_URL`. Di `docker-compose.test.yml` dan CI, buat role `hayatun_app` lewat skrip init Postgres. Helper tes melakukan truncate dengan koneksi migrasi, karena role aplikasi tidak boleh `TRUNCATE` `audit_logs`.

- [ ] **Step 5: Implementasi antrean, app, health, dan server**

`createApp` memasang `helmet()`, `express.json({ limit: "100kb" })`, `cookie-parser`, `pino-http` dengan `genReqId` dari header `x-request-id` (atau UUID baru), router `/api/health`, lalu `errorHandler`. Health menjalankan `select 1`. `server.ts`: `loadConfig(process.env)`, membuat db dan queue pg-boss, `app.listen(config.apiPort, "127.0.0.1")`, mendaftarkan worker (Task 8), menghentikan semuanya dengan rapi saat menerima `SIGTERM`.

- [ ] **Step 6: Jalankan tes**

Run: `npm -w apps/api run db:migrate && npx vitest run --project api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(api): add config, logging, health check, schema and job queue"
```

---

### Task 4: Modul enkripsi dan blind index

**Files:**
- Create: `apps/api/src/modules/crypto/index.ts`
- Test: `apps/api/src/modules/crypto/crypto.test.ts`

**Interfaces:**
- Consumes: `Config.encryptionKeys`, `Config.activeKeyId`, `Config.blindIndexKey` (Task 3).
- Produces: `createCrypto(opts: { keys: Record<string, Buffer>; activeKeyId: string; blindIndexKey: Buffer }): Crypto`, dengan `Crypto = { encrypt(plain: string): string; decrypt(token: string): string; encryptBuffer(b: Buffer): Buffer; decryptBuffer(b: Buffer): Buffer; blindIndex(value: string): string }`. `AppDeps` ditambah `crypto: Crypto`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
const c1 = createCrypto({ keys: { k1 }, activeKeyId: "k1", blindIndexKey });
const t = c1.encrypt("Budi Santoso");
expect(t.startsWith("v1:k1:")).toBe(true);
expect(t).not.toContain("Budi");
expect(c1.encrypt("Budi Santoso")).not.toBe(t);          // IV acak
expect(c1.decrypt(t)).toBe("Budi Santoso");
const c2 = createCrypto({ keys: { k1, k2 }, activeKeyId: "k2", blindIndexKey });
expect(c2.decrypt(t)).toBe("Budi Santoso");                // kunci lama tetap bisa membuka
expect(c2.encrypt("x").startsWith("v1:k2:")).toBe(true);
expect(() => c1.decrypt(t.slice(0, -2) + "AA")).toThrow(); // diubah orang = ditolak
expect(c1.decryptBuffer(c1.encryptBuffer(Buffer.from([1, 2, 3])))).toEqual(Buffer.from([1, 2, 3]));
expect(c1.blindIndex("  Budi@Mail.COM ")).toBe(c1.blindIndex("budi@mail.com"));
expect(c1.blindIndex("budi@mail.com")).not.toBe(createCrypto({ keys: { k1 }, activeKeyId: "k1", blindIndexKey: other }).blindIndex("budi@mail.com"));
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/crypto`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

AES-256-GCM dengan IV acak 12 byte. Format string: `v1:<keyId>:<iv b64url>:<tag b64url>:<ciphertext b64url>`. Format buffer: header `v1` + panjang keyId + keyId + IV + tag + ciphertext. `blindIndex` = HMAC-SHA256 hex atas `value.normalize("NFKC").trim().toLowerCase()`.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/crypto`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/crypto && git commit -m "feat(api): add field encryption with key rotation and blind index"
```

---

### Task 5: Password

**Files:**
- Create: `apps/api/src/modules/auth/password.ts`, `apps/api/src/modules/auth/common-passwords.txt`
- Test: `apps/api/src/modules/auth/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(p: string): Promise<string>`, `verifyPassword(hash: string, p: string): Promise<boolean>`, `isCommonPassword(p: string): boolean`.

- [ ] **Step 1: Ambil daftar password**

Unduh `Passwords/Common-Credentials/10k-most-common.txt` dari repo SecLists (MIT) ke `common-passwords.txt`. Tambahkan satu baris sumber dan lisensi di bagian atas file, diawali `#`.

- [ ] **Step 2: Tulis tes yang gagal**

```ts
const h = await hashPassword("rahasia-hayatun-1");
expect(h.startsWith("$argon2id$")).toBe(true);
expect(await verifyPassword(h, "rahasia-hayatun-1")).toBe(true);
expect(await verifyPassword(h, "salah")).toBe(false);
expect(isCommonPassword("password")).toBe(true);
expect(isCommonPassword("PASSWORD")).toBe(true);
expect(isCommonPassword("rahasia-hayatun-1")).toBe(false);
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/password`
Expected: FAIL.

- [ ] **Step 4: Implementasi**

`@node-rs/argon2` varian Argon2id dengan parameter bawaan pustaka (minimal setara rekomendasi OWASP: memori 19 MiB, 2 iterasi). Daftar dibaca sekali ke `Set` dalam huruf kecil, mengabaikan baris yang diawali `#`.

- [ ] **Step 5: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/password`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/password.ts apps/api/src/modules/auth/common-passwords.txt apps/api/src/modules/auth/password.test.ts
git commit -m "feat(api): add argon2id password hashing and common password check"
```

---

### Task 6: Token sekali pakai dan log aktivitas

**Files:**
- Create: `apps/api/src/modules/auth/tokens.ts`, `apps/api/src/modules/audit/index.ts`
- Test: `apps/api/src/modules/auth/tokens.test.ts`, `apps/api/src/modules/audit/audit.test.ts`

**Interfaces:**
- Produces:
  - `TOKEN_TTL = { verify_email: 24 * 3600_000, reset_password: 60 * 60_000, admin_invite: 72 * 3600_000, mfa_challenge: 5 * 60_000 }` (R1, R2, R3, SPEC F1.3).
  - `issueToken(db: Db, type: TokenType, userId: string, now: Date): Promise<string>`: mengembalikan token acak 32 byte base64url. Yang disimpan hanya hash SHA-256-nya.
  - `consumeToken(db: Db, type: TokenType, token: string, now: Date): Promise<{ userId: string } | { error: "invalid" | "expired" | "used" }>`: atomik; hanya satu pemanggil yang berhasil.
  - `recordAudit(db: Db, entry: { actorId: string | null; action: string; entityType: string; entityId: string; details?: Record<string, string | number | boolean> }): Promise<void>`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
const t = await issueToken(db, "reset_password", userId, now);
const rows = await db.select().from(authTokens);
expect(rows[0].tokenHash).not.toBe(t);
const [a, b] = await Promise.all([consumeToken(db, "reset_password", t, now), consumeToken(db, "reset_password", t, now)]);
expect([a, b].filter(r => "userId" in r)).toHaveLength(1);
expect([a, b].find(r => "error" in r)).toEqual({ error: "used" });
const t2 = await issueToken(db, "reset_password", userId, now);
expect(await consumeToken(db, "reset_password", t2, new Date(+now + 60 * 60_000 + 1))).toEqual({ error: "expired" });
expect(await consumeToken(db, "verify_email", t2, now)).toEqual({ error: "invalid" }); // jenis berbeda
await recordAudit(db, { actorId: adminId, action: "admin.bootstrap", entityType: "user", entityId: adminId });
expect((await db.select().from(auditLogs))[0]).toMatchObject({ action: "admin.bootstrap", actorId: adminId });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/tokens apps/api/src/modules/audit`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

`consumeToken` memakai satu `UPDATE auth_tokens SET used_at = now WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > now RETURNING user_id`. Bila 0 baris berubah, baca baris itu untuk membedakan `used`, `expired`, dan `invalid`.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/tokens apps/api/src/modules/audit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/tokens* apps/api/src/modules/audit && git commit -m "feat(api): add single-use tokens and audit log"
```

---

### Task 7: Sesi dan pemeriksa akses

**Files:**
- Create: `apps/api/src/modules/auth/sessions.ts`, `apps/api/src/modules/auth/middleware.ts`
- Test: `apps/api/src/modules/auth/sessions.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE = "hayatun_sid"`, `ADMIN_IDLE_MS = 30 * 60_000`, `BUYER_MAX_AGE_MS = 30 * 24 * 3600_000`.
  - `createSession(db: Db, user: { id: string; role: "buyer" | "admin" }, now: Date): Promise<{ token: string; expiresAt: Date }>`.
  - `resolveSession(db: Db, token: string, now: Date): Promise<SessionUser | null>`, dengan `SessionUser = { userId: string; role: "buyer" | "admin"; sessionId: string }`. Untuk admin, `last_seen_at` diperbarui dan sesi ditolak bila sudah diam lebih dari 30 menit. Sesi milik pengguna yang statusnya bukan `active` juga ditolak.
  - `revokeUserSessions(db: Db, userId: string): Promise<void>`, `revokeSession(db: Db, sessionId: string): Promise<void>`.
  - `setSessionCookie(res, token, expiresAt, secure: boolean)` dan `clearSessionCookie(res)`.
  - Middleware: `loadSession(deps)` (mengisi `req.session?: SessionUser`), `requireBuyer`, `requireAdmin`. Bila gagal: 401 `{ message: "Sesimu sudah habis, silakan masuk lagi ya.", code: "SESSION_EXPIRED" }` atau 403 `{ message: "Kamu tidak punya akses ke halaman ini.", code: "FORBIDDEN" }`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
const { token } = await createSession(db, admin, clock.now);
clock.advance(29 * 60_000); expect(await resolveSession(db, token, clock.now)).not.toBeNull();
clock.advance(29 * 60_000); expect(await resolveSession(db, token, clock.now)).not.toBeNull(); // aktif terus, tidak habis
clock.advance(31 * 60_000); expect(await resolveSession(db, token, clock.now)).toBeNull();
const b = await createSession(db, buyer, clock.now);
clock.advance(30 * 24 * 3600_000 + 1); expect(await resolveSession(db, b.token, clock.now)).toBeNull();
expect((await db.select().from(sessions))[0].idHash).not.toBe(token);
// rute uji di dalam app tes
await request(ctx.app).get("/api/__test/admin-only").set("Cookie", `hayatun_sid=${buyerToken}`).expect(403);
const res = await request(ctx.app).get("/api/__test/admin-only").set("Cookie", `hayatun_sid=${expiredAdminToken}`).expect(401);
expect(res.body.code).toBe("SESSION_EXPIRED");
// atribut cookie
expect(setCookieHeader).toMatch(/hayatun_sid=.+; Path=\/; Expires=.+; HttpOnly; Secure; SameSite=Lax/);
```

Rute `/api/__test/*` hanya didaftarkan oleh `createTestContext`, tidak pernah oleh `createApp` di produksi.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/sessions`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

Token sesi 32 byte acak base64url. `sessions.id_hash` = SHA-256 token. Admin: `expires_at = now + 12 jam` sebagai batas mutlak (R9), ditambah aturan diam 30 menit. Pembeli: `expires_at = now + 30 hari`, tanpa aturan diam. Cookie `Secure` mengikuti `config.secureCookies`.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/sessions* apps/api/src/modules/auth/middleware.ts && git commit -m "feat(api): add server-side sessions with admin idle timeout"
```

---

### Task 8: Email lewat antrean

**Files:**
- Create: `apps/api/src/modules/notifications/{mailer.ts,templates.ts,worker.ts}`
- Test: `apps/api/src/modules/notifications/notifications.test.ts`, `apps/api/src/jobs/pgboss.test.ts`

**Interfaces:**
- Consumes: `JobQueue` (Task 3), `Crypto` (Task 4).
- Produces:
  - `interface Mailer { send(msg: { to: string; subject: string; text: string; html: string }): Promise<void> }`, dengan `createSmtpMailer(config): Mailer` (nodemailer) dan `createMemoryMailer(): Mailer & { sent: {to: string; subject: string; text: string; html: string}[] }`.
  - `type EmailTemplate = "verify_email" | "email_already_registered" | "reset_password" | "login_locked" | "admin_invite"`.
  - `enqueueEmail(queue: JobQueue, crypto: Crypto, template: EmailTemplate, to: string, data: Record<string, string>): Promise<void>`: alamat penerima dienkripsi di data tugas (tidak tersimpan terbuka di tabel pg-boss). Opsi retry: `{ retryLimit: 3, retryDelaySec: 600 }`, yaitu 3 kali dalam 30 menit (SPEC F11.4).
  - `registerEmailWorker(queue: JobQueue, deps: { mailer: Mailer; crypto: Crypto; config: Config; logger }): Promise<void>`. Nama tugas: `"email.send"`.
  - `renderEmail(template: EmailTemplate, data: Record<string, string>): { subject: string; text: string; html: string }`.
  - `AppDeps` ditambah `mailer: Mailer`. `TestContext` ditambah `mailer: ReturnType<typeof createMemoryMailer>`, dan `createTestContext({ mailer })` boleh menggantinya.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
await enqueueEmail(queue, crypto, "verify_email", "budi@mail.com", { name: "Budi", link: "https://hayatun.id/verifikasi-email?token=abc" });
expect(JSON.stringify(queue.jobs[0].data)).not.toContain("budi@mail.com");
await queue.runAll();
expect(mailer.sent[0]).toMatchObject({ to: "budi@mail.com", subject: "Verifikasi email akun Hayatun-mu" });
expect(mailer.sent[0].text).toContain("https://hayatun.id/verifikasi-email?token=abc");
expect(renderEmail("reset_password", { name: "Budi", link: "L" }).text).toContain("berlaku 60 menit");
expect(renderEmail("login_locked", { name: "Budi" }).subject).toBe("Ada percobaan masuk ke akun Hayatun-mu");
for (const t of ALL_TEMPLATES) expect(renderEmail(t, sample[t]).text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // tanpa emoji

// pgboss.test.ts — pg-boss sungguhan, mailer yang gagal sekali lalu berhasil
await enqueueEmail(boss, crypto, "verify_email", "budi@mail.com", data);
await waitFor(() => flakyMailer.sent.length === 1, { retryDelaySecOverride: 1 });
expect(flakyMailer.attempts).toBe(2);
```

Tes pg-boss memakai `retryDelaySec: 1` lewat parameter opsional `enqueueEmail(..., { retryDelaySec })` khusus tes, supaya tes tidak menunggu 10 menit.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/notifications apps/api/src/jobs`
Expected: FAIL.

- [ ] **Step 3: Implementasi templat**

Bahasa santai "kamu", tanpa emoji, tanpa data pribadi selain nama penerima. Subjek tetap:

| Templat | Subjek |
|---------|--------|
| `verify_email` | Verifikasi email akun Hayatun-mu |
| `email_already_registered` | Ada yang mencoba daftar dengan emailmu |
| `reset_password` | Atur ulang password Hayatun-mu |
| `login_locked` | Ada percobaan masuk ke akun Hayatun-mu |
| `admin_invite` | Undangan jadi admin Hayatun |

HTML sederhana: satu kolom, lebar maksimal 560 px, nama toko berwarna `#9D174D`, tombol hijau `#166534` dengan teks putih, dan tautan teks yang sama di bawah tombol.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/notifications apps/api/src/jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications apps/api/src/jobs && git commit -m "feat(api): send templated emails through retrying job queue"
```

---

### Task 9: Daftar dan verifikasi email (F1.1, F1.2, F1.6, F1.7)

**Files:**
- Create: `apps/api/src/modules/auth/service.ts`, `apps/api/src/modules/auth/routes.ts`
- Modify: `apps/api/src/app.ts` (pasang `/api/auth`)
- Test: `apps/api/src/modules/auth/register.test.ts`

**Interfaces:**
- Consumes: Task 2, 4, 5, 6, 7, 8.
- Produces rute:
  - `POST /api/auth/register {name, email, password}` → selalu `202 { message: "Cek emailmu ya. Kami kirim tautan untuk verifikasi akun." }` bila validasi lolos.
  - `POST /api/auth/verify-email {token}` → `200 { message: "Emailmu sudah terverifikasi. Selamat belanja!" }`, atau `400` dengan `code` `TOKEN_INVALID`, `TOKEN_EXPIRED`, atau `TOKEN_USED`.
  - `POST /api/auth/resend-verification {email}` → selalu `202` dengan pesan yang sama seperti register.
  - `GET /api/auth/me` → `200 { id, name, email, role, emailVerified: boolean, totpEnabled: boolean }` atau `401`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
await request(app).post("/api/auth/register").send({ name: "Budi", email: " Budi@Mail.com", password: "rahasia-hayatun-1" }).expect(202);
const [u] = await db.select().from(users);
expect(u.emailEnc).not.toContain("budi");
expect(crypto.decrypt(u.emailEnc)).toBe("budi@mail.com");
expect(u.emailVerifiedAt).toBeNull();
await queue.runAll();
const link = extractLink(mailer.sent[0].text); // .../verifikasi-email?token=...

// F1.6: email terdaftar → jawaban sama, tidak ada akun kedua, email pemberitahuan
const r2 = await request(app).post("/api/auth/register").send({ name: "Orang Lain", email: "budi@mail.com", password: "lain-lagi-123" }).expect(202);
expect(r2.body.message).toBe("Cek emailmu ya. Kami kirim tautan untuk verifikasi akun.");
expect(await db.$count(users)).toBe(1);
await queue.runAll();
expect(mailer.sent[1].subject).toBe("Ada yang mencoba daftar dengan emailmu");

// N3
const weak = await request(app).post("/api/auth/register").send({ name: "Budi", email: "c@mail.com", password: "password123" }).expect(422);
expect(weak.body.fields.password).toBe("Password ini terlalu umum dan gampang ditebak. Pakai yang lebih unik ya.");

// Review Focus 2: input sangat panjang ditolak cepat
const t0 = Date.now();
await request(app).post("/api/auth/register").send({ name: "Budi", email: "d@mail.com", password: "a".repeat(10_000) }).expect(422);
expect(Date.now() - t0).toBeLessThan(200);

// F1.7 + Review Focus 3: verifikasi sekali, klik ganda aman
const tok = tokenFrom(link);
const [v1, v2] = await Promise.all([1, 2].map(() => request(app).post("/api/auth/verify-email").send({ token: tok })));
expect([v1.status, v2.status].sort()).toEqual([200, 400]);
expect([v1, v2].find(r => r.status === 400)!.body).toMatchObject({ code: "TOKEN_USED", message: "Tautannya sudah dipakai. Kalau emailmu belum terverifikasi, minta tautan baru ya." });
clock.advance(24 * 3600_000 + 1);
expect((await request(app).post("/api/auth/verify-email").send({ token: freshTokenIssuedBeforeAdvance })).body.code).toBe("TOKEN_EXPIRED");

// Review Focus 5: SMTP mati → daftar tetap 202
const ctxDown = await createTestContext({ mailer: failingMailer });
await request(ctxDown.app).post("/api/auth/register").send(valid).expect(202);
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/register`
Expected: FAIL.

- [ ] **Step 3: Implementasi `registerBuyer`, `verifyEmail`, `resendVerification` di `service.ts` dan rutenya**

Urutan register: validasi skema → `isCommonPassword` → cari `email_index` → bila ada, antrekan `email_already_registered` dan kembalikan 202 → bila tidak ada, buat pengguna (`role` buyer, `status` active, nama dan email terenkripsi), terbitkan token `verify_email`, antrekan email, kembalikan 202. Tautan memakai `${config.appUrl}/verifikasi-email?token=`. Pesan untuk token `invalid` dan `expired`: "Tautannya tidak berlaku lagi. Minta tautan verifikasi baru ya."

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/register`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src && git commit -m "feat(api): buyer registration and email verification"
```

---

### Task 10: Login, logout, dan penguncian (F1.8, N4)

**Files:**
- Create: `apps/api/src/modules/auth/lockout.ts`
- Modify: `apps/api/src/modules/auth/{service.ts,routes.ts}`
- Test: `apps/api/src/modules/auth/login.test.ts`

**Interfaces:**
- Produces:
  - `LOCKOUT = { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }`.
  - `checkLocked(db, emailIndex, now): Promise<boolean>`, `recordAttempt(db, emailIndex, success: boolean, now): Promise<{ justLocked: boolean }>`.
  - `POST /api/auth/login {email, password}`. Hasilnya salah satu dari:
    - `200 { next: "done", user }` dan cookie sesi;
    - `200 { next: "totp", challenge }` (TOTP aktif, Task 12);
    - `200 { next: "totp_setup", challenge }` (admin tanpa TOTP, Task 12);
    - `401 { message: "Email atau password-nya belum cocok.", code: "BAD_CREDENTIALS" }`;
    - `429 { message: "Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi ya.", code: "LOCKED" }`.
  - `POST /api/auth/logout` → `204` dan cookie dihapus.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
await loginAs("BUDI@mail.com ", "rahasia-hayatun-1").expect(200);         // Review Focus 1
for (let i = 0; i < 5; i++) await loginAs("budi@mail.com", "salah").expect(401);
await loginAs("budi@mail.com", "rahasia-hayatun-1").expect(429);          // password benar pun ditolak
await queue.runAll();
expect(mailer.sent.filter(m => m.subject === "Ada percobaan masuk ke akun Hayatun-mu")).toHaveLength(1);
clock.advance(15 * 60_000 + 1);
await loginAs("budi@mail.com", "rahasia-hayatun-1").expect(200);
await loginAs("tidakada@mail.com", "apa-saja-123").expect(401);            // email tidak dikenal: pesan sama
expect((await loginAs("tidakada@mail.com", "x".repeat(8))).body.message).toBe("Email atau password-nya belum cocok.");
const res = await loginAs("budi@mail.com", "rahasia-hayatun-1");
await request(app).post("/api/auth/logout").set("Cookie", cookieOf(res)).expect(204);
await request(app).get("/api/auth/me").set("Cookie", cookieOf(res)).expect(401);
// admin nonaktif tidak bisa login
await loginAs(disabledAdminEmail, pw).expect(401);
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/login`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

Percobaan untuk email yang tidak dikenal tetap dicatat (lewat `email_index`), tapi email penguncian tidak dikirim. Untuk email yang tidak dikenal, verifikasi password tetap dijalankan terhadap hash palsu, supaya waktu jawab tidak membocorkan apakah email terdaftar. `login_attempts` yang lebih tua dari 1 hari dibersihkan oleh tugas berkala `"auth.cleanup"` setiap jam, yang didaftarkan di `server.ts`.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/login`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src && git commit -m "feat(api): login, logout and brute-force lockout"
```

---

### Task 11: Lupa dan reset password (F1.3, F1.7)

**Files:**
- Modify: `apps/api/src/modules/auth/{service.ts,routes.ts}`
- Test: `apps/api/src/modules/auth/reset.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/auth/forgot-password {email}` → selalu `202 { message: "Kalau emailnya terdaftar, kami sudah kirim tautan untuk atur ulang password." }`.
  - `POST /api/auth/reset-password {token, password}` → `200 { message: "Password-mu sudah diganti. Silakan masuk lagi ya." }`. Semua sesi pengguna itu dicabut.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
await request(app).post("/api/auth/forgot-password").send({ email: "tidakada@mail.com" }).expect(202);
await queue.runAll(); expect(mailer.sent).toHaveLength(0);
const session = await loginCookie("budi@mail.com", "rahasia-hayatun-1");
await request(app).post("/api/auth/forgot-password").send({ email: "Budi@mail.com" }).expect(202);
await queue.runAll(); const tok = tokenFrom(extractLink(mailer.sent[0].text));
const [a, b] = await Promise.all([1, 2].map(() => request(app).post("/api/auth/reset-password").send({ token: tok, password: "baru-sekali-2026" })));
expect([a.status, b.status].sort()).toEqual([200, 400]);
await request(app).get("/api/auth/me").set("Cookie", session).expect(401);   // sesi lama dicabut
await loginAs("budi@mail.com", "baru-sekali-2026").expect(200);
// kedaluwarsa 60 menit
clock.advance(60 * 60_000 + 1);
expect((await resetWith(tokenIssuedBefore, "apa-saja-2026")).body.code).toBe("TOKEN_EXPIRED");
expect((await resetWith(otherTok, "password1")).status).toBe(422);          // password umum ditolak
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/reset`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

Tautan: `${config.appUrl}/reset-password?token=`. Reset password juga menandai `email_verified_at` bila masih kosong, karena pengguna sudah membuktikan bisa membuka emailnya.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/reset`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src && git commit -m "feat(api): password reset with single-use expiring link"
```

---

### Task 12: Verifikasi dua langkah (F1.4, F15.2)

**Files:**
- Create: `apps/api/src/modules/auth/totp.ts`
- Modify: `apps/api/src/modules/auth/{service.ts,routes.ts}`
- Test: `apps/api/src/modules/auth/totp.test.ts`

**Interfaces:**
- Produces:
  - `generateTotpSecret(): string`, `totpUri(secret: string, accountLabel: string, issuer: string): string`, `verifyTotp(secret: string, code: string, now: Date): boolean` (periode 30 detik, toleransi ±1 langkah).
  - `POST /api/auth/login/totp {challenge, code}` → `200 { next: "done", user }` dan cookie, atau `401 { message: "Kodenya belum cocok. Coba kode terbaru di aplikasi authenticator-mu.", code: "BAD_TOTP" }`. Kode yang salah juga dihitung sebagai percobaan gagal untuk penguncian (Task 10).
  - `POST /api/auth/totp/setup {challenge?}` → `200 { otpauthUri, secret }`. Memakai sesi pembeli, atau `challenge` untuk admin yang belum memasang TOTP. Rahasia disimpan sementara terenkripsi di `users.totp_secret_enc` dengan `totp_enabled = false`.
  - `POST /api/auth/totp/confirm {code, challenge?}` → `200`. Untuk admin lewat challenge, sekaligus membuat sesi (`next: "done"`).
  - `POST /api/auth/totp/disable {code}` → `200`, khusus pembeli. Admin mendapat `403 { message: "Admin wajib memakai verifikasi dua langkah.", code: "TOTP_REQUIRED" }`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// admin tanpa TOTP: login → wajib pasang
const r = await loginAs(adminEmail, adminPw).expect(200);
expect(r.body.next).toBe("totp_setup");
expect(r.headers["set-cookie"]).toBeUndefined();                            // belum ada sesi
const setup = await post("/api/auth/totp/setup", { challenge: r.body.challenge }).expect(200);
expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Hayatun/);
await post("/api/auth/totp/confirm", { challenge: r.body.challenge, code: codeFor(setup.body.secret, clock.now) }).expect(200);
// login berikutnya: wajib kode
const r2 = await loginAs(adminEmail, adminPw); expect(r2.body.next).toBe("totp");
await post("/api/auth/login/totp", { challenge: r2.body.challenge, code: "000000" }).expect(401);
await post("/api/auth/login/totp", { challenge: r2.body.challenge, code: codeFor(secret, clock.now) }).expect(200);
clock.advance(5 * 60_000 + 1);
await post("/api/auth/login/totp", { challenge: r3Challenge, code: codeFor(secret, clock.now) }).expect(400); // tantangan kedaluwarsa
// pembeli: opsional
const buyer = await loginCookie("budi@mail.com", pw);
expect((await get("/api/auth/me", buyer)).body.totpEnabled).toBe(false);
// admin tidak bisa mematikan TOTP
await post("/api/auth/totp/disable", { code: codeFor(secret, clock.now) }, adminCookie).expect(403);
// rahasia tersimpan terenkripsi
expect((await db.select().from(users).where(eq(users.id, adminId)))[0].totpSecretEnc).not.toContain(secret);
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/modules/auth/totp`
Expected: FAIL.

- [ ] **Step 3: Implementasi dengan otplib 13**

Label akun memakai nama toko dari `TOTP_ISSUER` dan email pengguna (otpauth URI hanya ditampilkan ke pemilik akun itu sendiri). Challenge memakai `issueToken(db, "mfa_challenge", ...)` dari Task 6. Kode yang sama tidak boleh dipakai dua kali dalam jendela 30 detik: simpan langkah waktu terakhir yang berhasil di `users.totp_last_step` (kolom baru, migrasi baru).

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/modules/auth/totp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/drizzle && git commit -m "feat(api): TOTP two-step login, mandatory for admins"
```

---

### Task 13: Admin pertama lewat undangan

**Files:**
- Create: `apps/api/src/scripts/bootstrap-admin.ts`
- Modify: `apps/api/src/modules/auth/{service.ts,routes.ts}`, `apps/api/package.json` (skrip `admin:bootstrap`)
- Test: `apps/api/src/scripts/bootstrap-admin.test.ts`

**Interfaces:**
- Produces:
  - `bootstrapAdmin(deps: AppDeps): Promise<"invited" | "admin_exists">`.
  - `POST /api/auth/accept-invite {token, name, password}` → `200 { next: "totp_setup", challenge }`. Status pengguna menjadi `active`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
expect(await bootstrapAdmin({ ...deps, config: { ...config, adminBootstrapEmail: "pemilik@hayatun.id" } })).toBe("invited");
expect(await bootstrapAdmin(deps)).toBe("admin_exists");                    // hanya sekali
await queue.runAll();
expect(mailer.sent[0].subject).toBe("Undangan jadi admin Hayatun");
const tok = tokenFrom(extractLink(mailer.sent[0].text));                   // .../admin/undangan?token=
await loginAs("pemilik@hayatun.id", "apa-saja-123").expect(401);           // status invited belum bisa login
const r = await post("/api/auth/accept-invite", { token: tok, name: "Pemilik", password: "admin-hayatun-2026" }).expect(200);
expect(r.body.next).toBe("totp_setup");
expect((await db.select().from(auditLogs)).map(a => a.action)).toEqual(["admin.bootstrap", "admin.invite_accepted"]);
clock.advance(72 * 3600_000 + 1);
expect((await post("/api/auth/accept-invite", { token: oldTok, name: "X", password: "admin-hayatun-2026" })).body.code).toBe("TOKEN_EXPIRED");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run apps/api/src/scripts`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

Skrip CLI: `npm -w apps/api run admin:bootstrap` membaca `.env`, memanggil `bootstrapAdmin`, menjalankan antrean sampai email terkirim, lalu mencetak "Undangan admin terkirim ke email yang diatur di ADMIN_BOOTSTRAP_EMAIL." atau "Admin sudah ada. Tidak ada yang diubah." Alamat email tidak dicetak ke terminal.

- [ ] **Step 4: Jalankan tes**

Run: `npx vitest run apps/api/src/scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "feat(api): bootstrap first admin via email invite"
```

---

### Task 14: Kerangka tampilan web dan token desain

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`
- Create: `apps/web/app/{globals.css,layout.tsx}`, `apps/web/app/(toko)/{layout.tsx,page.tsx}`, `apps/web/app/admin/(panel)/{layout.tsx,page.tsx}`
- Create: `apps/web/components/{TopBar,AdminShell,Button,TextField,FormMessage}.tsx`, `apps/web/lib/{api-server.ts,api-client.ts}`
- Test: `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/session.spec.ts`

**Interfaces:**
- Consumes: `GET /api/auth/me` (Task 9).
- Produces:
  - `apiServer<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; body: { message: string; code?: string } }>`: dipanggil di server, membaca `cookies()` dan meneruskan `hayatun_sid` ke `API_INTERNAL_URL`.
  - `apiClient<T>(path: string, body?: unknown): Promise<...>` dengan bentuk hasil yang sama, memanggil `/api/...` relatif. Status 401 dengan code `SESSION_EXPIRED` mengarahkan ke `/masuk?pesan=sesi-habis`.
  - Komponen:
    - `<Button variant="primary" | "secondary" | "danger" loading?>`
    - `<TextField label hint? error? type name autoComplete inputMode?>`
    - `<FormMessage tone="error" | "ok">`
    - `<TopBar user?>`
    - `<AdminShell>`
  - `getCurrentUser(): Promise<User | null>` di `lib/api-server.ts`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// a11y.spec.ts
for (const width of [360, 768, 1280]) for (const path of ["/", "/masuk", "/daftar"]) {
  test(`${path} @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(path);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
test("beranda menyebut toko dan isinya", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Hayatun" })).toBeVisible();
  await expect(page.getByText("E-book, template, aplikasi, dan produk pilihan dari Hayatun.")).toBeVisible();
});
test("area sentuh minimal 44px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto("/masuk");
  // tautan di dalam kalimat dikecualikan (WCAG 2.5.8)
  for (const el of await page.locator("button, input, header a, nav a").all()) {
    const b = (await el.boundingBox())!; expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
});
// session.spec.ts — Review Focus 4
test("sesi admin habis diarahkan ke halaman masuk", async ({ page, context }) => {
  await context.addCookies([{ name: "hayatun_sid", value: "kedaluwarsa", url: BASE }]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/masuk\?pesan=sesi-habis/);
  await expect(page.getByText("Sesimu sudah habis, silakan masuk lagi ya.")).toBeVisible();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:e2e -- a11y session`
Expected: FAIL, aplikasi web belum ada.

- [ ] **Step 3: Token dan tata letak**

`globals.css` mendefinisikan di `:root` semua token DESIGN §2 dengan nama yang sama: `--canvas`, `--surface`, `--canvas-admin`, `--ink`, `--ink-soft`, `--line`, `--line-strong`, `--brand`, `--brand-tint`, `--action`, `--action-pressed`, serta `--ok`/`--ok-bg`, `--wait`/`--wait-bg`, `--danger`/`--danger-bg`, `--neutral`/`--neutral-bg` (warna latar status dari DESIGN §2). Tambahkan juga skala jarak 4 px, lengkungan (`--radius-card: 16px`, `--radius-control: 12px`), titik patah 768 dan 1024, `--focus-ring: 2px solid var(--action)` dengan offset 2 px, dan `@media (prefers-reduced-motion: reduce)` yang mematikan transisi. Huruf dimuat lewat `next/font/google`: `Outfit` (400, 500, 600, 700) dan `JetBrains_Mono` (400, 500). `<html lang="id">`. Bar atas toko mengikuti DESIGN §6 (tanpa hamburger). `AdminShell`: navigasi bawah berlabel (Verifikasi, Pesanan, Produk, Lainnya) di bawah 1024 px, dan menu samping 240 px dari 1024 px ke atas. Untuk sekarang semua menunya mengarah ke halaman kosong dengan pesan keadaan kosong. Layout `admin/(panel)` memanggil `getCurrentUser()`. Bila pengguna tidak ada atau bukan admin, arahkan ke `/masuk` (dengan `?pesan=sesi-habis` bila API membalas `SESSION_EXPIRED`). Beranda sementara berisi kalimat pembuka dan keadaan kosong "Produk Hayatun sedang disiapkan. Mampir lagi sebentar lagi ya." Katalog diganti di Rencana 2.

- [ ] **Step 4: Jalankan tes**

Run: `npm run test:e2e -- a11y session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): design tokens, store and admin shells"
```

---

### Task 15: Halaman akun

**Files:**
- Create: halaman `(toko)/daftar`, `(toko)/masuk`, `(toko)/masuk/kode`, `(toko)/masuk/atur-kode`, `(toko)/verifikasi-email`, `(toko)/lupa-password`, `(toko)/reset-password`, `(toko)/akun/keamanan`, `admin/undangan`
- Create: `apps/web/e2e/{helpers.ts,auth.spec.ts,admin.spec.ts}`

**Interfaces:**
- Consumes: semua rute `/api/auth/*` (Task 9–13), komponen Task 14, skema Task 2 (validasi di browser sebelum kirim; server tetap yang menentukan).
- Produces: helper e2e `latestEmailTo(address: string): Promise<{ subject: string; text: string }>` yang membaca API Mailpit di `http://127.0.0.1:8025`, dan `totpNow(secret: string): string`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// auth.spec.ts
test("daftar, verifikasi, masuk, keluar", async ({ page }) => {
  const email = `budi+${Date.now()}@mail.test`;
  await page.goto("/daftar");
  await page.getByLabel("Nama").fill("Budi");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("rahasia-hayatun-1");
  await page.getByRole("button", { name: "Daftar" }).click();
  await expect(page.getByText("Cek emailmu ya. Kami kirim tautan untuk verifikasi akun.")).toBeVisible();
  await page.goto(linkFrom((await latestEmailTo(email)).text));
  await expect(page.getByText("Emailmu sudah terverifikasi. Selamat belanja!")).toBeVisible();
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByLabel("Password").fill("rahasia-hayatun-1");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("link", { name: "Akun" })).toBeVisible();
});
test("error tampil di bawah kolomnya", async ({ page }) => {
  await page.goto("/daftar");
  await page.getByLabel("Password").fill("1234567");
  await page.getByRole("button", { name: "Daftar" }).click();
  const field = page.getByLabel("Password");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Password minimal 8 karakter ya.")).toBeVisible();
  await expect(field).toHaveAccessibleDescription(/Password minimal 8 karakter ya\./);
});
test("lupa password sampai bisa masuk dengan password baru", async ({ page }) => { /* forgot → email → reset → masuk */ });
test("tombol tidak bisa ditekan dua kali saat memproses", async ({ page }) => {
  // tahan respons register 1 detik lewat page.route; klik dua kali
  // harapkan tepat 1 permintaan POST /api/auth/register dan label "Mendaftarkan…"
});

// admin.spec.ts
test("undangan admin → password → pasang TOTP → panel", async ({ page }) => {
  await runBootstrap("pemilik@hayatun.test");
  await page.goto(linkFrom((await latestEmailTo("pemilik@hayatun.test")).text));
  await page.getByLabel("Nama").fill("Pemilik");
  await page.getByLabel("Password").fill("admin-hayatun-2026");
  await page.getByRole("button", { name: "Simpan dan lanjut" }).click();
  await expect(page).toHaveURL(/\/masuk\/atur-kode/);
  const secret = await page.getByTestId("totp-secret").innerText();
  await page.getByLabel("Kode 6 angka").fill(totpNow(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation", { name: "Menu admin" })).toBeVisible();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:e2e -- auth admin`
Expected: FAIL.

- [ ] **Step 3: Implementasi halaman**

Setiap formulir punya satu kolom, label di atas, `autoComplete` yang sesuai (`email`, `new-password`, `current-password`, `one-time-code`), dan `inputMode="numeric"` untuk kode. Hanya ada satu tombol utama. Error dari server ditampilkan di kolom yang disebut di `fields`, dan error umum lewat `FormMessage` yang diumumkan ke pembaca layar (`role="alert"`). Setelah login, `next` dari API menentukan tujuan: `done` ke `/` (pembeli) atau `/admin` (admin), `totp` ke `/masuk/kode`, dan `totp_setup` ke `/masuk/atur-kode`. Challenge dibawa lewat `sessionStorage` dan tidak pernah ditulis ke URL. Halaman atur kode menampilkan rahasia sebagai teks JetBrains Mono dengan tombol "Salin" (DESIGN §5), plus tautan `otpauth://` untuk HP. Halaman `/akun/keamanan` untuk pembeli bisa mengaktifkan dan mematikan TOTP. `?pesan=sesi-habis` di `/masuk` menampilkan "Sesimu sudah habis, silakan masuk lagi ya."

- [ ] **Step 4: Jalankan semua tes**

Run: `npm test && npm run test:e2e`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): register, login, password reset, TOTP and admin invite pages"
```

---

### Task 16: CI

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`

**Interfaces:**
- Consumes: skrip root `lint`, `typecheck`, `test`, `build`, `test:e2e`, dan `npm -w apps/api run db:migrate`.

- [ ] **Step 1: Tulis workflow**

Pemicu: `pull_request` dan `push` ke `main`. Job `test` di `ubuntu-latest` dengan Node 24 dan layanan `postgres:16` (dengan skrip init yang membuat role `hayatun_app`) serta `axllent/mailpit`. Langkah: `npm ci` → `npm run lint` → `npm run typecheck` → `npm -w apps/api run db:migrate` → `npm test` → `npm run build` → `npx playwright install --with-deps chromium` → `npm run test:e2e` → `npm audit --audit-level=high`. Unggah `playwright-report` bila gagal. Semua nilai env di CI adalah nilai tes yang ditulis di workflow, bukan rahasia produksi. `dependabot.yml`: npm mingguan untuk root, dan github-actions mingguan.

- [ ] **Step 2: Verifikasi lokal setara**

Run: `docker compose -f docker-compose.test.yml up -d && npm ci && npm run lint && npm run typecheck && npm -w apps/api run db:migrate && npm test && npm run build && npm run test:e2e && npm audit --audit-level=high`
Expected: semua langkah exit 0.

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: run lint, types, unit, integration, e2e and audit"
```

---

## Cakupan SPEC di rencana ini

| SPEC | Task |
|------|------|
| F1.1 akun wajib untuk checkout | Pemeriksa `requireBuyer` di Task 7. Dipakai di checkout pada Rencana 3. |
| F1.2 verifikasi email | Task 9. Blokir checkout bila belum terverifikasi ada di Rencana 3. |
| F1.3, F1.7 reset dan tautan | Task 6, 11 |
| F1.4 TOTP opsional pembeli | Task 12, 15 |
| F1.5 hapus akun | Rencana 6 |
| F1.6 email terdaftar | Task 9 |
| F1.8 penguncian | Task 10 |
| F11 (email akun) | Task 8 |
| F15.2 TOTP wajib admin | Task 12 |
| F15.3–F15.4 log aktivitas (dasar) | Task 3 (hak database), Task 6 |
| F12.1 enkripsi data pribadi | Task 4, 9 |
| N1 | Rencana 7 (Nginx dan TLS). Cookie `Secure` ada di Task 7. |
| N2, N3, N4 | Task 4, 5, 7, 10 |
| N10 pesan error | Task 2, 3, 9–15 |
| N11–N15 | Task 14, 15 |
| N16 kurangi gerakan | Task 14 |
| N30 log tanpa data sensitif | Task 3 |
| N33 tes otomatis | Seluruhnya. Uji transisi pesanan ada di Rencana 3–5. |
| N34 audit dependensi | Task 16 |
