// Image storage helpers: magic-byte sniffing, safe id/path generation, the DB
// row writer, listing, deletion, visibility toggle, and folder assignment.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

// Sniff the real type from the file header rather than trusting the extension
// or client-supplied Content-Type. Returns {mime, ext} or null if unsupported.
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

function rootFor(visibility) {
  return visibility === "private" ? config.storagePrivate : config.storagePublic;
}

// Persist a validated image buffer to disk under <root>/YYYY/<id>.<ext> and
// insert the DB row. Returns the image record.
export function storeImage({ buffer, uploadedBy, visibility, originalName, mime, ext, folderId = null }) {
  const id = crypto.randomBytes(12).toString("hex");
  const year = new Date().getUTCFullYear().toString();
  const relPath = path.posix.join(year, `${id}.${ext}`);
  const absDir = path.join(rootFor(visibility), year);
  const absPath = path.join(absDir, `${id}.${ext}`);

  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(absPath, buffer);

  const now = Date.now();
  db.prepare(
    `INSERT INTO images
       (id, uploaded_by, visibility, stored_path, original_name, mime, size, created_at, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, uploadedBy, visibility, relPath, originalName || null, mime, buffer.length, now, folderId || null);

  return { id, uploaded_by: uploadedBy, visibility, stored_path: relPath, mime, size: buffer.length, created_at: now, folder_id: folderId || null };
}

export function getImage(id) {
  return db.prepare(`SELECT * FROM images WHERE id = ?`).get(id) || null;
}

export function listImages({ folder } = {}) {
  let query;
  let params = [];

  if (folder === "none") {
    query = `SELECT id, uploaded_by, visibility, stored_path, original_name, mime, size, created_at, folder_id
             FROM images WHERE folder_id IS NULL ORDER BY created_at DESC`;
  } else if (folder) {
    query = `SELECT id, uploaded_by, visibility, stored_path, original_name, mime, size, created_at, folder_id
             FROM images WHERE folder_id = ? ORDER BY created_at DESC`;
    params = [folder];
  } else {
    query = `SELECT id, uploaded_by, visibility, stored_path, original_name, mime, size, created_at, folder_id
             FROM images ORDER BY created_at DESC`;
  }

  const rows = db.prepare(query).all(...params);
  return rows.map((r) => ({ ...r, url: publicUrlFor(r) }));
}

// Delete the DB row and the file on disk. Returns true if a row was removed.
export function deleteImage(id) {
  const img = getImage(id);
  if (!img) return false;
  const abs = path.join(rootFor(img.visibility), img.stored_path);
  fs.rm(abs, { force: true }, () => {}); // best-effort; row is the source of truth
  db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
  return true;
}

// Toggle an image's visibility: move the file between storage roots, update DB.
// Returns the updated image row.
export function setVisibility(img, visibility) {
  if (img.visibility === visibility) return img;
  const oldAbs = path.join(rootFor(img.visibility), img.stored_path);
  const newRoot = rootFor(visibility);
  const newAbs = path.join(newRoot, img.stored_path);
  // Ensure target directory exists
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
  db.prepare(`UPDATE images SET visibility = ? WHERE id = ?`).run(visibility, img.id);
  return { ...img, visibility };
}

// Update a single image's folder assignment.
export function setFolder(id, folderId) {
  db.prepare(`UPDATE images SET folder_id = ? WHERE id = ?`).run(folderId || null, id);
}

// Permission check: owner-or-admin.
export function canModify(cred, img) {
  return cred.role === "admin" || img.uploaded_by === cred.id;
}

// Build the URL clients use to fetch an image. Public URLs include the full
// stored_path (e.g. 2026/<id>.png) so Nginx's `alias /srv/images/public/` +
// try_files resolves the file inside its year subdirectory.
export function publicUrlFor(img) {
  return img.visibility === "private"
    ? `/i/private/${img.id}`
    : `/i/public/${img.stored_path}`;
}
