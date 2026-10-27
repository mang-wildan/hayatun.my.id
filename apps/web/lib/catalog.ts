import { cache } from "react";
import { apiServer, unwrap } from "./api-server";

export interface CatalogCard { id: string; slug: string; name: string; type: "digital" | "physical"; price: number; available: boolean; coverUrl: string | null }
export interface CatalogDetail extends CatalogCard { description: string; weightG: number | null }

export const getCatalog = cache(async () => unwrap(await apiServer<{ products: CatalogCard[] }>("/api/catalog")).products);
// dipakai halaman dan judulnya; cache() menjaga satu permintaan per tampilan halaman
export const getCatalogProduct = cache(async (slug: string) => unwrap(await apiServer<CatalogDetail>(`/api/catalog/${encodeURIComponent(slug)}`)));
