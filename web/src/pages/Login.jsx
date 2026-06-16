import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

export default function Login() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already logged in? Bounce to where they were headed (or the portal).
  if (auth.isAuthed) return <Navigate to={loc.state?.from || "/"} replace />;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { role } = await api.login(password);
      auth.setRole(role);
      nav(loc.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Image Hoster</h1>
        <p className="text-sm text-zinc-500 mb-6">Enter your access password.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
        />
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-zinc-100 text-zinc-900 font-medium py-2 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
