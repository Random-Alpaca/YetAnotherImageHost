// Image listing, private delivery (X-Accel-Redirect), deletion, visibility
// toggle, folder assignment, and bulk operations.
import { Router } from "express";
import path from "node:path";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import {
  getImage,
  listImages,
  deleteImage,
  setVisibility,
  setFolder,
  canModify,
  publicUrlFor,
} from "../images.js";

const privateRoot = config.storagePrivate;

const router = Router();

// GET /api/images/list?folder=<id|"none"|unset>
// Returns images with uploaded_by, folder_id, can_modify.
router.get("/list", requireAuth, (req, res) => {
  const folder = req.query.folder; // undefined = all, "none" = no folder, <id> = specific folder
  const images = listImages({ folder });
  const result = images.map((img) => ({
    ...img,
    can_modify: canModify(req.cred, img),
  }));
  res.json({ images: result });
});

// PATCH /api/images/:id/visibility — owner-or-admin; moves file between roots.
router.patch("/:id/visibility", requireAuth, (req, res) => {
  const img = getImage(req.params.id);
  if (!img) return res.status(404).json({ error: "not found" });
  if (!canModify(req.cred, img)) return res.status(403).json({ error: "forbidden" });

  const { visibility } = req.body || {};
  if (visibility !== "public" && visibility !== "private") {
    return res.status(400).json({ error: "visibility must be 'public' or 'private'" });
  }

  const updated = setVisibility(img, visibility);
  res.json({ id: updated.id, visibility: updated.visibility, url: publicUrlFor(updated) });
});

// PATCH /api/images/:id — owner-or-admin; update folder_id.
router.patch("/:id", requireAuth, (req, res) => {
  const img = getImage(req.params.id);
  if (!img) return res.status(404).json({ error: "not found" });
  if (!canModify(req.cred, img)) return res.status(403).json({ error: "forbidden" });

  const { folder_id } = req.body || {};
  setFolder(req.params.id, folder_id !== undefined ? folder_id : img.folder_id);
  res.json({ ok: true });
});

// POST /api/images/bulk — per-item owner-or-admin; delete or move.
router.post("/bulk", requireAuth, (req, res) => {
  const { action, ids, folder_id } = req.body || {};
  if (!action || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "action and ids[] required" });
  }
  if (!["delete", "move"].includes(action)) {
    return res.status(400).json({ error: "action must be 'delete' or 'move'" });
  }

  const results = ids.map((id) => {
    const img = getImage(id);
    if (!img) return { id, ok: false, error: "not found" };
    if (!canModify(req.cred, img)) return { id, ok: false, error: "forbidden" };
    try {
      if (action === "delete") {
        deleteImage(id);
      } else {
        setFolder(id, folder_id !== undefined ? folder_id : img.folder_id);
      }
      return { id, ok: true };
    } catch (err) {
      return { id, ok: false, error: err.message };
    }
  });

  res.json({ results });
});

// DELETE /api/images/:id — owner-or-admin (was admin-only).
router.delete("/:id", requireAuth, (req, res) => {
  const img = getImage(req.params.id);
  if (!img) return res.status(404).json({ error: "not found" });
  if (!canModify(req.cred, img)) return res.status(403).json({ error: "forbidden" });
  deleteImage(req.params.id);
  res.json({ ok: true });
});

export default router;

// ---------------------------------------------------------------------------
// Private byte delivery lives on its own router mounted at /i (see index.js):
// GET /i/private/:id — authorize, then hand off to Nginx. Any valid session may
// view (the portal is a shared space); the app never reads the file itself.
export const privateRouter = Router();

privateRouter.get("/private/:id", requireAuth, (req, res) => {
  const img = getImage(req.params.id);
  if (!img || img.visibility !== "private") {
    return res.status(404).json({ error: "not found" });
  }
  res.setHeader("X-Content-Type-Options", "nosniff");

  // DEV: serve the bytes directly (no Nginx). PROD: hand off via X-Accel.
  if (config.devDirectServe) {
    return res.sendFile(path.resolve(privateRoot, img.stored_path), {
      headers: { "Content-Type": img.mime },
    });
  }
  res.setHeader("Content-Type", img.mime);
  res.setHeader("X-Accel-Redirect", path.posix.join(config.internalPrefix, img.stored_path));
  res.end();
});
