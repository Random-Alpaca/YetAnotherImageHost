// Auth primitives: password issuance/revocation, login sessions, and the
// requireAuth / requireAdmin middleware.
//
// Passwords are high-entropy random tokens (not user-chosen), so a fast keyed
// SHA-256 lookup is both safe (brute-force-infeasible) and O(1) at login.
// Only hashes are stored, so a DB leak exposes no usable credentials.
import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

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

// --- Passwords (credentials) ---------------------------------------------

// Issue a new access password. Returns the plaintext ONCE; only the hash is
// stored. `label` is a human note (e.g. "for the design team").
export function issuePassword({ label = null, role = "user" } = {}) {
  const password = randomToken();
  const id = newId();
  db.prepare(
    `INSERT INTO credentials (id, label, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, label, hashToken(password), role, Date.now());
  return { id, password, role, label };
}

export function listPasswords() {
  return db
    .prepare(
      `SELECT id, label, role, created_at, revoked_at, last_used_at
       FROM credentials ORDER BY created_at DESC`
    )
    .all();
}

export function revokePassword(id) {
  const info = db
    .prepare(`UPDATE credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(Date.now(), id);
  // Kill any live sessions for this credential immediately.
  db.prepare(`DELETE FROM sessions WHERE credential_id = ?`).run(id);
  return info.changes > 0;
}

export function adminExists() {
  return !!db
    .prepare(`SELECT 1 FROM credentials WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1`)
    .get();
}

// --- Login / sessions ----------------------------------------------------

// Verify a password and start a session. Returns {token, role} or null.
export function login(password) {
  if (!password) return null;
  const cred = db
    .prepare(`SELECT * FROM credentials WHERE password_hash = ? AND revoked_at IS NULL`)
    .get(hashToken(password));
  if (!cred) return null;

  db.prepare(`UPDATE credentials SET last_used_at = ? WHERE id = ?`).run(Date.now(), cred.id);

  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + config.sessionTtlDays * DAY_MS;
  db.prepare(
    `INSERT INTO sessions (id, credential_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), cred.id, hashToken(token), now, expiresAt);

  return { token, role: cred.role };
}

export function destroySession(token) {
  if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

// Resolve a session token to its (non-revoked) credential.
function credForSessionToken(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT c.id, c.role FROM sessions s
         JOIN credentials c ON c.id = s.credential_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND c.revoked_at IS NULL`
      )
      .get(hashToken(token), Date.now()) || null
  );
}

// Express middleware. Attaches req.cred = { id, role }.
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
