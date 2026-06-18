// POST /api/upload  (auth required, multipart/form-data)
// Fields: file (one OR many images), visibility=public|private (default private)
//         folder_id (optional) OR folder_name (optional; creates folder if missing)
//
// Bulk-capable: send any number of `file` parts. Each is validated and stored
// independently, so one bad file doesn't sink the batch — the response carries
// a per-file result list. Always 201 unless the request itself is malformed
// (no files at all).
//
// HEIC/HEIF files are automatically converted to JPEG before storage.
import { Router } from "express";
import multer from "multer";
import convert from "heic-convert";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { sniffImage, storeImage, publicUrlFor } from "../images.js";
import { getOrCreateByName, getFolder } from "../folders.js";

const router = Router();

// HEIC/HEIF detection: ISOBMFF container with ftyp box at offset 4.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "hevm", "hevs"]);
function isHeic(buf) {
  if (buf.length < 12) return false;
  if (buf.toString("ascii", 4, 8) !== "ftyp") return false;
  return HEIC_BRANDS.has(buf.toString("ascii", 8, 12));
}

// Buffer in memory so we can sniff magic bytes before committing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: config.maxUploadFiles },
});

router.post("/upload", requireAuth, upload.array("file", config.maxUploadFiles), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: "at least one file is required" });

    const visibility = req.body.visibility === "public" ? "public" : "private";

    // Resolve folder_id for the batch.
    let folderId = req.body.folder_id || null;
    if (!folderId && req.body.folder_name) {
      const folder = getOrCreateByName(req.body.folder_name, req.cred.id, req.body.parent_id || null);
      folderId = folder.id;
    } else if (folderId) {
      // Validate it exists.
      const folder = getFolder(folderId);
      if (!folder) return res.status(400).json({ error: "folder_id not found" });
    }

    const results = await Promise.all(files.map(async (file) => {
      let { buffer, originalname } = file;

      // Convert HEIC/HEIF to JPEG transparently before any other processing.
      if (isHeic(buffer)) {
        try {
          buffer = Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.92 }));
          originalname = originalname.replace(/\.hei[cf]$/i, ".jpg");
        } catch {
          return { name: file.originalname, ok: false, error: "HEIC conversion failed" };
        }
      }

      const sniffed = sniffImage(buffer);
      if (!sniffed) {
        return { name: file.originalname, ok: false, error: "unsupported or invalid image (jpeg/png/gif/webp only)" };
      }

      const img = storeImage({
        buffer,
        uploadedBy: req.cred.id,
        visibility,
        originalName: originalname,
        mime: sniffed.mime,
        ext: sniffed.ext,
        folderId,
      });
      return { name: file.originalname, ok: true, id: img.id, visibility: img.visibility, url: publicUrlFor(img), folder_id: img.folder_id };
    }));

    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});

// Multer errors (e.g. file too large) -> clean JSON.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const code = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(code).json({ error: err.message });
  }
  next(err);
});

export default router;
