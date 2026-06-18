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
  // Direct per-folder image counts in a single query.
  const counts = db
    .prepare(
      `SELECT folder_id, COUNT(*) as count FROM images WHERE folder_id IS NOT NULL GROUP BY folder_id`
    )
    .all();
  const direct = Object.fromEntries(counts.map((c) => [c.folder_id, c.count]));

  // Recursive total = direct count + counts of every descendant. Walk the tree
  // via a children map, memoizing each folder's total.
  const children = {};
  for (const f of folders) (children[f.parent_id] ||= []).push(f);
  const memo = {};
  function total(id) {
    if (memo[id] != null) return memo[id];
    let sum = direct[id] || 0;
    for (const child of children[id] || []) sum += total(child.id);
    return (memo[id] = sum);
  }

  return folders.map((f) => ({ ...f, count: total(f.id) }));
}

export function getFolder(id) {
  return db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) || null;
}

// Delete a folder, reparenting its contents up one level to its own parent
// (root if it was top-level). Child folders and images move to the deleted
// folder's parent before the row is removed, so the FK cascade/SET-NULL never
// fires and nothing is lost. Returns true if a row was removed.
export const deleteFolder = db.transaction((id) => {
  const folder = db.prepare(`SELECT parent_id FROM folders WHERE id = ?`).get(id);
  if (!folder) return false;
  const newParent = folder.parent_id || null;
  db.prepare(`UPDATE folders SET parent_id = ? WHERE parent_id = ?`).run(newParent, id);
  db.prepare(`UPDATE images SET folder_id = ? WHERE folder_id = ?`).run(newParent, id);
  const info = db.prepare(`DELETE FROM folders WHERE id = ?`).run(id);
  return info.changes > 0;
});

// Find a folder by name (case-insensitive) under a given owner and parent, or
// create it. Scoping by parent lets the same name live under different parents.
export function getOrCreateByName(name, ownerId = null, parentId = null) {
  const existing = db
    .prepare(
      `SELECT * FROM folders
       WHERE lower(name) = lower(?) AND (parent_id IS ?) AND (owner_id IS ? OR owner_id IS NULL)`
    )
    .get(name, parentId || null, ownerId);
  if (existing) return existing;
  return createFolder({ name, ownerId, parentId });
}
