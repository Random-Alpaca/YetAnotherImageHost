// /api/login, /api/me, /api/logout, /api/me/password
import { Router } from "express";
import {
  login,
  destroySession,
  sessionCookieOptions,
  requireAuth,
  changePassword,
} from "../auth.js";

const router = Router();

// Username+password login -> sets the session cookie.
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const result = await login(username, password);
  if (!result) return res.status(401).json({ error: "invalid username or password" });
  res.cookie("sid", result.token, sessionCookieOptions());
  res.json({ role: result.role, username: result.username });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ role: req.cred.role, username: req.cred.username });
});

router.post("/logout", requireAuth, (req, res) => {
  destroySession(req.signedCookies.sid);
  res.clearCookie("sid", { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

// Self-service password change.
router.post("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }
  const result = await changePassword(req.cred.id, currentPassword, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

export default router;
