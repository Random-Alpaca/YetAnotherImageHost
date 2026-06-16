// Folder management helpers.
import crypto from "node:crypto";
import { db } from "./db.js";

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

export function createFolder({ name, ownerId = null, parentId = null }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("folder name is required");
  }
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO folders (id, name, parent_id, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, name.trim(), parentId || null, ownerId || null, now);
  return { id, name: name.trim(), parent_id: parentId || null, owner_id: ownerId || null, created_at: now };
}

export function listFolders() {
  const folders = db
    .prepare(`SELECT id, name, parent_id, owner_id, created_at FROM folders ORDER BY name ASC`)
    .all();
  // Attach image counts in a single query.
  const counts = db
    .prepare(
      `SELECT folder_id, COUNT(*) as count FROM images WHERE folder_id IS NOT NULL GROUP BY folder_id`
    )
    .all();
  const countMap = Object.fromEntries(counts.map((c) => [c.folder_id, c.count]));
  return folders.map((f) => ({ ...f, count: countMap[f.id] || 0 }));
}

export function getFolder(id) {
  return db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) || null;
}

// Delete a folder. Images inside become folderless via FK ON DELETE SET NULL.
export function deleteFolder(id) {
  const info = db.prepare(`DELETE FROM folders WHERE id = ?`).run(id);
  return info.changes > 0;
}

// Find a folder by name (case-insensitive) for a given owner, or create it.
export function getOrCreateByName(name, ownerId = null) {
  const existing = db
    .prepare(`SELECT * FROM folders WHERE lower(name) = lower(?) AND (owner_id IS ? OR owner_id IS NULL)`)
    .get(name, ownerId);
  if (existing) return existing;
  return createFolder({ name, ownerId });
}
