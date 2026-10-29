import type { Metadata } from "next";
import { ShipmentList } from "@/components/shipping/ShipmentList";
import { apiServer, unwrap } from "@/lib/api-server";
import type { Shipment } from "@/lib/shipping";

export const metadata: Metadata = { title: "Pengiriman" };

export default async function Pengiriman() {
  const { items } = unwrap(await apiServer<{ items: Shipment[] }>("/api/admin/shipments"));
  return (
    <>
      <h1>Pengiriman</h1>
      <ShipmentList items={items} />
    </>
  );
}
