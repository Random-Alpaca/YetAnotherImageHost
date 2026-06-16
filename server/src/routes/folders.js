// /api/folders — list, create, and delete folders.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
  createFolder,
  listFolders,
  getFolder,
  deleteFolder,
} from "../folders.js";

const router = Router();

// GET /api/folders — all authed users see all folders (shared space for now).
router.get("/", requireAuth, (req, res) => {
  res.json({ folders: listFolders() });
});

// POST /api/folders — any authed user may create a folder.
router.post("/", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const folder = createFolder({ name, ownerId: req.cred.id });
    res.status(201).json(folder);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/folders/:id — owner-or-admin.
router.delete("/:id", requireAuth, (req, res) => {
  const folder = getFolder(req.params.id);
  if (!folder) return res.status(404).json({ error: "not found" });
  if (req.cred.role !== "admin" && folder.owner_id !== req.cred.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  deleteFolder(req.params.id);
  res.json({ ok: true });
});

export default router;
