import nodemailer from "nodemailer";
import type { Config } from "../../config.js";

export interface EmailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(msg: EmailMessage): Promise<void> }

export function createSmtpMailer(config: Pick<Config, "smtp" | "emailFrom">): Mailer {
  const { host, port, user, password } = config.smtp;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass: password } : undefined,
  });
  return { send: async (msg) => void (await transport.sendMail({ from: config.emailFrom, ...msg })) };
}

// untuk tes: menyimpan email yang "terkirim"
export function createMemoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, send: async (msg) => void sent.push(msg) };
}
