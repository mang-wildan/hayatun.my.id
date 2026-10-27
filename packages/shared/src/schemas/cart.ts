import { z } from "zod";

export const MAX_CART_QTY = 99;

export const cartQtySchema = z
  .number({ error: "Jumlahnya diisi angka ya." })
  .int("Jumlah harus bilangan bulat.")
  .min(1, "Jumlah minimal 1.")
  .max(MAX_CART_QTY, `Jumlah maksimal ${MAX_CART_QTY}.`);

export const addToCartSchema = z.object({
  productId: z.guid({ error: "Pilih produknya dulu ya." }),
  qty: cartQtySchema.default(1),
});
export const setCartQtySchema = z.object({ qty: cartQtySchema });
