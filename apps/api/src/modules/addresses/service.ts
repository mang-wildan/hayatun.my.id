import { createAddressSchema, MAX_ADDRESSES, updateAddressSchema } from "@hayatun/shared";
import { and, asc, count, eq } from "drizzle-orm";
import type { AppDeps } from "../../app.js";
import { addresses, users } from "../../db/schema.js";
import { HttpError } from "../../errors.js";

type Deps = Pick<AppDeps, "db" | "crypto" | "now">;
type Row = typeof addresses.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new HttpError(404, "Alamat tidak ditemukan.", "ADDRESS_NOT_FOUND");

const view = (deps: Deps, r: Row) => ({
  id: r.id,
  recipient: deps.crypto.decrypt(r.recipientEnc),
  phone: deps.crypto.decrypt(r.phoneEnc),
  address: deps.crypto.decrypt(r.addressEnc),
  areaId: r.areaId,
  postalCode: r.postalCode,
});

export async function listAddresses(deps: Deps, userId: string) {
  const rows = await deps.db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(asc(addresses.createdAt), asc(addresses.id));
  return { addresses: rows.map((r) => view(deps, r)) };
}

export async function createAddress(deps: Deps, userId: string, input: unknown) {
  const a = createAddressSchema.parse(input);
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update"); // penambahan bersamaan antre per akun
    const [{ n }] = await tx.select({ n: count() }).from(addresses).where(eq(addresses.userId, userId));
    if (n >= MAX_ADDRESSES) throw new HttpError(422, `Maksimal ${MAX_ADDRESSES} alamat. Hapus yang tidak dipakai dulu ya.`, "TOO_MANY_ADDRESSES");
    const [row] = await tx.insert(addresses).values({
      userId, recipientEnc: deps.crypto.encrypt(a.recipient), phoneEnc: deps.crypto.encrypt(a.phone), addressEnc: deps.crypto.encrypt(a.address),
      areaId: a.areaId, postalCode: a.postalCode, createdAt: now, updatedAt: now,
    }).returning();
    return view(deps, row);
  });
}

export async function updateAddress(deps: Deps, userId: string, id: string, input: unknown) {
  const a = updateAddressSchema.parse(input);
  if (!UUID.test(id)) throw notFound();
  const [row] = await deps.db.update(addresses).set({
    ...(a.recipient !== undefined && { recipientEnc: deps.crypto.encrypt(a.recipient) }),
    ...(a.phone !== undefined && { phoneEnc: deps.crypto.encrypt(a.phone) }),
    ...(a.address !== undefined && { addressEnc: deps.crypto.encrypt(a.address) }),
    ...(a.areaId !== undefined && { areaId: a.areaId }),
    ...(a.postalCode !== undefined && { postalCode: a.postalCode }),
    updatedAt: deps.now(),
  }).where(and(eq(addresses.id, id), eq(addresses.userId, userId))).returning();
  if (!row) throw notFound();
  return view(deps, row);
}

export async function deleteAddress(deps: Deps, userId: string, id: string) {
  const [row] = UUID.test(id) ? await deps.db.delete(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, userId))).returning({ id: addresses.id }) : [];
  if (!row) throw notFound();
}
