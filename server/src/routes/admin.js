// /api/admin/* — issue, list, and revoke access passwords. Admin role only.
import { Router } from "express";
import { requireAdmin, issuePassword, listPasswords, revokePassword } from "../auth.js";

const router = Router();

// Issue a new password. The plaintext is returned ONCE here and nowhere else.
router.post("/passwords", requireAdmin, (req, res) => {
  const { label, role } = req.body || {};
  const finalRole = role === "admin" ? "admin" : "user";
  if (label != null && (typeof label !== "string" || label.length > 100)) {
    return res.status(400).json({ error: "label must be a string up to 100 chars" });
  }
  const created = issuePassword({ label: label || null, role: finalRole });
  res.status(201).json(created); // { id, password, role, label }
});

router.get("/passwords", requireAdmin, (req, res) => {
  res.json({ passwords: listPasswords() });
});

router.post("/passwords/:id/revoke", requireAdmin, (req, res) => {
  // Guard against revoking yourself out of admin access by accident is the
  // caller's responsibility; we allow it but it only takes effect on next auth.
  const ok = revokePassword(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found or already revoked" });
  res.json({ ok: true });
});

export default router;
