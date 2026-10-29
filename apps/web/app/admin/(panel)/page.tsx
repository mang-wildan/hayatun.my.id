import { VerifyQueue } from "@/components/verify/VerifyQueue";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Queue } from "@/lib/verify";

export default async function Verifikasi({ searchParams }: { searchParams: Promise<{ periksa?: string }> }) {
  const { periksa } = await searchParams;
  return <VerifyQueue queue={unwrap(await apiServer<Queue>("/api/admin/payments"))} periksa={periksa} />;
}
