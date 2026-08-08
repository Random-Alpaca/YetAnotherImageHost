// /api/users — create, list, revoke, and delete user accounts.
// Any authed user can create accounts (but only admins may create admin accounts).
// Listing, revocation, and deletion are admin-only.
import { Router } from "express";
import {
  requireAuth, requireAdmin, createUser, listUsers, revokeUser, deleteUser,
  createSignupRequest, listSignupRequests, approveSignupRequest, deleteSignupRequest,
} from "../auth.js";

const router = Router();

// --- Self-service signup (unauthenticated) ---------------------------------

// POST /api/users/signup — file a request for an admin to approve. Always
// answers the same way so this can't be used to enumerate usernames.
router.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  await createSignupRequest(username.trim(), password);
  res.status(202).json({ ok: true });
});

// The approval queue. Admin only.
router.get("/requests", requireAdmin, (req, res) => {
  res.json({ requests: listSignupRequests() });
});

router.post("/requests/:id/approve", requireAdmin, async (req, res) => {
  try {
    const user = await approveSignupRequest(req.params.id, req.cred.id);
    if (!user) return res.status(404).json({ error: "not found" });
    res.status(201).json(user);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.delete("/requests/:id", requireAdmin, (req, res) => {
  if (!deleteSignupRequest(req.params.id)) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// GET /api/users/names — id + username of active accounts, for the folder
// share picker. Any authed user; you can't share with someone you can't name.
router.get("/names", requireAuth, (req, res) => {
  res.json({
    users: listUsers()
      .filter((u) => !u.revoked_at && u.username)
      .map((u) => ({ id: u.id, username: u.username })),
  });
});

// Create a new user account. Any logged-in user can do this (invite-only
// because you need a session), but only admins may set role: "admin".
router.post("/", requireAuth, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  // Non-admins may only create 'user' accounts.
  const finalRole = role === "admin" ? (req.cred.role === "admin" ? "admin" : "user") : "user";

  try {
    const user = await createUser({
      username,
      password,
      role: finalRole,
      createdBy: req.cred.id,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === "DUPLICATE_USERNAME") {
      return res.status(409).json({ error: "username already taken" });
    }
    throw err;
  }
});

// List all users. Admin only.
router.get("/", requireAdmin, (req, res) => {
  res.json({ users: listUsers() });
});

// Revoke a user account. Admin only.
router.post("/:id/revoke", requireAdmin, (req, res) => {
  const ok = revokeUser(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found or already revoked" });
  res.json({ ok: true });
});

// Permanently delete a user account. Admin only. Can't delete yourself (avoid
// locking yourself out) or the last active admin (avoid locking everyone out).
router.delete("/:id", requireAdmin, (req, res) => {
  if (req.params.id === req.cred.id) {
    return res.status(400).json({ error: "cannot delete your own account" });
  }
  try {
    const ok = deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
