// POST /api/upload  (auth required, multipart/form-data)
// Fields: file (the image), visibility=public|private (default private)
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { sniffImage, storeImage, publicUrlFor } from "../images.js";

const router = Router();

// Buffer in memory so we can sniff magic bytes before committing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const visibility = req.body.visibility === "public" ? "public" : "private";

  const sniffed = sniffImage(req.file.buffer);
  if (!sniffed) {
    return res.status(415).json({ error: "unsupported or invalid image (jpeg/png/gif/webp only)" });
  }

  const img = storeImage({
    buffer: req.file.buffer,
    uploadedBy: req.cred.id,
    visibility,
    originalName: req.file.originalname,
    mime: sniffed.mime,
    ext: sniffed.ext,
  });

  res.status(201).json({ id: img.id, visibility: img.visibility, url: publicUrlFor(img) });
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
