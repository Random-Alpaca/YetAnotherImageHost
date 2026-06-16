import { createContext, useContext, useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { api } from "./api.js";
import Login from "./pages/Login.jsx";
import Portal from "./pages/Portal.jsx";
import Admin from "./pages/Admin.jsx";
import Account from "./pages/Account.jsx";

// --- Auth context ---------------------------------------------------------
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function useProvideAuth() {
  const [role, setRole] = useState(undefined); // undefined = loading, null = logged out
  const [username, setUsername] = useState(null);

  useEffect(() => {
    api.me()
      .then((d) => { setRole(d.role); setUsername(d.username); })
      .catch(() => { setRole(null); setUsername(null); });
  }, []);

  return {
    role,
    username,
    isAuthed: !!role,
    isAdmin: role === "admin",
    // Call after login — server returns both role and username
    setAuth(newRole, newUsername) {
      setRole(newRole);
      setUsername(newUsername);
    },
    // Kept for backward-compat (Portal may only need setRole)
    setRole,
    async logout() {
      await api.logout().catch(() => {});
      setRole(null);
      setUsername(null);
    },
  };
}

// --- Route guards ---------------------------------------------------------
function Protected({ children, adminOnly }) {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.role === undefined) return <Splash />;
  if (!auth.isAuthed) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (adminOnly && !auth.isAdmin) return <Navigate to="/" replace />;
  return children;
}

function Splash() {
  return <div className="min-h-screen grid place-items-center text-zinc-500">Loading…</div>;
}

function Nav() {
  const auth = useAuth();
  if (!auth.isAuthed) return null;
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link to="/" className="font-semibold tracking-tight">Image Hoster</Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-400">
          <Link to="/" className="hover:text-zinc-100">Portal</Link>
          <Link to="/account" className="hover:text-zinc-100">Account</Link>
          {auth.isAdmin && <Link to="/admin" className="hover:text-zinc-100">Admin</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-zinc-400">
          {auth.username && (
            <span className="text-zinc-500">{auth.username}</span>
          )}
          <button
            onClick={auth.logout}
            className="hover:text-zinc-100"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const auth = useProvideAuth();
  return (
    <AuthCtx.Provider value={auth}>
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Portal /></Protected>} />
        <Route path="/account" element={<Protected><Account /></Protected>} />
        <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
