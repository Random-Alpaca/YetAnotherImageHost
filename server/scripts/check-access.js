// Self-check for folder access control. Runs against a throwaway DB:
//   node scripts/check-access.js
// Asserts the rules that matter: restricted folders stay restricted, a
// subfolder is not a side door into its parent, and a published album is
// readable by anonymous visitors.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-hoster-check-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.STORAGE_PUBLIC = path.join(tmp, "public");
process.env.STORAGE_PRIVATE = path.join(tmp, "private");
process.env.COOKIE_SECRET = "check";

const { createFolder, updateFolderSharing, setFolderShares, canAccessFolder, getFolder } =
  await import("../src/folders.js");
const { canViewImage } = await import("../src/routes/images.js");
const { db } = await import("../src/db.js");

const admin = { id: "adm", role: "admin" };
const owner = { id: "own", role: "user" };
const friend = { id: "fri", role: "user" };
const stranger = { id: "str", role: "user" };

// Real credential rows: folders.owner_id / folder_shares are FK-constrained.
for (const c of [admin, owner, friend, stranger]) {
  db.prepare(
    `INSERT INTO credentials (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', ?, 0)`
  ).run(c.id, c.id, c.role);
}

const open = createFolder({ name: "open", ownerId: owner.id });
const secret = createFolder({ name: "secret", ownerId: owner.id });
updateFolderSharing(secret.id, { access: "shared" });
setFolderShares(secret.id, [friend.id]);
const child = createFolder({ name: "child", ownerId: owner.id, parentId: secret.id });

const f = (x) => getFolder(x.id);

// Default folders stay visible to everyone signed in (pre-existing behaviour).
assert.equal(canAccessFolder(stranger, f(open)), true);

// 'shared': owner, admins, and named people only.
assert.equal(canAccessFolder(owner, f(secret)), true);
assert.equal(canAccessFolder(admin, f(secret)), true);
assert.equal(canAccessFolder(friend, f(secret)), true);
assert.equal(canAccessFolder(stranger, f(secret)), false);

// A default-'everyone' child of a restricted parent must NOT leak.
assert.equal(f(child).access, "everyone");
assert.equal(canAccessFolder(stranger, f(child)), false);
assert.equal(canAccessFolder(friend, f(child)), true);

// 'admins': not even the folder's own audience, but the owner keeps access.
updateFolderSharing(open.id, { access: "admins" });
assert.equal(canAccessFolder(stranger, f(open)), false);
assert.equal(canAccessFolder(admin, f(open)), true);
assert.equal(canAccessFolder(owner, f(open)), true);

// Anonymous callers get nothing until the folder is published.
assert.equal(canAccessFolder(null, f(secret)), false);
const img = { id: "i1", folder_id: secret.id, visibility: "private" };
assert.equal(canViewImage(null, img), false);
assert.equal(canViewImage(stranger, img), false);
assert.equal(canViewImage(friend, img), true);

// Publishing opens it to link holders; un-publishing closes it again.
updateFolderSharing(secret.id, { is_public: true });
assert.ok(f(secret).public_slug);
assert.equal(canViewImage(null, img), true);
updateFolderSharing(secret.id, { is_public: false });
assert.equal(f(secret).public_slug, null);
assert.equal(canViewImage(null, img), false);

// Unfiled images stay in the shared portal space for any signed-in user.
assert.equal(canViewImage(stranger, { id: "i2", folder_id: null }), true);
assert.equal(canViewImage(null, { id: "i2", folder_id: null }), false);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("access control checks passed");
