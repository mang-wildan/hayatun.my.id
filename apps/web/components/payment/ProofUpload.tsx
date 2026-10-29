"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FormMessage } from "@/components/FormMessage";
import { apiUpload } from "@/lib/api-client";
import { PROOF_MAX_BYTES, PROOF_SIZE_ERROR, PROOF_TYPE_ERROR, PROOF_TYPES } from "@/lib/payment";
import { formatSize } from "@/lib/products";

// Pemeriksaan di browser hanya kemudahan (jenis dari browser, ukuran); keputusan akhir ada di server, yang memeriksa isi file (F4.7)
export function ProofUpload({ orderId }: { orderId: string }) {
  const router = useRouter();
  const id = useId();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [refreshing, refresh] = useTransition();

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(undefined);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f?: File) {
    setServerError(undefined);
    setFile(undefined);
    setFieldError(undefined);
    if (!f) return;
    if (!PROOF_TYPES.includes(f.type)) return setFieldError(PROOF_TYPE_ERROR);
    if (f.size > PROOF_MAX_BYTES) return setFieldError(PROOF_SIZE_ERROR);
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setSending(true);
    setServerError(undefined);
    const res = await apiUpload(`/api/orders/${orderId}/proof`, file);
    if (res.ok) refresh(() => router.refresh()); // halaman berganti ke "Menunggu verifikasi"
    else setServerError(res.body.message);
    setSending(false);
  }

  return (
    <div className="stack">
      <div className="upload-area" data-testid="area-unggah">
        <label htmlFor={id}>Bukti bayar</label>
        <span className="hint" id={`${id}-hint`}>JPG, PNG, atau PDF, maksimal 5 MB.</span>
        <input
          id={id}
          key={file ? "terisi" : "kosong"} // dikosongkan lagi saat file diganti atau ditolak
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={[fieldError && `${id}-error`, `${id}-hint`].filter(Boolean).join(" ")}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        {fieldError && (
          <span className="error" id={`${id}-error`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {fieldError}
          </span>
        )}
      </div>

      {file && (
        <div className="preview" data-testid="pratinjau">
          {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau dari file lokal pembeli (blob URL) */}
          {preview ? <img src={preview} alt="Pratinjau bukti bayar" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" width="40" height="40"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5" /></svg>}
          <div><strong>{file.name}</strong><span className="meta">{formatSize(file.size)}</span></div>
          <Button type="button" variant="secondary" onClick={() => choose(undefined)}>Ganti</Button>
        </div>
      )}

      {serverError && <FormMessage tone="error">{serverError}</FormMessage>}
      <Button type="button" disabled={!file || refreshing} loading={sending} loadingLabel="Mengunggah…" onClick={upload}>Upload bukti bayar</Button>
    </div>
  );
}
