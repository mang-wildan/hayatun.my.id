import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createCrypto } from "../../api/src/modules/crypto/index";
import { E2E_API_ENV, KEYS, WEB_URL } from "./env";

const crypto = createCrypto({ keys: { k1: KEYS.encryption }, activeKeyId: "k1", blindIndexKey: KEYS.blindIndex });

// Membuat admin lengkap dengan sesi langsung di database, untuk tes yang tidak menguji proses masuk.
export async function adminCookie(email = `admin-${Date.now()}@hayatun.test`) {
  const pool = new pg.Pool({ connectionString: E2E_API_ENV.DATABASE_MIGRATION_URL });
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (role, status, email_enc, email_index, name_enc, email_verified_at, totp_enabled)
     values ('admin', 'active', $1, $2, $3, now(), true) returning id`,
    [crypto.encrypt(email), crypto.blindIndex(email), crypto.encrypt("Admin Tes")],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`,
    [createHash("sha256").update(token).digest("hex"), rows[0].id],
  );
  await pool.end();
  return { name: "hayatun_sid", value: token, url: WEB_URL };
}
