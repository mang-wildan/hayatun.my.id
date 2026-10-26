import { emailSchema } from "@hayatun/shared";
import { and, eq, ne } from "drizzle-orm";
import type { AppDeps } from "../app.js";
import { users } from "../db/schema.js";
import { recordAudit } from "../modules/audit/index.js";
import { issueToken } from "../modules/auth/tokens.js";
import { enqueueEmail } from "../modules/notifications/worker.js";

type Deps = Pick<AppDeps, "config" | "db" | "queue" | "crypto" | "now">;

// F15.1: admin pertama dibuat lewat undangan email, tanpa password bawaan.
// Dijalankan ulang selama undangan belum diterima, undangan baru dikirim (kalau email pertama gagal terkirim).
export async function bootstrapAdmin(deps: Deps): Promise<"invited" | "admin_exists"> {
  const raw = deps.config.adminBootstrapEmail;
  if (!raw) throw new Error("ADMIN_BOOTSTRAP_EMAIL belum diatur");
  const email = emailSchema.parse(raw);

  const [active] = await deps.db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), ne(users.status, "invited"))).limit(1);
  if (active) return "admin_exists";

  const emailIndex = deps.crypto.blindIndex(email);
  const [same] = await deps.db.select().from(users).where(eq(users.emailIndex, emailIndex));
  if (same && (same.role !== "admin" || same.status !== "invited")) {
    throw new Error("Email itu sudah dipakai akun lain. Pilih email lain untuk ADMIN_BOOTSTRAP_EMAIL.");
  }

  const id =
    same?.id ??
    (await deps.db.insert(users).values({ role: "admin", status: "invited", emailEnc: deps.crypto.encrypt(email), emailIndex }).returning({ id: users.id }))[0].id;
  const token = await issueToken(deps.db, "admin_invite", id, deps.now());
  await enqueueEmail(deps.queue, deps.crypto, "admin_invite", email, { link: `${deps.config.appUrl}/admin/undangan?token=${token}` });
  await recordAudit(deps.db, { actorId: null, action: same ? "admin.invite_resent" : "admin.bootstrap", entityType: "user", entityId: id });
  return "invited";
}
