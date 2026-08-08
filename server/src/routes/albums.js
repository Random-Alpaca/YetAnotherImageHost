// /api/albums/:slug — public, shareable albums. No session required: the
// unguessable slug IS the credential. A folder becomes an album when an
// owner/admin turns on public sharing (PATCH /api/folders/:id).
//
// Deliberately flat: an album exposes the images directly inside that folder,
// not its subfolders. ponytail: no nesting until someone asks for it.
import { Router } from "express";
import { getFolderBySlug } from "../folders.js";
import { listImages } from "../images.js";
import { upload, processFiles } from "./upload.js";

const router = Router();

function album(req, res, next) {
  const folder = getFolderBySlug(req.params.slug);
  if (!folder) return res.status(404).json({ error: "album not found" });
  req.album = folder;
  next();
}

// GET /api/albums/:slug — album name, upload permission, and its images.
router.get("/:slug", album, (req, res) => {
  res.json({
    album: {
      name: req.album.name,
      can_upload: !!req.album.public_upload,
    },
    images: listImages({ folder: req.album.id }).map((img) => ({
      id: img.id,
      url: img.url,
      original_name: img.original_name,
      created_at: img.created_at,
    })),
  });
});

// POST /api/albums/:slug/upload — anonymous contribution, if enabled.
// Stored as `private` on purpose: the bytes then only leave through this app's
// authorization, so un-publishing the album immediately cuts off access.
router.post("/:slug/upload", album, upload.array("file", 20), async (req, res, next) => {
  try {
    if (!req.album.public_upload) return res.status(403).json({ error: "this album is view-only" });
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: "at least one file is required" });
    const results = await processFiles(files, {
      uploadedBy: null,
      visibility: "private",
      folderId: req.album.id,
    });
    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});

// Multer errors (e.g. file too large) -> clean JSON, same as /api/upload.
router.use((err, req, res, next) => {
  if (err?.name === "MulterError") {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message });
  }
  next(err);
});

export default router;
