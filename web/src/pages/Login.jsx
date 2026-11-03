import { useState } from "react";
import { useNavigate, useLocation, Navigate, Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";
import { Bare } from "../Chrome.jsx";

export default function Login() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
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
      const { role, username: uname } = await api.login(username, password);
      auth.setAuth(role, uname);
      nav(loc.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Bare>
      <form onSubmit={submit} className="login-panel">
        <h1>Sign in</h1>
        <p>Sign in with your username and password.</p>
        <label className="field">
          <span>Username</span>
          <input type="text" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="login-options">
          <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <Link to="/signup" className="text-link">Need an account? Request one</Link>
      </form>
    </Bare>
  );
}
