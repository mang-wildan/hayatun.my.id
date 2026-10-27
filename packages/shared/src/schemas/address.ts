import { z } from "zod";

export const MAX_ADDRESSES = 5;

const BAD_PHONE = "Format nomor HP belum benar. Contoh: 081234567890.";
// nomor seluler Indonesia; disimpan sebagai +62…
const phone = z
  .string({ error: "Nomor HP diisi dulu ya." })
  .trim()
  .min(1, "Nomor HP diisi dulu ya.")
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^(\+62|62|0)8\d{8,11}$/.test(v), BAD_PHONE)
  .transform((v) => v.replace(/^(\+62|62|0)/, "+62"));

export const addressFieldsSchema = z.object({
  recipient: z.string({ error: "Nama penerima diisi dulu ya." }).trim().min(1, "Nama penerima diisi dulu ya.").max(100, "Nama penerima maksimal 100 karakter."),
  phone,
  address: z
    .string({ error: "Alamat lengkap diisi dulu ya." })
    .trim()
    .min(1, "Alamat lengkap diisi dulu ya.")
    .min(10, "Alamat terlalu pendek, tulis jalan, nomor, RT/RW, dan kelurahan.")
    .max(300, "Alamat maksimal 300 karakter."),
  // teks buram sampai penyedia ongkir dipilih (SPEC pertanyaan terbuka 1)
  areaId: z.string({ error: "Pilih wilayah tujuan dulu ya." }).trim().min(1, "Pilih wilayah tujuan dulu ya.").max(64),
  postalCode: z.string({ error: "Kode pos terdiri dari 5 angka." }).trim().regex(/^\d{5}$/, "Kode pos terdiri dari 5 angka."),
});
export const createAddressSchema = addressFieldsSchema;
export const updateAddressSchema = addressFieldsSchema.partial();
