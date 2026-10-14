// Image storage helpers: magic-byte sniffing, safe id/path generation, the DB
// row writer, listing, deletion, visibility toggle, and folder assignment.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
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

export function rootFor(visibility) {
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

// Opaque keyset cursors remain stable when newer uploads arrive between pages.
export function parsePagination(query = {}) {
  const rawLimit = query.limit === undefined ? "48" : query.limit;
  if (typeof rawLimit !== "string" || !/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (!Number.isSafeInteger(cursor?.t) || cursor.t < 0 || typeof cursor.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(cursor.id)) throw new Error();
    } catch {
      throw new Error("invalid cursor");
    }
  }
  return { limit: Number(rawLimit), cursor };
}

// Access restrictions belong in SQL, before both COUNT and LIMIT. A JSON array
// avoids SQLite's variable limit when a user has access to many folders.
export function listImages({ folder, allowedFolderIds = null, limit = 48, cursor = null } = {}) {
  const where = [];
  const params = [];
  if (folder === "none") {
    where.push("folder_id IS NULL");
  } else if (folder) {
    where.push("folder_id = ?");
    params.push(folder);
  }
  if (allowedFolderIds !== null) {
    where.push("(folder_id IS NULL OR folder_id IN (SELECT value FROM json_each(?)))");
    params.push(JSON.stringify([...allowedFolderIds]));
  }
  const restriction = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM images ${restriction}`).get(...params).count;
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.t, cursor.t, cursor.id);
  }
  const rows = db.prepare(`SELECT * FROM images ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const images = rows.slice(0, limit).map(imageResponse);
  const last = images.at(-1);
  return {
    images,
    total,
    next_cursor: hasMore && last
      ? Buffer.from(JSON.stringify({ t: last.created_at, id: last.id })).toString("base64url")
      : null,
  };
}

// Delete the DB row and the file on disk. Returns true if a row was removed.
export function deleteImage(id) {
  return db.transaction(() => {
    const img = getImage(id);
    if (!img) return false;
    // Remove derived bytes before deleting metadata; a failure remains retryable.
    for (const file of [...thumbnailRecords(id), img]) {
      fs.rmSync(path.join(rootFor(img.visibility), file.stored_path), { force: true });
    }
    db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
    return true;
  }).immediate();
}

// Toggle an image's visibility: move the file between storage roots, update DB.
// Returns the updated image row.
export function setVisibility(img, visibility) {
  // Also serialize against a backfill process committing previews in this DB.
  return db.transaction(() => {
    img = getImage(img.id);
    if (!img) throw new Error("image not found");
    if (img.visibility === visibility) return img;
    const moved = [];
    const missing = [];
    try {
      for (const file of [img, ...thumbnailRecords(img.id)]) {
        const oldAbs = path.join(rootFor(img.visibility), file.stored_path);
        const newAbs = path.join(rootFor(visibility), file.stored_path);
        if (file !== img && !fs.existsSync(oldAbs)) {
          missing.push(file.size);
          continue;
        }
        fs.mkdirSync(path.dirname(newAbs), { recursive: true });
        fs.renameSync(oldAbs, newAbs);
        moved.push({ oldAbs, newAbs });
      }
      db.prepare(`UPDATE images SET visibility = ? WHERE id = ?`).run(visibility, img.id);
      for (const size of missing) db.prepare("DELETE FROM image_thumbnails WHERE image_id = ? AND size = ?").run(img.id, size);
    } catch (err) {
      // Leave the old record usable when a filesystem move or DB write fails.
      for (const { oldAbs, newAbs } of moved.reverse()) fs.renameSync(newAbs, oldAbs);
      throw err;
    }
    return { ...img, visibility };
  }).immediate();
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

export const THUMBNAIL_VERSION = 1;
export const THUMBNAIL_SIZES = [320, 640];

export function thumbnailRecords(id) {
  return db.prepare("SELECT * FROM image_thumbnails WHERE image_id = ? ORDER BY size").all(id);
}

export function thumbnailsFor(img) {
  return thumbnailRecords(img.id)
    .filter((thumb) => thumb.version === THUMBNAIL_VERSION)
    .map((thumb) => ({
      url: img.visibility === "private"
        ? `/i/private/${img.id}/thumbnail/${thumb.size}`
        : `/i/public/${thumb.stored_path}`,
      width: thumb.width,
      height: thumb.height,
    }));
}

export function imageResponse(img) {
  return { ...img, url: publicUrlFor(img), thumbnails: thumbnailsFor(img) };
}

export function hasCurrentThumbnails(img) {
  const records = thumbnailRecords(img.id);
  return THUMBNAIL_SIZES.every((size) => records.some((record) =>
    record.size === size && record.version === THUMBNAIL_VERSION &&
    fs.existsSync(path.join(rootFor(img.visibility), record.stored_path))));
}

// Limit memory used by libvips and the number of concurrent decodes. Each job
// encodes its two sizes sequentially. In-flight jobs for one image are shared.
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });
const pendingThumbnails = new Map();
const thumbnailQueue = [];
let activeThumbnails = 0;

function runThumbnailQueue() {
  while (activeThumbnails < config.thumbnailConcurrency && thumbnailQueue.length) {
    const { task, resolve, reject } = thumbnailQueue.shift();
    activeThumbnails++;
    Promise.resolve().then(task).then(resolve, reject).finally(() => {
      activeThumbnails--;
      runThumbnailQueue();
    });
  }
}

// Generation can fail for corrupt/oversized originals; callers retain the
// original and expose an empty thumbnail list so the gallery can fall back.
export function ensureThumbnails(id) {
  if (pendingThumbnails.has(id)) return pendingThumbnails.get(id);
  const promise = new Promise((resolve, reject) => {
    thumbnailQueue.push({ task: () => generateThumbnails(id), resolve, reject });
    runThumbnailQueue();
  });
  pendingThumbnails.set(id, promise);
  promise.finally(() => pendingThumbnails.delete(id)).catch(() => {});
  return promise;
}

async function generateThumbnails(id) {
  let img = getImage(id);
  if (!img) return [];
  if (hasCurrentThumbnails(img)) return thumbnailsFor(img);
  const input = path.join(rootFor(img.visibility), img.stored_path);
  const generated = [];
  for (const size of THUMBNAIL_SIZES) {
    // One still frame for animated GIF/WebP. rotate() applies EXIF orientation;
    // WebP keeps alpha. Fit inside a square without enlarging small originals.
    const { data, info } = await sharp(input, {
      limitInputPixels: config.thumbnailMaxPixels,
      animated: false,
      pages: 1,
      failOn: "error",
    }).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
    generated.push({ size, data, width: info.width, height: info.height });
  }

  // A delete or visibility change may happen during async decoding, including
  // in a separate process while the backfill CLI runs. A write transaction
  // serializes the row re-read and file commit with both lifecycle operations.
  return db.transaction(() => {
    img = getImage(id);
    if (!img) return [];
    const root = rootFor(img.visibility);
    const previous = thumbnailRecords(id);
    const written = [];
    try {
      for (const thumb of generated) {
        thumb.stored_path = path.posix.join(path.posix.dirname(img.stored_path),
          `${id}.thumb-v${THUMBNAIL_VERSION}-${thumb.size}.webp`);
        const absolute = path.join(root, thumb.stored_path);
        const temporary = `${absolute}.${crypto.randomBytes(6).toString("hex")}.tmp`;
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        try {
          fs.writeFileSync(temporary, thumb.data, { flag: "wx" });
          fs.renameSync(temporary, absolute);
          written.push(absolute);
        } finally {
          fs.rmSync(temporary, { force: true });
        }
      }
      const put = db.prepare(`INSERT OR REPLACE INTO image_thumbnails
        (image_id, size, version, stored_path, width, height) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const thumb of generated) put.run(id, thumb.size, THUMBNAIL_VERSION, thumb.stored_path, thumb.width, thumb.height);
    } catch (err) {
      // Never expose records for a partial batch. Existing current-version files
      // may have been atomically replaced and can safely remain for a retry.
      const existingPaths = new Set(previous.map((record) => path.join(root, record.stored_path)));
      for (const absolute of written) {
        if (!existingPaths.has(absolute)) fs.rmSync(absolute, { force: true });
      }
      throw err;
    }
    for (const old of previous) {
      if (!generated.some((thumb) => thumb.stored_path === old.stored_path)) {
        fs.rmSync(path.join(root, old.stored_path), { force: true });
      }
    }
    return thumbnailsFor(img);
  }).immediate();
}
