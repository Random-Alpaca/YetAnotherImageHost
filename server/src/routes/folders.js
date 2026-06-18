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
// Each folder carries can_modify (owner-or-admin) so the client can gate delete.
router.get("/", requireAuth, (req, res) => {
  const folders = listFolders().map((f) => ({
    ...f,
    can_modify: req.cred.role === "admin" || f.owner_id === req.cred.id,
  }));
  res.json({ folders });
});

// POST /api/folders — any authed user may create a folder.
router.post("/", requireAuth, (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  if (parent_id && !getFolder(parent_id)) {
    return res.status(400).json({ error: "parent_id not found" });
  }
  try {
    const folder = createFolder({ name, ownerId: req.cred.id, parentId: parent_id || null });
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
