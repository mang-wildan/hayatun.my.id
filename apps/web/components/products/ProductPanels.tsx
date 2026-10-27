"use client";

import { linkSchema } from "@hayatun/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormMessage } from "@/components/FormMessage";
import { TextArea, TextField } from "@/components/TextField";
import { apiClient, apiUpload } from "@/lib/api-client";
import { formatSize, type ProductDetail, type ProductFile } from "@/lib/products";
import { useApiForm } from "@/lib/use-api-form";

type Note = { tone: "ok" | "error"; text: string } | undefined;
const Note = ({ note }: { note: Note }) => (note ? <FormMessage tone={note.tone}>{note.text}</FormMessage> : null);
const base = (p: ProductDetail) => `/api/admin/products/${p.id}`;

export function StatusControls({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>();

  async function change(active: boolean) {
    setBusy(true);
    setNote(undefined);
    const res = await apiClient(`${base(product)}/${active ? "activate" : "deactivate"}`);
    setNote(res.ok ? { tone: "ok", text: active ? "Produk sudah aktif dan tampil di toko." : "Produk dinonaktifkan dan tidak tampil di toko." } : { tone: "error", text: res.body.message });
    if (res.ok) router.refresh();
    setBusy(false);
  }

  return (
    <div className="stack">
      {product.active ? (
        <Button type="button" variant="secondary" loading={busy} onClick={() => setConfirm(true)}>Nonaktifkan produk</Button>
      ) : (
        <Button type="button" loading={busy} loadingLabel="Mengaktifkan…" onClick={() => change(true)}>Aktifkan produk</Button>
      )}
      <Note note={note} />
      <ConfirmDialog open={confirm} title="Nonaktifkan produk?" confirmLabel="Ya, nonaktifkan" variant="primary" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); change(false); }}>
        Produk tidak akan tampil di toko sampai kamu mengaktifkannya lagi.
      </ConfirmDialog>
    </div>
  );
}

export function CoverPanel({ product }: { product: ProductDetail }) {
  const [url, setUrl] = useState(product.coverUrl);
  const [note, setNote] = useState<Note>();
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setNote(undefined);
    const res = await apiUpload<{ coverUrl: string }>(`${base(product)}/cover`, file, "PUT");
    if (res.ok) setUrl(res.data.coverUrl);
    setNote(res.ok ? { tone: "ok", text: "Sampul tersimpan." } : { tone: "error", text: res.body.message });
    setBusy(false);
  }

  return (
    <div className="stack">
      {/* eslint-disable-next-line @next/next/no-img-element -- gambar dari API kita sendiri, ukurannya diatur CSS */}
      {url && <img className="cover-preview" src={url} alt={`Sampul ${product.name}`} />}
      <div className="field">
        <label htmlFor="cover-input">Pilih sampul</label>
        <span className="hint">JPG, PNG, atau WebP, maksimal 5 MB.</span>
        <input id="cover-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      </div>
      <Note note={note} />
    </div>
  );
}

export function FilesPanel({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const [note, setNote] = useState<Note>();
  const [uploading, setUploading] = useState<string>();
  const [target, setTarget] = useState<ProductFile>();
  const link = useApiForm(`${base(product)}/links`, linkSchema);
  const [l, setL] = useState({ url: "", label: "" });

  async function upload(file: File) {
    setUploading(file.name);
    setNote(undefined);
    const res = await apiUpload(`${base(product)}/files?filename=${encodeURIComponent(file.name)}`, file);
    setUploading(undefined);
    setNote(res.ok ? { tone: "ok", text: "File ditambahkan." } : { tone: "error", text: res.body.message });
    if (res.ok) router.refresh();
  }

  async function remove(file: ProductFile) {
    setTarget(undefined);
    const res = await apiClient(`${base(product)}/files/${file.id}`, undefined, "DELETE");
    setNote(res.ok ? { tone: "ok", text: "File dihapus." } : { tone: "error", text: res.body.message });
    if (res.ok) router.refresh();
  }

  return (
    <div className="stack">
      {product.files.length === 0 ? (
        <p className="empty">Belum ada file atau tautan.</p>
      ) : (
        <ul className="file-list" aria-label="File produk">
          {product.files.map((f) => (
            <li key={f.id}>
              <div>
                <strong>{f.filename}</strong>
                <span className="meta">{f.kind === "file" ? formatSize(f.sizeBytes ?? 0) : "Tautan"}</span>
              </div>
              <Button type="button" variant="secondary" aria-label={`Hapus ${f.filename}`} onClick={() => setTarget(f)}>Hapus</Button>
            </li>
          ))}
        </ul>
      )}
      <Note note={note} />

      <div className="field">
        <label htmlFor="file-input">Tambah file</label>
        <input id="file-input" type="file" disabled={Boolean(uploading)} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        {uploading && <span className="hint" role="status">Mengunggah {uploading}…</span>}
      </div>

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          link.submit(l, () => { setL({ url: "", label: "" }); setNote({ tone: "ok", text: "Tautan ditambahkan." }); router.refresh(); });
        }}
      >
        <TextField label="Alamat tautan" name="url" type="url" autoComplete="off" value={l.url} onChange={(e) => setL((s) => ({ ...s, url: e.target.value }))} error={link.fields.url} />
        <TextField label="Nama tautan" name="label" autoComplete="off" value={l.label} onChange={(e) => setL((s) => ({ ...s, label: e.target.value }))} error={link.fields.label} />
        {link.message && <FormMessage tone="error">{link.message}</FormMessage>}
        <Button variant="secondary" loading={link.loading} loadingLabel="Menambah…">Tambah tautan</Button>
      </form>

      <ConfirmDialog open={Boolean(target)} title={`Hapus ${target?.filename ?? ""}?`} confirmLabel="Ya, hapus" onCancel={() => setTarget(undefined)} onConfirm={() => target && remove(target)}>
        Yang sudah dihapus tidak bisa dikembalikan.
      </ConfirmDialog>
    </div>
  );
}

const codesSchema = z.object({ codes: z.string().trim().min(1, "Tempel minimal satu kode.") });

export function LicensesPanel({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const f = useApiForm(`${base(product)}/licenses`, codesSchema);
  const [codes, setCodes] = useState("");
  const [done, setDone] = useState<string>();

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setDone(undefined);
        f.submit({ codes }, (d: { added: number; duplicates: number }) => {
          setCodes("");
          setDone(`${d.added} kode ditambahkan.${d.duplicates ? ` ${d.duplicates} ditolak karena sudah ada.` : ""}`);
          router.refresh();
        });
      }}
    >
      <TextArea label="Tempel kode lisensi (satu per baris)" name="codes" rows={6} autoComplete="off" spellCheck={false} hint="Kode yang sudah tersimpan tidak ditampilkan lagi." value={codes} onChange={(e) => setCodes(e.target.value)} error={f.fields.codes} />
      {f.message && <FormMessage tone="error">{f.message}</FormMessage>}
      {done && <FormMessage tone="ok">{done}</FormMessage>}
      <Button loading={f.loading} loadingLabel="Menambah…">Tambah kode</Button>
    </form>
  );
}
