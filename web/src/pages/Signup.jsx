import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Bare } from "../Chrome.jsx";

export default function Signup() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.signup(username, password);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Bare>
      <div className="login-panel">
        <h1>Request an account</h1>
        {sent ? (
          <>
            {/* The server answers identically whether or not the name was free,
                so this copy must not promise the request actually exists. */}
            <p>Request submitted. An admin will review it — you'll be able to sign in once it's approved.</p>
            <Link to="/login" className="text-link">← Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>Pick a username and password. An admin approves the request before you can sign in.</p>
            <label className="field">
              <span>Username</span>
              <input type="text" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder="8+ characters" autoComplete="new-password" />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="login-options">
              <button type="submit" className="btn btn-primary" disabled={busy || !username || password.length < 8}>
                {busy ? "Sending…" : "Request account"}
              </button>
            </div>
            <Link to="/login" className="text-link">Already have an account? Sign in</Link>
          </form>
        )}
      </div>
    </Bare>
  );
}
