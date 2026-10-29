import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../logger.js";
import { createMemoryQueue } from "../../jobs/queue.js";
import { createCrypto } from "../crypto/index.js";
import { createMemoryMailer } from "./mailer.js";
import { renderEmail, type EmailTemplate } from "./templates.js";
import { enqueueEmail, registerEmailWorker } from "./worker.js";

const LINK = "https://hayatun.my.id/verifikasi-email?token=TOKEN-RAHASIA-123";
// low_stock punya data sendiri dan dites di modules/products/low-stock.test.ts
type Tpl = Exclude<EmailTemplate, "low_stock" | "order_expired" | "order_reminder" | "payment_accepted" | "payment_rejected" | "order_created" | "proof_uploaded">; // butuh data khusus; diuji di modulnya
const SUBJECTS: Record<Tpl, string> = {
  verify_email: "Verifikasi email akun Hayatun-mu",
  email_already_registered: "Ada yang mencoba daftar dengan emailmu",
  reset_password: "Atur ulang password Hayatun-mu",
  login_locked: "Ada percobaan masuk ke akun Hayatun-mu",
  admin_invite: "Undangan jadi admin Hayatun",
};
const TEMPLATES = Object.keys(SUBJECTS) as Tpl[];
const NEEDS_LINK: Tpl[] = ["verify_email", "reset_password", "admin_invite"];
const data = (t: Tpl) => ({ name: "Budi", ...(NEEDS_LINK.includes(t) ? { link: LINK } : {}) });

describe("renderEmail", () => {
  it.each(TEMPLATES)("%s: subjek tetap, teks dan HTML terisi, tanpa emoji", (t) => {
    const e = renderEmail(t, data(t));
    expect(e.subject).toBe(SUBJECTS[t]);
    expect(e.text.length).toBeGreaterThan(20);
    expect(e.html).toContain("<html");
    expect(e.text + e.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(e.text).toContain("Budi");
  });

  it.each(NEEDS_LINK)("%s: tautan ada di teks dan di tombol HTML", (t) => {
    const e = renderEmail(t, data(t));
    expect(e.text).toContain(LINK);
    expect(e.html).toContain(`href="${LINK}"`);
  });

  it("menyebut masa berlaku tautan sesuai SPEC", () => {
    expect(renderEmail("reset_password", data("reset_password")).text).toContain("berlaku 60 menit");
    expect(renderEmail("verify_email", data("verify_email")).text).toContain("berlaku 24 jam");
    expect(renderEmail("admin_invite", data("admin_invite")).text).toContain("berlaku 72 jam");
  });

  it("memakai warna merek dan bahasa santai", () => {
    const e = renderEmail("verify_email", data("verify_email"));
    expect(e.html).toContain("#9D174D");
    expect(e.html).toContain("#166534");
    expect(e.html).toMatch(/max-width:\s*560px/);
    expect(e.text).toMatch(/\bkamu\b/i);
  });

  it("nama yang berisi markup di-escape di HTML", () => {
    const e = renderEmail("verify_email", { name: `<script>alert(1)</script>"><img src=x onerror=1>`, link: LINK });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<img");
    expect(e.html).toContain("&lt;script&gt;");
  });

  it("nama tidak bisa mengubah subjek (header injection)", () => {
    const e = renderEmail("verify_email", { name: "Budi\r\nBcc: jahat@x.id", link: LINK });
    expect(e.subject).toBe(SUBJECTS.verify_email);
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it("undangan admin boleh tanpa nama", () => {
    expect(() => renderEmail("admin_invite", { link: LINK })).not.toThrow();
  });

  it("templat yang butuh tautan menolak data tanpa tautan", () => {
    expect(() => renderEmail("reset_password", { name: "Budi" })).toThrow(/link/);
  });
});

describe("enqueueEmail + registerEmailWorker", () => {
  const crypto = createCrypto({ keys: { k1: randomBytes(32) }, activeKeyId: "k1", blindIndexKey: randomBytes(32) });
  const capture = () => {
    let out = "";
    return { stream: new Writable({ write(c, _e, cb) { out += c; cb(); } }), text: () => out };
  };

  it("isi tugas terenkripsi seluruhnya: tanpa alamat, nama, atau token terbaca", async () => {
    const queue = createMemoryQueue();
    await enqueueEmail(queue, crypto, "verify_email", "budi@mail.com", data("verify_email"));
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].name).toBe("email.send");
    expect(JSON.stringify(queue.jobs[0].data)).not.toMatch(/budi|Budi|TOKEN-RAHASIA/);
  });

  it("mengirim ke alamat dan isi yang benar", async () => {
    const queue = createMemoryQueue();
    const mailer = createMemoryMailer();
    await registerEmailWorker(queue, { mailer, crypto, logger: createLogger({ logLevel: "silent" }) });
    await enqueueEmail(queue, crypto, "verify_email", "budi@mail.com", data("verify_email"));
    await queue.runAll();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "budi@mail.com", subject: SUBJECTS.verify_email });
    expect(mailer.sent[0].text).toContain(LINK);
  });

  it("kegagalan SMTP dilempar ulang tanpa alamat (agar antrean mengulang), dan log tanpa alamat", async () => {
    const queue = createMemoryQueue();
    const log = capture();
    const failing = { async send() { throw new Error("550 mailbox budi@mail.com tidak ditemukan"); } };
    await registerEmailWorker(queue, { mailer: failing, crypto, logger: createLogger({ logLevel: "info" }, log.stream) });
    await enqueueEmail(queue, crypto, "reset_password", "budi@mail.com", data("reset_password"));
    const err = await queue.runAll().then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("Gagal mengirim email");
    expect(err!.message).not.toContain("budi");
    expect(log.text()).toContain("reset_password"); // kegagalan tercatat dengan nama templat (F11.4)
    expect(log.text()).not.toMatch(/budi|TOKEN-RAHASIA/);
  });
});
