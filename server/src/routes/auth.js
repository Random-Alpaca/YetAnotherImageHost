// /api/login, /api/me, /api/logout
import { Router } from "express";
import { login, destroySession, sessionCookieOptions, requireAuth } from "../auth.js";

const router = Router();

// Password-only login -> sets the session cookie.
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  const result = login(password);
  if (!result) return res.status(401).json({ error: "invalid password" });
  res.cookie("sid", result.token, sessionCookieOptions());
  res.json({ role: result.role });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ role: req.cred.role });
});

router.post("/logout", requireAuth, (req, res) => {
  destroySession(req.signedCookies.sid);
  res.clearCookie("sid", { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

export default router;
