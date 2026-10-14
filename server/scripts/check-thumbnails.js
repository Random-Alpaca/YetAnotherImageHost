// End-to-end thumbnail, authorization, storage, and pagination regression checks.
// Run with: node scripts/check-thumbnails.js
// Uses an isolated temporary database/storage and real signed login cookies.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-hoster-thumbnails-"));
Object.assign(process.env, {
  DB_PATH: path.join(tmp, "test.db"),
  STORAGE_PUBLIC: path.join(tmp, "public"),
  STORAGE_PRIVATE: path.join(tmp, "private"),
  COOKIE_SECRET: "thumbnail-regression-check-only",
  COOKIE_SECURE: "false",
  DEV_DIRECT_SERVE: "true",
});

let server;
let db;
try {
  const [
    { default: express }, { default: cookieParser }, { default: sharp },
    { config }, database, { createUser }, folders, images,
    { default: authRoutes }, { default: uploadRoutes, processFiles },
    { default: imageRoutes, privateRouter }, { default: albumRoutes },
  ] = await Promise.all([
    import("express"), import("cookie-parser"), import("sharp"),
    import("../src/config.js"), import("../src/db.js"), import("../src/auth.js"),
    import("../src/folders.js"), import("../src/images.js"),
    import("../src/routes/auth.js"), import("../src/routes/upload.js"),
    import("../src/routes/images.js"), import("../src/routes/albums.js"),
  ]);
  db = database.db;
  const { createFolder, getFolder, updateFolderSharing, setFolderShares } = folders;
  const { getImage, storeImage } = images;

  const app = express();
  app.use(express.json());
  app.use(cookieParser(config.cookieSecret));
  app.use("/i/public", express.static(config.storagePublic));
  app.use("/api", authRoutes);
  app.use("/api", uploadRoutes);
  app.use("/api/images", imageRoutes);
  app.use("/api/albums", albumRoutes);
  app.use("/i", privateRouter);
  app.use((req, res) => res.status(404).json({ error: "not found" }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function request(url, { cookie, json, headers = {}, ...options } = {}) {
    return fetch(`${base}${url}`, {
      ...options,
      headers: {
        ...headers,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
      redirect: "manual",
    });
  }

  async function jsonResponse(response, status = 200) {
    assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`);
    return response.json();
  }

  async function loggedInUser(username, role = "user") {
    const password = "thumbnail-test-password";
    const user = await createUser({ username, password, role });
    const response = await request("/api/login", { method: "POST", json: { username, password } });
    await jsonResponse(response);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("sid="), "login must issue a signed session cookie");
    return { ...user, cookie };
  }

  const owner = await loggedInUser("owner");
  const friend = await loggedInUser("friend");
  const stranger = await loggedInUser("stranger");
  const admin = await loggedInUser("admin", "admin");

  // A deliberately asymmetric source makes incorrect thumbnail dimensions visible.
  const original = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#4184b8" },
  }).png().toBuffer();

  async function uploadImage({ folderId, visibility = "private" } = {}) {
    const body = new FormData();
    body.append("file", new Blob([original], { type: "image/png" }), "landscape.png");
    body.append("visibility", visibility);
    if (folderId) body.append("folder_id", folderId);
    const result = await jsonResponse(await request("/api/upload", {
      method: "POST", cookie: owner.cookie, body,
    }), 201);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].ok, true, JSON.stringify(result));
    return result.results[0];
  }

  function thumbnailRows(id) {
    return db.prepare("SELECT * FROM image_thumbnails WHERE image_id = ? ORDER BY size").all(id);
  }

  function imagePaths(id, visibility = getImage(id).visibility) {
    const root = visibility === "private" ? config.storagePrivate : config.storagePublic;
    return [getImage(id).stored_path, ...thumbnailRows(id).map((row) => row.stored_path)]
      .map((rel) => path.join(root, rel));
  }

  function assertRevalidated(response) {
    const cache = response.headers.get("cache-control") || "";
    for (const directive of ["private", "no-cache", "must-revalidate"]) {
      assert.ok(cache.split(/\s*,\s*/).includes(directive), `protected response needs ${directive}: ${cache}`);
    }
  }

  async function assertPreviews(item, cookie) {
    assert.equal(item.thumbnails.length, 2, "upload/list must expose both preview choices");
    assert.deepEqual(item.thumbnails.map((thumb) => thumb.width), [320, 640]);
    for (const thumb of item.thumbnails) {
      assert.equal(thumb.height, thumb.width / 2);
      const response = await request(thumb.url, { cookie });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^image\/webp\b/);
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, thumb.width);
      assert.equal(metadata.height, thumb.height);
    }
  }

  const parent = createFolder({ name: "restricted", ownerId: owner.id });
  updateFolderSharing(parent.id, { access: "shared" });
  setFolderShares(parent.id, [friend.id]);
  const child = createFolder({ name: "child", ownerId: owner.id, parentId: parent.id });
  const item = await uploadImage({ folderId: child.id });
  await assertPreviews(item, owner.cookie);
  const sourceResponse = await request(item.url, { cookie: owner.cookie });
  assert.equal(sourceResponse.status, 200);
  assertRevalidated(sourceResponse);
  assert.deepEqual(Buffer.from(await sourceResponse.arrayBuffer()), original, "uploads preserve the original bytes");
  assert.deepEqual(fs.readFileSync(imagePaths(item.id)[0]), original);

  // Access follows every ancestor, including for apparently open child folders.
  for (const user of [owner, friend, admin]) {
    const response = await request(item.thumbnails[0].url, { cookie: user.cookie });
    assert.equal(response.status, 200, `${user.username} should have thumbnail access`);
    assertRevalidated(response);
    await response.arrayBuffer();
  }
  for (const cookie of [undefined, stranger.cookie]) {
    assert.equal((await request(item.thumbnails[0].url, { cookie })).status, 404);
  }
  updateFolderSharing(parent.id, { is_public: true });
  assert.equal((await request(item.thumbnails[0].url)).status, 404, "publishing a parent does not publish descendants");
  updateFolderSharing(parent.id, { is_public: false });

  // A public album grants access to private previews, with immediate revocation.
  updateFolderSharing(child.id, { is_public: true });
  const slug = getFolder(child.id).public_slug;
  const album = await jsonResponse(await request(`/api/albums/${slug}?limit=1`));
  assert.equal(album.total, 1);
  assert.equal(album.images[0].id, item.id);
  assert.equal(album.images[0].thumbnails.length, 2);
  updateFolderSharing(child.id, { public_upload: true });
  const albumUploadBody = new FormData();
  albumUploadBody.append("file", new Blob([original], { type: "image/png" }), "contribution.png");
  const contributionResponse = await jsonResponse(await request(`/api/albums/${slug}/upload`, {
    method: "POST", body: albumUploadBody,
  }), 201);
  const contribution = contributionResponse.results[0];
  assert.equal(contribution.ok, true);
  assert.equal(contribution.visibility, "private");
  assert.equal(getImage(contribution.id).uploaded_by, null);
  await assertPreviews(contribution);
  const anonymousPreview = await request(item.thumbnails[0].url);
  assert.equal(anonymousPreview.status, 200);
  assertRevalidated(anonymousPreview);
  const etag = anonymousPreview.headers.get("etag");
  assert.ok(etag, "direct delivery should support validators");
  await anonymousPreview.arrayBuffer();
  updateFolderSharing(child.id, { is_public: false });
  assert.equal((await request(item.thumbnails[0].url, { headers: { "If-None-Match": etag } })).status, 404);
  assert.equal((await request(contribution.thumbnails[0].url)).status, 404);
  assert.equal((await request(`/api/albums/${slug}`)).status, 404);
  await jsonResponse(await request(`/api/images/${contribution.id}`, { method: "DELETE", cookie: admin.cookie }));

  // Exercise the production handoff independently of development byte delivery.
  config.devDirectServe = false;
  const accelerated = await request(item.thumbnails[0].url, { cookie: friend.cookie });
  assert.equal(accelerated.status, 200);
  assert.equal(accelerated.headers.get("x-accel-redirect"), path.posix.join(config.internalPrefix, thumbnailRows(item.id)[0].stored_path));
  assert.match(accelerated.headers.get("content-type"), /^image\/webp\b/);
  assert.equal(await accelerated.text(), "");
  assertRevalidated(accelerated);
  const acceleratedOriginal = await request(item.url, { cookie: owner.cookie });
  assert.equal(acceleratedOriginal.headers.get("x-accel-redirect"), path.posix.join(config.internalPrefix, getImage(item.id).stored_path));
  assertRevalidated(acceleratedOriginal);
  assert.equal((await request(item.thumbnails[0].url, { headers: { "If-None-Match": etag } })).status, 404);
  config.devDirectServe = true;

  // Moving visibility moves every derivative and changes all delivery URLs.
  const movable = await uploadImage();
  const oldPrivatePaths = imagePaths(movable.id);
  const publicItem = await jsonResponse(await request(`/api/images/${movable.id}/visibility`, {
    method: "PATCH", cookie: owner.cookie, json: { visibility: "public" },
  }));
  assert.match(publicItem.url, /^\/i\/public\//);
  assert.ok(publicItem.thumbnails.every((thumb) => thumb.url.startsWith("/i/public/")));
  assert.ok(oldPrivatePaths.every((file) => !fs.existsSync(file)));
  const publicPaths = imagePaths(movable.id);
  assert.ok(publicPaths.every((file) => fs.existsSync(file)));
  await assertPreviews(publicItem);
  assert.equal((await request(movable.thumbnails[0].url, { cookie: owner.cookie })).status, 404);
  const privateItem = await jsonResponse(await request(`/api/images/${movable.id}/visibility`, {
    method: "PATCH", cookie: owner.cookie, json: { visibility: "private" },
  }));
  assert.match(privateItem.url, /^\/i\/private\//);
  assert.ok(privateItem.thumbnails.every((thumb) => thumb.url.startsWith("/i/private/")));
  assert.ok(publicPaths.every((file) => !fs.existsSync(file)));
  assert.ok(imagePaths(movable.id).every((file) => fs.existsSync(file)));
  assert.equal((await request(publicItem.thumbnails[0].url)).status, 404);
  const deletedPaths = imagePaths(movable.id);
  await jsonResponse(await request(`/api/images/${movable.id}`, { method: "DELETE", cookie: owner.cookie }));
  for (let attempts = 0; deletedPaths.some((file) => fs.existsSync(file)) && attempts < 50; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(deletedPaths.every((file) => !fs.existsSync(file)), "delete must remove originals and previews");
  assert.equal(getImage(movable.id), null);
  assert.equal(thumbnailRows(movable.id).length, 0);

  // A stored upload can be changed by another request while previews are pending.
  // processFiles inserts the row synchronously before its first await for PNGs.
  const movingUpload = processFiles([{ buffer: original, originalname: "moving-upload.png" }], {
    uploadedBy: owner.id, visibility: "private", folderId: child.id,
  });
  const movingRow = db.prepare("SELECT * FROM images WHERE original_name = ?").get("moving-upload.png");
  images.setVisibility(movingRow, "public");
  images.setFolder(movingRow.id, null);
  const [movingResult] = await movingUpload;
  assert.equal(movingResult.ok, true);
  assert.equal(movingResult.visibility, "public");
  assert.equal(movingResult.folder_id, null);
  assert.equal(movingResult.url, images.publicUrlFor(getImage(movingRow.id)));
  assert.ok(movingResult.thumbnails.every((thumb) => thumb.url.startsWith("/i/public/")));
  await assertPreviews(movingResult);
  images.deleteImage(movingRow.id);

  const deletedUpload = processFiles([{ buffer: original, originalname: "deleted-upload.png" }], {
    uploadedBy: owner.id, visibility: "private", folderId: child.id,
  });
  const deletedRow = db.prepare("SELECT * FROM images WHERE original_name = ?").get("deleted-upload.png");
  images.deleteImage(deletedRow.id);
  const [deletedResult] = await deletedUpload;
  assert.equal(deletedResult.ok, false);
  assert.match(deletedResult.error, /deleted during upload/);
  assert.equal(deletedResult.url, undefined);
  assert.equal(thumbnailRows(deletedRow.id).length, 0);

  // A pre-upgrade row has an original URL and remains viewable before backfill.
  const legacy = storeImage({
    buffer: original, uploadedBy: owner.id, visibility: "private", originalName: "legacy.png",
    mime: "image/png", ext: "png", folderId: child.id,
  });
  const beforeBackfill = await jsonResponse(await request(`/api/images/list?folder=${child.id}`, { cookie: owner.cookie }));
  const legacyItem = beforeBackfill.images.find((img) => img.id === legacy.id);
  assert.equal(legacyItem.thumbnails.length, 0);
  const legacyResponse = await request(legacyItem.url, { cookie: owner.cookie });
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(Buffer.from(await legacyResponse.arrayBuffer()), original);

  const backfillScript = fileURLToPath(new URL("./backfill-thumbnails.js", import.meta.url));
  function runBackfill() {
    const result = spawnSync(process.execPath, [backfillScript], { env: process.env, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `backfill failed:\n${result.stdout}\n${result.stderr}`);
  }
  function storageSnapshot() {
    return [item.id, legacy.id].flatMap((id) => imagePaths(id)).map((file) => ({
      file, mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString(), contents: fs.readFileSync(file),
    }));
  }
  runBackfill();
  assert.equal(thumbnailRows(legacy.id).length, 2);
  const afterBackfill = storageSnapshot();
  runBackfill();
  assert.deepEqual(storageSnapshot(), afterBackfill, "rerunning backfill must leave healthy files untouched");
  const missingPreview = imagePaths(legacy.id)[1];
  fs.unlinkSync(missingPreview);
  runBackfill();
  assert.ok(fs.existsSync(missingPreview), "backfill repairs missing preview files");
  assert.equal((await sharp(missingPreview).metadata()).width, 320);
  assert.deepEqual(fs.readFileSync(imagePaths(legacy.id)[0]), original);

  // Seed metadata directly for large-list checks; the upload path was exercised above.
  const large = createFolder({ name: "large", ownerId: owner.id });
  updateFolderSharing(large.id, { access: "shared", is_public: true });
  const insert = db.prepare(`INSERT INTO images
    (id, uploaded_by, visibility, stored_path, original_name, mime, size, created_at, folder_id)
    VALUES (?, ?, 'private', ?, ?, 'image/png', 1, ?, ?)`);
  db.transaction(() => {
    for (let i = 0; i < 117; i++) {
      const id = `page-${String(i).padStart(3, "0")}`;
      insert.run(id, owner.id, `2026/${id}.png`, `${id}.png`, 1000 + Math.floor(i / 9), large.id);
    }
  })();
  const largeUrl = `/api/images/list?folder=${large.id}`;
  const firstPage = await jsonResponse(await request(largeUrl, { cookie: owner.cookie }));
  assert.equal(firstPage.images.length, 48, "default page size is bounded");
  assert.equal(firstPage.total, 117);
  assert.ok(firstPage.next_cursor);
  assert.equal((await jsonResponse(await request(`${largeUrl}&limit=100`, { cookie: owner.cookie }))).images.length, 100);
  for (const limit of ["0", "101", "-1", "1.5", "abc"]) {
    assert.equal((await request(`${largeUrl}&limit=${limit}`, { cookie: owner.cookie })).status, 400, `invalid limit ${limit}`);
  }
  for (const cursor of ["!invalid!", Buffer.from("null").toString("base64url"), Buffer.from('{"created_at":"oops","id":"x"}').toString("base64url")]) {
    assert.equal((await request(`${largeUrl}&cursor=${encodeURIComponent(cursor)}`, { cookie: owner.cookie })).status, 400);
  }
  assert.equal((await request("/api/images/list")).status, 401);
  assert.equal((await request(largeUrl, { cookie: stranger.cookie })).status, 403);

  async function collectPages(url, cookie, pageSize) {
    const ids = [];
    let cursor;
    let pages = 0;
    do {
      const separator = url.includes("?") ? "&" : "?";
      const response = await jsonResponse(await request(`${url}${separator}limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cookie }));
      assert.equal(response.total, 117, "total is independent of page size and position");
      assert.ok(response.images.length <= pageSize);
      ids.push(...response.images.map((img) => img.id));
      cursor = response.next_cursor;
      assert.ok(++pages <= 117, "pagination must terminate");
    } while (cursor);
    return ids;
  }
  const expected = db.prepare("SELECT id FROM images WHERE folder_id = ? ORDER BY created_at DESC, id DESC").all(large.id).map((img) => img.id);
  assert.deepEqual(await collectPages(largeUrl, owner.cookie, 7), expected, "equal timestamps must not duplicate or skip images");
  const largeSlug = getFolder(large.id).public_slug;
  assert.deepEqual(await collectPages(`/api/albums/${largeSlug}`, undefined, 11), expected, "public albums share pagination and totals");
  assert.equal((await request(`/api/albums/${largeSlug}?cursor=invalid`)).status, 400);

  // Inaccessible newer rows must be excluded before applying the SQL page limit.
  const visible = createFolder({ name: "visible", ownerId: owner.id });
  db.transaction(() => {
    for (let i = 0; i < 5; i++) insert.run(`visible-${i}`, owner.id, `2026/visible-${i}.png`, "visible.png", 5000 + i, visible.id);
    for (let i = 0; i < 8; i++) insert.run(`hidden-${i}`, owner.id, `2026/hidden-${i}.png`, "hidden.png", 9000 + i, large.id);
  })();
  const filtered = await jsonResponse(await request("/api/images/list?limit=3", { cookie: stranger.cookie }));
  assert.equal(filtered.total, 5);
  assert.deepEqual(filtered.images.map((img) => img.id), ["visible-4", "visible-3", "visible-2"]);
  const filteredNext = await jsonResponse(await request(`/api/images/list?limit=3&cursor=${encodeURIComponent(filtered.next_cursor)}`, { cookie: stranger.cookie }));
  assert.equal(filteredNext.total, 5);
  assert.deepEqual(filteredNext.images.map((img) => img.id), ["visible-1", "visible-0"]);
  assert.equal(filteredNext.next_cursor, null);

  console.log("thumbnail, authorization, storage, backfill, and pagination checks passed");
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
