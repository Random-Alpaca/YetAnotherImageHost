import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString() : "—";
}

export default function Admin() {
  const auth = useAuth();
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const [{ users }, { requests }] = await Promise.all([
        api.listUsers(),
        api.listSignupRequests(),
      ]);
      setUsers(users);
      setRequests(requests);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onReview(id, approve) {
    try {
      await (approve ? api.approveSignupRequest(id) : api.rejectSignupRequest(id));
      await refresh();
    } catch (err) {
      setError(err.message);
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

  async function onDelete(id, username) {
    if (!confirm(`Permanently delete "${username}"? This cannot be undone — their images and folders stay, but become unowned.`)) return;
    try {
      await api.deleteUser(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold mb-4">User management</h1>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {requests.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-900/60 bg-amber-950/20 p-4">
          <h2 className="text-sm font-medium text-amber-200 mb-3">
            {requests.length} pending account request{requests.length === 1 ? "" : "s"}
          </h2>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-zinc-200">{r.username}</span>
                <span className="text-xs text-zinc-500">{fmtDate(r.created_at)}</span>
                <button
                  onClick={() => onReview(r.id, true)}
                  className="ml-auto text-emerald-400 hover:text-emerald-300"
                >
                  Approve
                </button>
                <button
                  onClick={() => onReview(r.id, false)}
                  className="text-zinc-500 hover:text-red-400"
                >
                  Reject
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <td className="py-2 text-right space-x-3">
                  {!u.revoked_at && (
                    <button
                      onClick={() => onRevoke(u.id, u.username)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
                  )}
                  {u.username !== auth.username && (
                    <button
                      onClick={() => onDelete(u.id, u.username)}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      Delete
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
