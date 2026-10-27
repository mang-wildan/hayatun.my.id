"use client";

import { createProductSchema, updateProductSchema } from "@hayatun/shared";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { TextArea, TextField } from "@/components/TextField";
import type { ProductDetail } from "@/lib/products";
import { useApiForm } from "@/lib/use-api-form";

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

// Dipakai untuk produk baru dan ubah data. Jenis produk tidak bisa diubah setelah dibuat.
export function ProductForm({ product }: { product?: ProductDetail }) {
  const router = useRouter();
  const typeError = useId();
  const f = useApiForm(product ? `/api/admin/products/${product.id}` : "/api/admin/products", product ? updateProductSchema : createProductSchema, product ? "PATCH" : "POST");
  const [v, setV] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    type: product?.type ?? "",
    price: product ? String(product.price) : "",
    weight: product?.weightG ? String(product.weightG) : "",
    stock: product?.type === "physical" ? String((product.stock.available ?? 0) + product.stock.reserved) : "",
    licensed: product?.isLicensed ?? false,
  });
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const text = (k: "name" | "price" | "weight" | "stock") => ({ value: v[k], onChange: (e: { target: { value: string } }) => set(k, e.target.value) });

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        f.submit(
          {
            name: v.name,
            description: v.description,
            ...(product ? {} : { type: v.type || undefined }),
            price: num(v.price),
            ...(v.type === "physical" ? { weightG: num(v.weight), stockQty: num(v.stock) } : {}),
            ...(v.type === "digital" ? { isLicensed: v.licensed } : {}),
          },
          (d) => {
            if (!product) return router.push(`/admin/produk/${d.id}`);
            setSaved(true);
            router.refresh();
          },
        );
      }}
    >
      <TextField label="Nama produk" name="name" autoComplete="off" {...text("name")} error={f.fields.name} />
      <TextArea label="Deskripsi" name="description" rows={5} value={v.description} onChange={(e) => set("description", e.target.value)} error={f.fields.description} />

      <fieldset className="radio-group" aria-describedby={f.fields.type ? typeError : undefined}>
        <legend>Jenis produk</legend>
        {(["digital", "physical"] as const).map((t) => (
          <label className="radio" key={t}>
            <input type="radio" name="type" value={t} checked={v.type === t} disabled={Boolean(product)} onChange={() => set("type", t)} />
            {t === "digital" ? "Digital" : "Fisik"}
          </label>
        ))}
        {f.fields.type && <span className="error" id={typeError}>{f.fields.type}</span>}
      </fieldset>

      <TextField label="Harga (Rp)" name="price" inputMode="numeric" autoComplete="off" {...text("price")} error={f.fields.price} />
      {v.type === "physical" && (
        <>
          <TextField label="Berat (gram)" name="weightG" inputMode="numeric" autoComplete="off" {...text("weight")} error={f.fields.weightG} />
          <TextField label="Stok" name="stockQty" inputMode="numeric" autoComplete="off" {...text("stock")} error={f.fields.stockQty} />
        </>
      )}
      {v.type === "digital" && (
        <label className="check">
          <input type="checkbox" checked={v.licensed} onChange={(e) => set("licensed", e.target.checked)} />
          Pakai kode lisensi
        </label>
      )}
      {f.fields.isLicensed && <p className="field-error">{f.fields.isLicensed}</p>}

      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      {saved && <FormMessage tone="ok">Perubahan tersimpan.</FormMessage>}
      <Button loading={f.loading} loadingLabel="Menyimpan…">Simpan produk</Button>
    </form>
  );
}
