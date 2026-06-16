import { useEffect, useState } from "react";
import { api } from "../api.js";

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : "—";
}

export default function Admin() {
  const [passwords, setPasswords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [label, setLabel] = useState("");
  const [role, setRole] = useState("user");
  const [issued, setIssued] = useState(null); // {password,...} shown once

  async function refresh() {
    try {
      const { passwords } = await api.listPasswords();
      setPasswords(passwords);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function onIssue(e) {
    e.preventDefault();
    setError("");
    try {
      const created = await api.issuePassword(label.trim() || null, role);
      setIssued(created);
      setLabel("");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onRevoke(id) {
    if (!confirm("Revoke this password? Anyone using it is logged out immediately.")) return;
    try {
      await api.revokePassword(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold mb-4">Access passwords</h1>

      {/* Issue */}
      <form onSubmit={onIssue} className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">
          <span className="block text-zinc-500 mb-1">Label (optional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="e.g. design team"
                 className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="block text-zinc-500 mb-1">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}
                  className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit"
                className="rounded-md bg-zinc-100 text-zinc-900 font-medium px-4 py-1.5 text-sm">
          Issue password
        </button>
      </form>

      {/* One-time reveal */}
      {issued && (
        <div className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3">
          <p className="text-sm text-emerald-300 mb-1">
            New {issued.role} password — copy it now, it won't be shown again:
          </p>
          <code className="block break-all select-all font-mono text-emerald-100">{issued.password}</code>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* List */}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-left">
            <tr className="border-b border-zinc-800">
              <th className="py-2 font-medium">Label</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {passwords.map((p) => (
              <tr key={p.id} className="border-b border-zinc-900">
                <td className="py-2">{p.label || <span className="text-zinc-600">—</span>}</td>
                <td className="py-2">{p.role}</td>
                <td className="py-2 text-zinc-400">{fmtDate(p.created_at)}</td>
                <td className="py-2 text-zinc-400">{fmtDate(p.last_used_at)}</td>
                <td className="py-2">
                  {p.revoked_at
                    ? <span className="text-zinc-600">revoked</span>
                    : <span className="text-emerald-400">active</span>}
                </td>
                <td className="py-2 text-right">
                  {!p.revoked_at && (
                    <button onClick={() => onRevoke(p.id)}
                            className="text-red-400 hover:text-red-300">Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
