// POST /api/upload  (auth required, multipart/form-data)
// Fields: file (one OR many images), visibility=public|private (default private)
//
// Bulk-capable: send any number of `file` parts. Each is validated and stored
// independently, so one bad file doesn't sink the batch — the response carries
// a per-file result list. Always 201 unless the request itself is malformed
// (no files at all).
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { sniffImage, storeImage, publicUrlFor } from "../images.js";

const router = Router();

// Buffer in memory so we can sniff magic bytes before committing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: config.maxUploadFiles },
});

router.post("/upload", requireAuth, upload.array("file", config.maxUploadFiles), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: "at least one file is required" });

  const visibility = req.body.visibility === "public" ? "public" : "private";

  const results = files.map((file) => {
    const sniffed = sniffImage(file.buffer);
    if (!sniffed) {
      return {
        name: file.originalname,
        ok: false,
        error: "unsupported or invalid image (jpeg/png/gif/webp only)",
      };
    }
    const img = storeImage({
      buffer: file.buffer,
      uploadedBy: req.cred.id,
      visibility,
      originalName: file.originalname,
      mime: sniffed.mime,
      ext: sniffed.ext,
    });
    return { name: file.originalname, ok: true, id: img.id, visibility: img.visibility, url: publicUrlFor(img) };
  });

  res.status(201).json({ results });
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
