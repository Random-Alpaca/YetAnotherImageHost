// Image listing, private delivery (X-Accel-Redirect), and deletion.
import { Router } from "express";
import path from "node:path";
import { requireAuth, requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { getImage, listImages, deleteImage } from "../images.js";

const privateRoot = config.storagePrivate;

const router = Router();

// GET /api/images — every logged-in user sees the whole gallery.
router.get("/list", requireAuth, (req, res) => {
  res.json({ images: listImages() });
});

// DELETE /api/images/:id — admin only.
router.delete("/:id", requireAdmin, (req, res) => {
  const ok = deleteImage(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
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
