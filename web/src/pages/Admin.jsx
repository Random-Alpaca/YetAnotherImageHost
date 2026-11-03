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
    <>
      <div className="page-heading"><div><h1>Administration</h1><p>User management</p></div></div>

      {error && <div className="form-error">{error}</div>}

      {requests.length > 0 && (
        <section className="settings-panel">
          <h2>{requests.length} pending account request{requests.length === 1 ? "" : "s"}</h2>
          <table>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.username}</strong></td>
                  <td className="dim">{fmtDate(r.created_at)}</td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => onReview(r.id, true)}>Approve</button>
                    <button className="btn btn-ghost" onClick={() => onReview(r.id, false)}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="settings-panel">
        <h2>Accounts</h2>
        {loading ? (
          <p>Loading…</p>
        ) : users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Username</th><th>Role</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.username || "—"}</strong></td>
                    <td>{u.role}</td>
                    <td className="dim">{fmtDate(u.created_at)}</td>
                    <td className="dim">{fmtDate(u.last_used_at)}</td>
                    <td><span className="status">{u.revoked_at ? "Revoked" : "Active"}</span></td>
                    <td className="row-actions">
                      {!u.revoked_at && (
                        <button className="btn" onClick={() => onRevoke(u.id, u.username)}>Revoke</button>
                      )}
                      {u.username !== auth.username && (
                        <button className="btn btn-danger" onClick={() => onDelete(u.id, u.username)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
