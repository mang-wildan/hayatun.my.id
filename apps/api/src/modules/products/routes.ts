import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { requireAdmin } from "../auth/middleware.js";
import {
  addFile, addLicenses, addLink, createProduct, getCover, getProduct, listProducts, removeFile, setActive, setCover, updateProduct,
} from "./service.js";

// Semua rute khusus admin (N6). Sengaja tidak ada rute hapus produk (F9.9).
export function productRoutes(deps: AppDeps) {
  const r = Router();
  const actor = (req: { session?: { userId: string } }) => req.session!.userId;
  r.use(requireAdmin);

  r.get("/", async (_req, res) => { res.json(await listProducts(deps)); });
  r.post("/", async (req, res) => { res.status(201).json(await createProduct(deps, actor(req), req.body)); });
  r.get("/:id", async (req, res) => { res.json(await getProduct(deps, req.params.id)); });
  r.patch("/:id", async (req, res) => { res.json(await updateProduct(deps, actor(req), req.params.id, req.body)); });
  r.post("/:id/activate", async (req, res) => { res.json(await setActive(deps, actor(req), req.params.id, true)); });
  r.post("/:id/deactivate", async (req, res) => { res.json(await setActive(deps, actor(req), req.params.id, false)); });

  r.post("/:id/files", async (req, res) => { res.status(201).json(await addFile(deps, actor(req), req.params.id, req)); });
  r.post("/:id/links", async (req, res) => { res.status(201).json(await addLink(deps, actor(req), req.params.id, req.body)); });
  r.delete("/:id/files/:fileId", async (req, res) => {
    await removeFile(deps, actor(req), req.params.id, req.params.fileId);
    res.status(204).end();
  });

  // kode lisensi hanya bisa ditambah; isinya tidak pernah ditampilkan kembali
  r.post("/:id/licenses", async (req, res) => { res.json(await addLicenses(deps, actor(req), req.params.id, req.body)); });

  r.put("/:id/cover", async (req, res) => { res.json(await setCover(deps, actor(req), req.params.id, req)); });
  r.get("/:id/cover", async (req, res) => {
    const { key, ...file } = await getCover(deps, req.params.id);
    await deps.storage.send(res, key, file);
  });

  return r;
}
