import { z } from "zod";

export const MAX_WEIGHT_G = 100_000;
export const NO_WEIGHT = "Berat wajib diisi untuk produk fisik (dalam gram), karena ongkir dihitung dari beratnya.";

// Kolom yang boleh diisi pengguna. Tanpa nilai bawaan, supaya skema ini juga dipakai untuk ubah sebagian (PATCH).
export const productFieldsSchema = z.object({
  name: z.string().trim().min(1, "Namanya diisi dulu ya.").max(120, "Nama maksimal 120 karakter."),
  description: z.string().max(5000, "Deskripsi maksimal 5.000 karakter."),
  type: z.enum(["digital", "physical"], { error: "Pilih jenis produknya: digital atau fisik." }),
  price: z
    .number({ error: "Harganya diisi angka ya." })
    .int("Harganya harus bilangan bulat Rupiah.")
    .min(1, "Harga minimal Rp1.")
    .max(100_000_000, "Harga maksimal Rp100.000.000."),
  weightG: z.number({ error: "Berat diisi angka (gram) ya." }).int("Berat diisi bilangan bulat (gram) ya.").nullish(),
  stockQty: z.number({ error: "Stok diisi angka ya." }).int("Stok diisi bilangan bulat ya.").min(0, "Stok tidak boleh negatif."),
  isLicensed: z.boolean(),
});

export const createProductSchema = productFieldsSchema.partial({ description: true, weightG: true, stockQty: true, isLicensed: true });
export const updateProductSchema = productFieldsSchema.partial();
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Aturan antar-kolom yang bergantung pada jenis produk; hasilnya pesan per kolom (kosong = lolos).
export function productRuleErrors(p: { type: "digital" | "physical"; weightG?: number | null; isLicensed?: boolean }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (p.type === "physical") {
    if (!p.weightG || p.weightG <= 0) errors.weightG = NO_WEIGHT; // F9.6
    else if (p.weightG > MAX_WEIGHT_G) errors.weightG = "Berat maksimal 100.000 gram.";
    if (p.isLicensed) errors.isLicensed = "Hanya produk digital yang bisa memakai kode lisensi.";
  }
  return errors;
}

export const linkSchema = z.object({
  url: z
    .string()
    .trim()
    .startsWith("https://", "Alamat tautan harus diawali https://")
    .max(500, "Alamat tautan maksimal 500 karakter.")
    .refine((v) => URL.canParse(v), "Format alamat tautan belum benar."),
  label: z.string().trim().min(1, "Nama tautan diisi dulu ya.").max(120, "Nama tautan maksimal 120 karakter."),
});
