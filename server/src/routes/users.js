// /api/users — create, list, and revoke user accounts.
// Any authed user can create accounts (but only admins may create admin accounts).
// Listing and revocation are admin-only.
import { Router } from "express";
import { requireAuth, requireAdmin, createUser, listUsers, revokeUser } from "../auth.js";

const router = Router();

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

export default router;
