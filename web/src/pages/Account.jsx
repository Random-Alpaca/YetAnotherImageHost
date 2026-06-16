import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

function SectionHeading({ children }) {
  return <h2 className="text-base font-semibold mb-4 mt-8 first:mt-0">{children}</h2>;
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="block text-zinc-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600 text-sm";

export default function Account() {
  const auth = useAuth();

  // ── Change password ──────────────────────────────────────────────────────
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

  // ── Create account ───────────────────────────────────────────────────────
  const [caUsername, setCaUsername] = useState("");
  const [caPassword, setCaPassword] = useState("");
  const [caRole, setCaRole] = useState("user");
  const [caBusy, setCaBusy] = useState(false);
  const [caMsg, setCaMsg] = useState(null); // { ok, text }

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
    <main className="max-w-lg mx-auto px-4 py-8">
      {/* ── Change password ── */}
      <SectionHeading>Change password</SectionHeading>
      <form onSubmit={submitChangePassword} className="flex flex-col gap-3">
        <Field label="Current password">
          <input
            type="password"
            value={cpCurrent}
            onChange={(e) => setCpCurrent(e.target.value)}
            autoComplete="current-password"
            placeholder="Current password"
            className={inputCls}
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            value={cpNew}
            onChange={(e) => setCpNew(e.target.value)}
            autoComplete="new-password"
            placeholder="New password"
            className={inputCls}
          />
        </Field>
        {cpMsg && (
          <p className={`text-sm ${cpMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {cpMsg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={cpBusy || !cpCurrent || !cpNew}
          className="rounded-lg bg-zinc-100 text-zinc-900 font-medium py-2 text-sm disabled:opacity-50"
        >
          {cpBusy ? "Updating…" : "Update password"}
        </button>
      </form>

      {/* ── Create account ── */}
      <SectionHeading>Create account</SectionHeading>
      <p className="text-sm text-zinc-500 mb-4">
        Anyone already logged in can create new accounts.
        {!auth.isAdmin && " New accounts are created as regular users."}
      </p>
      <form onSubmit={submitCreateAccount} className="flex flex-col gap-3">
        <Field label="Username">
          <input
            type="text"
            value={caUsername}
            onChange={(e) => setCaUsername(e.target.value)}
            autoComplete="off"
            placeholder="Username"
            className={inputCls}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={caPassword}
            onChange={(e) => setCaPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Password"
            className={inputCls}
          />
        </Field>
        <Field label="Role">
          <select
            value={caRole}
            onChange={(e) => setCaRole(e.target.value)}
            disabled={!auth.isAdmin}
            className={`${inputCls} disabled:opacity-50`}
          >
            <option value="user">User</option>
            {auth.isAdmin && <option value="admin">Admin</option>}
          </select>
        </Field>
        {caMsg && (
          <p className={`text-sm ${caMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {caMsg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={caBusy || !caUsername.trim() || !caPassword}
          className="rounded-lg bg-zinc-100 text-zinc-900 font-medium py-2 text-sm disabled:opacity-50"
        >
          {caBusy ? "Creating…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
