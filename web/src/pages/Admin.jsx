import { useEffect, useState } from "react";
import { api } from "../api.js";

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : "—";
}

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const { users } = await api.listUsers();
      setUsers(users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function onRevoke(id, username) {
    if (!confirm(`Revoke access for "${username}"? They will be logged out immediately.`)) return;
    try {
      await api.revokeUser(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold mb-4">User management</h1>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-zinc-500">No users found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-left">
            <tr className="border-b border-zinc-800">
              <th className="py-2 font-medium">Username</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-900">
                <td className="py-2 font-mono">{u.username || <span className="text-zinc-600">—</span>}</td>
                <td className="py-2">{u.role}</td>
                <td className="py-2 text-zinc-400">{fmtDate(u.created_at)}</td>
                <td className="py-2 text-zinc-400">{fmtDate(u.last_used_at)}</td>
                <td className="py-2">
                  {u.revoked_at
                    ? <span className="text-zinc-600">revoked</span>
                    : <span className="text-emerald-400">active</span>}
                </td>
                <td className="py-2 text-right">
                  {!u.revoked_at && (
                    <button
                      onClick={() => onRevoke(u.id, u.username)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
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
