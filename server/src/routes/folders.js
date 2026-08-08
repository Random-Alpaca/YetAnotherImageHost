// /api/folders — list, create, and delete folders.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
  createFolder,
  listFolders,
  getFolder,
  deleteFolder,
  canAccessFolder,
  folderShareIds,
  setFolderShares,
  updateFolderSharing,
} from "../folders.js";

const router = Router();

const canModify = (cred, f) => cred.role === "admin" || f.owner_id === cred.id;

// GET /api/folders — only the folders this user may see (see canAccessFolder).
// Each folder carries can_modify (owner-or-admin) so the client can gate delete.
router.get("/", requireAuth, (req, res) => {
  const folders = listFolders()
    .filter((f) => canAccessFolder(req.cred, f))
    .map((f) => ({
      ...f,
      is_public: !!f.public_slug,
      public_upload: !!f.public_upload,
      can_modify: canModify(req.cred, f),
      // Only whoever can change the sharing needs the link or the member list.
      ...(canModify(req.cred, f)
        ? { shared_with: folderShareIds(f.id) }
        : { public_slug: undefined }),
    }));
  res.json({ folders });
});

// POST /api/folders — any authed user may create a folder.
router.post("/", requireAuth, (req, res) => {
  const { name, parent_id, access } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  if (parent_id) {
    const parent = getFolder(parent_id);
    if (!parent) return res.status(400).json({ error: "parent_id not found" });
    if (!canAccessFolder(req.cred, parent)) return res.status(403).json({ error: "forbidden" });
  }
  try {
    const folder = createFolder({ name, ownerId: req.cred.id, parentId: parent_id || null });
    if (access) updateFolderSharing(folder.id, { access });
    res.status(201).json(getFolder(folder.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/folders/:id — sharing settings. Owner-or-admin.
// Body: { access?, is_public?, public_upload?, shared_with?: [credentialId] }
router.patch("/:id", requireAuth, (req, res) => {
  const folder = getFolder(req.params.id);
  if (!folder) return res.status(404).json({ error: "not found" });
  if (!canModify(req.cred, folder)) return res.status(403).json({ error: "forbidden" });

  const { access, is_public, public_upload, shared_with } = req.body || {};
  try {
    const updated = updateFolderSharing(req.params.id, { access, is_public, public_upload });
    if (Array.isArray(shared_with)) setFolderShares(req.params.id, shared_with);
    res.json({
      ...updated,
      is_public: !!updated.public_slug,
      public_upload: !!updated.public_upload,
      shared_with: folderShareIds(req.params.id),
    });
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
