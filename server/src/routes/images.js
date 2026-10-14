// Image listing, private delivery (X-Accel-Redirect), deletion, visibility
// toggle, folder assignment, and bulk operations.
import { Router } from "express";
import path from "node:path";
import { requireAuth, optionalAuth } from "../auth.js";
import { config } from "../config.js";
import { getFolder, canAccessFolder, accessibleFolderIds } from "../folders.js";
import {
  getImage,
  listImages,
  deleteImage,
  setVisibility,
  setFolder,
  canModify,
  publicUrlFor,
  parsePagination,
  thumbnailsFor,
  thumbnailRecords,
  THUMBNAIL_VERSION,
  THUMBNAIL_SIZES,
} from "../images.js";

const privateRoot = config.storagePrivate;

const router = Router();

// GET /api/images/list?folder=<id|"none"|unset>&limit=48&cursor=<opaque>
// Returns images with uploaded_by, folder_id, can_modify.
router.get("/list", requireAuth, (req, res) => {
  const folder = req.query.folder; // undefined = all, "none" = no folder, <id> = specific folder
  if (folder !== undefined && (typeof folder !== "string" || !folder)) {
    return res.status(400).json({ error: "invalid folder" });
  }
  let pagination;
  try {
    pagination = parsePagination(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (folder && folder !== "none" && !canAccessFolder(req.cred, getFolder(folder))) {
    return res.status(403).json({ error: "forbidden" });
  }
  const allowed = folder ? null : accessibleFolderIds(req.cred);
  const page = listImages({ folder, allowedFolderIds: allowed, ...pagination });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ...page, images: page.images.map((img) => ({ ...img, can_modify: canModify(req.cred, img) })) });
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
  res.json({ id: updated.id, visibility: updated.visibility, url: publicUrlFor(updated), thumbnails: thumbnailsFor(updated) });
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
// GET /i/private/:id — authorize, then hand off to Nginx. The app never reads
// the file itself. Who may view:
//   - anyone, if the image sits in a folder published as a public album
//   - any valid session, if the image has no folder (the shared portal space)
//   - otherwise, whoever may access its folder
export function canViewImage(cred, img) {
  const folder = img.folder_id ? getFolder(img.folder_id) : null;
  if (folder?.public_slug) return true;
  if (!cred) return false;
  if (!folder) return true;
  return canAccessFolder(cred, folder);
}

export const privateRouter = Router();

// Browsers may retain protected bytes, but must authorize every reuse. This
// applies to original fallbacks as well as previews, including conditional GETs.
privateRouter.use("/private", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  next();
});

function deliverPrivate(req, res, thumbnailSize = null) {
  const img = getImage(req.params.id);
  if (!img || img.visibility !== "private" || !canViewImage(req.cred, img)) {
    return res.status(404).json({ error: "not found" });
  }
  let storedPath = img.stored_path;
  let mime = img.mime;
  if (thumbnailSize !== null) {
    const thumb = thumbnailRecords(img.id).find((record) =>
      record.size === thumbnailSize && record.version === THUMBNAIL_VERSION);
    if (!thumb) return res.status(404).json({ error: "not found" });
    storedPath = thumb.stored_path;
    mime = "image/webp";
  }
  res.setHeader("X-Content-Type-Options", "nosniff");

  // DEV: serve the bytes directly (no Nginx). PROD: hand off via X-Accel.
  if (config.devDirectServe) {
    return res.sendFile(path.resolve(privateRoot, storedPath), {
      cacheControl: false,
      headers: { "Content-Type": mime },
    });
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Accel-Redirect", path.posix.join(config.internalPrefix, storedPath));
  res.end();
}

privateRouter.get("/private/:id", optionalAuth, (req, res) => deliverPrivate(req, res));

privateRouter.get("/private/:id/thumbnail/:size", optionalAuth, (req, res) => {
  const size = THUMBNAIL_SIZES.find((size) => String(size) === req.params.size);
  if (!size) return res.status(404).json({ error: "not found" });
  return deliverPrivate(req, res, size);
});
