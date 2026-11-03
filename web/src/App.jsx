import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import Icon from "./Icon.jsx";
import { Footer } from "./Chrome.jsx";
import Login from "./pages/Login.jsx";
import Portal, { Shared } from "./pages/Portal.jsx";
import Admin from "./pages/Admin.jsx";
import Account from "./pages/Account.jsx";
import Signup from "./pages/Signup.jsx";
import Album from "./pages/Album.jsx";

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
    async logout() {
      await api.logout().catch(() => {});
      setRole(null);
      setUsername(null);
    },
  };
}

// --- Shell state shared by the sidebar and the pages ------------------------
const ShellCtx = createContext(null);
export const useShell = () => useContext(ShellCtx);

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
  return <div className="splash">Loading…</div>;
}

// Folders depth-first (children under their parent) with a nesting level.
function folderTree(folders) {
  const byParent = {};
  for (const f of folders) (byParent[f.parent_id || ""] ||= []).push(f);
  const out = [];
  const walk = (parent, depth) => {
    for (const f of byParent[parent] || []) { out.push({ ...f, depth }); walk(f.id, depth + 1); }
  };
  walk("", 0);
  // Folders whose parent is hidden from this user still deserve a sidebar entry.
  const seen = new Set(out.map((f) => f.id));
  for (const f of folders) if (!seen.has(f.id)) out.push({ ...f, depth: 0 });
  return out;
}

const TITLES = { "/": "Library", "/photos": "All photos", "/shared": "Shared albums", "/account": "Account", "/admin": "Administration" };

// Light/dark theme: <html data-theme>, persisted in localStorage (index.html sets it pre-paint).
function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  return [theme, () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
    setTheme(next);
  }];
}

function Shell() {
  const auth = useAuth();
  // Remount on user change so cached private data never crosses accounts.
  return <ShellContent key={`${auth.username}:${auth.role}`} />;
}

function ShellContent() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [folders, setFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const request = useRef(null);
  const mounted = useRef(true);
  const toastTimer = useRef(null);
  const searchRef = useRef(null);
  const [theme, toggleTheme] = useTheme();

  async function refreshFolders() {
    if (!mounted.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const { folders } = await api.listFolders({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) setFolders(folders || []);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) {
        if (err.status === 401) { setFolders([]); auth.setAuth(null, null); }
        else toast(err.message);
      }
    } finally {
      if (mounted.current && !controller.signal.aborted) setFoldersLoading(false);
    }
  }

  function toast(msg) {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(""), 4200);
  }

  useEffect(() => {
    mounted.current = true;
    refreshFolders();
    return () => { mounted.current = false; request.current?.abort(); clearTimeout(toastTimer.current); };
  }, []);

  // Leaving a page clears the search and closes the mobile menu.
  useEffect(() => { setMenuOpen(false); setQuery(""); window.scrollTo({ top: 0 }); }, [loc.pathname]);

  // "/" focuses search, like the design; Esc closes the mobile menu.
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
      if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const current = loc.pathname.startsWith("/f/") ? folders.find((f) => loc.pathname === `/f/${f.id}`)?.name : null;
  const searchable = !["/account", "/admin"].includes(loc.pathname);

  return (
    <ShellCtx.Provider value={{ folders, foldersLoading, setFolders, refreshFolders, query, toast }}>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <nav>
          <NavLink to="/" end><Icon name="library" />Library</NavLink>
          <NavLink to="/photos"><Icon name="image" />All photos</NavLink>
          <NavLink to="/shared"><Icon name="link" />Shared albums</NavLink>
        </nav>
        <div className="nav-label collections-label">Folders</div>
        <div className="folder-nav">
          {folderTree(folders).map((f) => (
            <NavLink key={f.id} to={`/f/${f.id}`} style={{ paddingLeft: 12 + f.depth * 14 }}>
              <Icon name="folder" /><span>{f.name}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="theme-toggle" onClick={toggleTheme}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />{theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <NavLink to="/account" className="footer-nav"><Icon name="settings" />Account</NavLink>
          {auth.isAdmin && <NavLink to="/admin" className="footer-nav"><Icon name="users" />Administration</NavLink>}
          <button className="footer-nav" onClick={auth.logout}><Icon name="left" />Sign out</button>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation"><Icon name="menu" /></button>
          <div className="breadcrumb"><strong>{current || TITLES[loc.pathname] || "Library"}</strong></div>
          {searchable && (
            <label className="search">
              <Icon name="search" />
              <input ref={searchRef} aria-label="Search photos and folders" placeholder="Search" value={query}
                     onChange={(e) => setQuery(e.target.value)} />
              <kbd>/</kbd>
            </label>
          )}
          <button className="profile" onClick={() => nav("/account")} aria-label="Account">{auth.username || "Account"}</button>
        </header>
        <main><Outlet /></main>
        <Footer />
      </div>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </ShellCtx.Provider>
  );
}

export default function App() {
  const auth = useProvideAuth();
  return (
    <AuthCtx.Provider value={auth}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        {/* Public: the only route a logged-out visitor can reach besides login. */}
        <Route path="/a/:slug" element={<Album />} />
        <Route element={<Protected><Shell /></Protected>}>
          <Route path="/" element={<Portal />} />
          <Route path="/photos" element={<Portal />} />
          <Route path="/f/:folderId" element={<Portal />} />
          <Route path="/shared" element={<Shared />} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
