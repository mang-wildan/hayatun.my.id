"use client";

import { createAddressSchema } from "@hayatun/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { TextArea, TextField } from "@/components/TextField";
import { apiClient } from "@/lib/api-client";
import { optionLabel, type Address, type Quote } from "@/lib/checkout";
import { useApiForm } from "@/lib/use-api-form";

const EMPTY = { recipient: "", phone: "", address: "", areaId: "", postalCode: "" };

export function ShippingForm({ initial }: { initial: Address[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initial);
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(initial.length === 0);
  const [options, setOptions] = useState<Quote["shippingOptions"]>([]);
  const [service, setService] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const form = useApiForm("/api/addresses", createAddressSchema);
  const [v, setV] = useState(EMPTY);
  const on = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  // ongkir diambil ulang dari server setiap alamat dipilih (F3.2); gagal = pesan, tidak pernah Rp0 (F3.6)
  async function choose(id: string) {
    setSelected(id);
    setService(undefined);
    setOptions([]);
    setError(undefined);
    setLoading(true);
    const res = await apiClient<Quote>("/api/checkout/quote", { addressId: id });
    if (res.ok) setOptions(res.data.shippingOptions);
    else setError(res.body.message);
    setLoading(false);
  }

  const chosen = options.find((o) => `${o.courier}|${o.service}` === service);
  const next = () => {
    if (!selected || !chosen) return;
    router.push(`/checkout/bayar?alamat=${selected}&kurir=${encodeURIComponent(chosen.courier)}&layanan=${encodeURIComponent(chosen.service)}`);
  };

  return (
    <div className="stack">
      {addresses.length > 0 && (
        <fieldset className="radio-group">
          <legend>Alamat pengiriman</legend>
          {addresses.map((a) => (
            <label className="radio option" key={a.id}>
              <input type="radio" name="alamat" value={a.id} checked={selected === a.id} onChange={() => choose(a.id)} />
              <span><strong>{a.recipient}</strong>, {a.phone}<br />{a.address}<br />{a.areaId}, {a.postalCode}</span>
            </label>
          ))}
        </fieldset>
      )}

      {adding ? (
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            form.submit(v, (a: Address) => {
              setAddresses((list) => [...list, a]);
              setV(EMPTY);
              setAdding(false);
              choose(a.id);
            });
          }}
        >
          <TextField label="Nama penerima" name="recipient" autoComplete="name" value={v.recipient} onChange={on("recipient")} error={form.fields.recipient} />
          <TextField label="Nomor HP" name="phone" type="tel" autoComplete="tel" value={v.phone} onChange={on("phone")} error={form.fields.phone} />
          <TextArea label="Alamat lengkap" name="address" rows={3} autoComplete="street-address" value={v.address} onChange={on("address")} error={form.fields.address} />
          <TextField label="Kecamatan" name="areaId" autoComplete="address-level2" value={v.areaId} onChange={on("areaId")} error={form.fields.areaId} />
          <TextField label="Kode pos" name="postalCode" inputMode="numeric" autoComplete="postal-code" value={v.postalCode} onChange={on("postalCode")} error={form.fields.postalCode} />
          {form.message && <FormMessage tone="error">{form.message}</FormMessage>}
          <Button loading={form.loading} loadingLabel="Menyimpan…">Simpan alamat</Button>
          {addresses.length > 0 && <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Batal</Button>}
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setAdding(true)}>Tambah alamat baru</Button>
      )}

      {selected && (
        <fieldset className="radio-group">
          <legend>Layanan pengiriman</legend>
          {loading && <p className="meta" role="status">Menghitung ongkir…</p>}
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {options.map((o) => {
            const key = `${o.courier}|${o.service}`;
            return (
              <label className="radio option" key={key}>
                <input type="radio" name="layanan" value={key} checked={service === key} onChange={() => setService(key)} />
                {optionLabel(o)}
              </label>
            );
          })}
        </fieldset>
      )}

      <Button type="button" disabled={!chosen} onClick={next}>Lanjut</Button>
    </div>
  );
}
