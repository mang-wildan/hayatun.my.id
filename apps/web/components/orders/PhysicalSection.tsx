import { STATUS_LABELS, STATUS_TONES, type PhysicalStatus } from "@hayatun/shared";
import { CopyButton } from "@/components/CopyButton";
import type { OrderDetail } from "@/lib/orders";
import { ReceivedButton } from "./ReceivedButton";
import { Steps } from "./Steps";

const STAGES: PhysicalStatus[] = ["DIPROSES", "DIKIRIM", "DITERIMA"];

// F8: status kiriman, ekspedisi, dan nomor resi
export function PhysicalSection({ orderId, status, shipping }: { orderId: string; status: PhysicalStatus; shipping: OrderDetail["shipping"] }) {
  return (
    <section className="stack" aria-labelledby="fisik-h">
      <h2 id="fisik-h">Fisik</h2>
      <p><span className="badge" data-tone={STATUS_TONES.physical[status]} data-testid="status-fisik">{STATUS_LABELS.physical[status]}</span></p>
      <Steps label="Tahap pengiriman" labels={STAGES.map((s) => STATUS_LABELS.physical[s])} current={STAGES.indexOf(status)} />
      {shipping && (
        <dl className="summary-rows">
          <div><dt>Ekspedisi</dt><dd>{shipping.courier}{shipping.service ? ` ${shipping.service}` : ""}</dd></div>
          <div>
            <dt>Nomor resi</dt>
            <dd>{shipping.trackingNumber
              ? <><span className="mono" data-testid="nomor-resi">{shipping.trackingNumber}</span> <CopyButton text={shipping.trackingNumber} label="Salin nomor resi" /></>
              : <span className="meta">Nomor resi belum ada.</span>}</dd>
          </div>
        </dl>
      )}
      {status === "DIKIRIM" && <ReceivedButton orderId={orderId} />}
    </section>
  );
}
