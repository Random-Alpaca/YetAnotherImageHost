import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Msg({ msg }) {
  return msg ? <div className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</div> : null;
}

export default function Account() {
  const auth = useAuth();

  // ── Change password ──
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpBusy, setCpBusy] = useState(false);
  const [cpMsg, setCpMsg] = useState(null); // { ok, text }

  async function submitChangePassword(e) {
    e.preventDefault();
    setCpMsg(null);
    setCpBusy(true);
    try {
      await api.changePassword(cpCurrent, cpNew);
      setCpMsg({ ok: true, text: "Password updated." });
      setCpCurrent("");
      setCpNew("");
    } catch (err) {
      setCpMsg({ ok: false, text: err.message });
    } finally {
      setCpBusy(false);
    }
  }

  // ── Create account ──
  const [caUsername, setCaUsername] = useState("");
  const [caPassword, setCaPassword] = useState("");
  const [caRole, setCaRole] = useState("user");
  const [caBusy, setCaBusy] = useState(false);
  const [caMsg, setCaMsg] = useState(null);

  async function submitCreateAccount(e) {
    e.preventDefault();
    setCaMsg(null);
    setCaBusy(true);
    try {
      const created = await api.createUser(caUsername.trim(), caPassword, caRole);
      setCaMsg({ ok: true, text: `Account "${created.username}" (${created.role}) created.` });
      setCaUsername("");
      setCaPassword("");
      setCaRole("user");
    } catch (err) {
      setCaMsg({ ok: false, text: err.message });
    } finally {
      setCaBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading"><div><h1>Account</h1></div></div>

      <section className="settings-panel">
        <h2>Your account</h2>
        <div className="settings-row"><span>Username</span><strong>{auth.username}</strong></div>
        <div className="settings-row"><span>Role</span><strong>{auth.isAdmin ? "Admin" : "User"}</strong></div>
      </section>

      <section className="settings-panel">
        <h2>Change password</h2>
        <form onSubmit={submitChangePassword} className="narrow-form">
          <Field label="Current password">
            <input type="password" value={cpCurrent} onChange={(e) => setCpCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password">
            <input type="password" value={cpNew} onChange={(e) => setCpNew(e.target.value)} autoComplete="new-password" />
          </Field>
          <Msg msg={cpMsg} />
          <button type="submit" className="btn btn-primary" disabled={cpBusy || !cpCurrent || !cpNew}>
            {cpBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="settings-panel">
        <h2>Create account</h2>
        <p>
          Anyone already logged in can create new accounts.
          {!auth.isAdmin && " New accounts are created as regular users."}
        </p>
        <form onSubmit={submitCreateAccount} className="narrow-form">
          <Field label="Username">
            <input type="text" value={caUsername} onChange={(e) => setCaUsername(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Password">
            <input type="password" value={caPassword} onChange={(e) => setCaPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Role">
            <select value={caRole} onChange={(e) => setCaRole(e.target.value)} disabled={!auth.isAdmin}>
              <option value="user">User</option>
              {auth.isAdmin && <option value="admin">Admin</option>}
            </select>
          </Field>
          <Msg msg={caMsg} />
          <button type="submit" className="btn btn-primary" disabled={caBusy || !caUsername.trim() || !caPassword}>
            {caBusy ? "Creating…" : "Create account"}
          </button>
        </form>
      </section>
    </>
  );
}
