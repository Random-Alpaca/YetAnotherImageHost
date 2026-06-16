// Auth primitives: username/password accounts, scrypt hashing, login sessions,
// and the requireAuth / requireAdmin middleware.
//
// User-chosen passwords are hashed with scrypt (per-credential random salt),
// stored as `scrypt$<saltHex>$<hashHex>`. Verified with timingSafeEqual.
// Session tokens remain SHA-256 (they are high-entropy random tokens — correct
// and unchanged).
import crypto from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";
import { config } from "./config.js";

const scryptAsync = promisify(crypto.scrypt);

const DAY_MS = 24 * 60 * 60 * 1000;

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

// --- Password hashing (scrypt) --------------------------------------------

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(pw, saltHex, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// --- Accounts (credentials) -----------------------------------------------

export async function createUser({ username, password, role = "user", createdBy = null }) {
  if (!username || !password) throw new Error("username and password required");
  if (!["user", "admin"].includes(role)) throw new Error("invalid role");
  const id = newId();
  const hash = await hashPassword(password);
  try {
    db.prepare(
      `INSERT INTO credentials (id, username, password_hash, role, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, username, hash, role, Date.now(), createdBy);
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      const e = new Error("username already taken");
      e.code = "DUPLICATE_USERNAME";
      throw e;
    }
    throw err;
  }
  return { id, username, role };
}

export function listUsers() {
  return db
    .prepare(
      `SELECT id, username, label, role, created_at, revoked_at, last_used_at, created_by
       FROM credentials ORDER BY created_at DESC`
    )
    .all();
}

export async function login(username, password) {
  if (!username || !password) return null;
  const cred = db
    .prepare(`SELECT * FROM credentials WHERE username = ? AND revoked_at IS NULL`)
    .get(username);
  if (!cred) return null;
  const ok = await verifyPassword(password, cred.password_hash);
  if (!ok) return null;

  db.prepare(`UPDATE credentials SET last_used_at = ? WHERE id = ?`).run(Date.now(), cred.id);

  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + config.sessionTtlDays * DAY_MS;
  db.prepare(
    `INSERT INTO sessions (id, credential_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), cred.id, hashToken(token), now, expiresAt);

  return { token, role: cred.role, username: cred.username };
}

export async function changePassword(credId, currentPw, nextPw) {
  const cred = db.prepare(`SELECT * FROM credentials WHERE id = ? AND revoked_at IS NULL`).get(credId);
  if (!cred) return { ok: false, error: "not found" };
  const ok = await verifyPassword(currentPw, cred.password_hash);
  if (!ok) return { ok: false, error: "wrong current password" };
  const hash = await hashPassword(nextPw);
  db.prepare(`UPDATE credentials SET password_hash = ? WHERE id = ?`).run(hash, credId);
  return { ok: true };
}

export function revokeUser(id) {
  const info = db
    .prepare(`UPDATE credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(Date.now(), id);
  db.prepare(`DELETE FROM sessions WHERE credential_id = ?`).run(id);
  return info.changes > 0;
}

export function adminExists() {
  return !!db
    .prepare(`SELECT 1 FROM credentials WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1`)
    .get();
}

// --- Login / sessions -------------------------------------------------------

export function destroySession(token) {
  if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

// Resolve a session token to its (non-revoked) credential.
function credForSessionToken(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT c.id, c.role, c.username FROM sessions s
         JOIN credentials c ON c.id = s.credential_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND c.revoked_at IS NULL`
      )
      .get(hashToken(token), Date.now()) || null
  );
}

// Express middleware. Attaches req.cred = { id, role, username }.
export function requireAuth(req, res, next) {
  const cred = credForSessionToken(req.signedCookies?.sid);
  if (!cred) return res.status(401).json({ error: "unauthorized" });
  req.cred = cred;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.cred.role !== "admin") return res.status(403).json({ error: "admin only" });
    next();
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    signed: true,
    path: "/",
    maxAge: config.sessionTtlDays * DAY_MS,
  };
}
