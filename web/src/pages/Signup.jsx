import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

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
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Request an account</h1>
        {sent ? (
          <>
            {/* The server answers identically whether or not the name was free,
                so this copy must not promise the request actually exists. */}
            <p className="text-sm text-zinc-400 mt-4">
              Request submitted. An admin will review it — you'll be able to sign
              in once it's approved.
            </p>
            <Link to="/login" className="mt-6 inline-block text-sm text-zinc-400 hover:text-zinc-100">
              ← Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="text-sm text-zinc-500 mb-6">
              Pick a username and password. An admin approves the request before
              you can sign in.
            </p>
            <input
              type="text"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600 mb-3"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              autoComplete="new-password"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
            />
            {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username || password.length < 8}
              className="mt-4 w-full rounded-lg bg-zinc-100 text-zinc-900 font-medium py-2 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Request account"}
            </button>
            <Link to="/login" className="mt-4 block text-center text-sm text-zinc-500 hover:text-zinc-300">
              Already have an account? Sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
