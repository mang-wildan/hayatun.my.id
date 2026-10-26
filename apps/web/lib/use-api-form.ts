"use client";

import { useRef, useState } from "react";
import type { ZodType } from "zod";
import { apiClient } from "./api-client";

// Validasi di browser memakai skema yang sama dengan API (pesan sama); server tetap yang menentukan.
// Error per kolom tampil di bawah kolomnya, error umum lewat `message`.
export function useApiForm(path: string, schema: ZodType) {
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const busy = useRef(false); // mencegah kirim ganda, termasuk lewat tombol Enter

  async function submit(values: object, onOk: (data: any) => void, extra: object = {}) {
    if (busy.current) return;
    setMessage(undefined);
    setFields({});
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
      return setFields(f);
    }
    busy.current = true;
    setLoading(true);
    const res = await apiClient(path, { ...(parsed.data as object), ...extra });
    if (res.ok) onOk(res.data);
    else if (res.body.fields) setFields(res.body.fields);
    else setMessage(res.body.message);
    busy.current = false;
    setLoading(false);
  }

  return { loading, fields, message, setMessage, submit };
}
