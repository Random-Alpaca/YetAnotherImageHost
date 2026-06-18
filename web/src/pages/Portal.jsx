import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

export default function Portal() {
  const auth = useAuth();

  // --- Images & loading ---
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // --- Folder state ---
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null); // null = root
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // --- Upload state ---
  const [visibility, setVisibility] = useState("private");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [results, setResults] = useState([]);
  const [copied, setCopied] = useState("");
  const fileRef = useRef(null);

  // --- Per-image visibility toggle state ---
  // { [imgId]: { loading, newUrl } }
  const [visibilityOps, setVisibilityOps] = useState({});

  // --- Multi-select state ---
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  // --- Helpers ---
  const absUrl = (u) => (u && u.startsWith("http") ? u : window.location.origin + u);

  async function refreshFolders() {
    try {
      const { folders } = await api.listFolders();
      setFolders(folders || []);
    } catch {
      /* non-fatal — folders may not be implemented yet */
    }
  }

  async function refresh(folder) {
    setLoading(true);
    try {
      // Root shows only unfiled photos ("none"); inside a folder, that folder's photos.
      const { images } = await api.listImages(folder === null ? "none" : folder);
      setImages(images || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshFolders();
    refresh(null);
  }, []);

  // Navigate into a folder (or root). Re-fetch that folder's photos.
  function selectFolder(folder) {
    setCurrentFolder(folder);
    setSelected(new Set());
    setShowNewFolder(false);
    setNewFolderName("");
    refresh(folder);
  }

  // --- Derived folder helpers ---
  const childFolders = folders.filter((f) => (f.parent_id || null) === currentFolder);

  // Breadcrumb trail from root → currentFolder.
  function breadcrumbTrail() {
    const trail = [];
    let id = currentFolder;
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    while (id) {
      const f = byId[id];
      if (!f) break;
      trail.unshift(f);
      id = f.parent_id || null;
    }
    return trail;
  }
  const trail = breadcrumbTrail();

  // Full "A / B / C" path label for a folder id (used in the bulk-move dropdown).
  function folderPath(id) {
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    const parts = [];
    let cur = id;
    while (cur) {
      const f = byId[cur];
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parent_id || null;
    }
    return parts.join(" / ");
  }

  // --- Copy to clipboard ---
  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  // --- Create a folder under the current folder (standalone, no upload) ---
  async function onCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      await api.createFolder(name, currentFolder);
      setNewFolderName("");
      setShowNewFolder(false);
      await refreshFolders();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingFolder(false);
    }
  }

  // --- Delete a folder (reparents contents up one level, server-side) ---
  async function onDeleteFolder(folder) {
    if (!confirm(`Delete folder "${folder.name}"? Its contents move up one level.`)) return;
    try {
      await api.deleteFolder(folder.id);
      await refreshFolders();
      await refresh(currentFolder);
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Upload (always targets the current folder) ---
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const folderOpts = currentFolder ? { folderId: currentFolder } : {};
      const { results } = await api.upload(files, visibility, folderOpts);
      setResults(results);
      if (fileRef.current) fileRef.current.value = "";
      await refreshFolders();
      await refresh(currentFolder);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (!uploading) uploadFiles(e.dataTransfer.files);
  }

  // --- Single delete ---
  async function onDelete(id) {
    if (!confirm("Delete this image permanently?")) return;
    try {
      await api.deleteImage(id);
      setImages((imgs) => imgs.filter((i) => i.id !== id));
      await refreshFolders();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Per-image visibility toggle ---
  async function onToggleVisibility(img) {
    const newVis = img.visibility === "public" ? "private" : "public";
    setVisibilityOps((prev) => ({ ...prev, [img.id]: { loading: true, newUrl: null } }));
    try {
      const { url } = await api.setVisibility(img.id, newVis);
      // Update the image in state and store the new URL for display
      setImages((imgs) =>
        imgs.map((i) =>
          i.id === img.id ? { ...i, visibility: newVis, url } : i
        )
      );
      setVisibilityOps((prev) => ({ ...prev, [img.id]: { loading: false, newUrl: absUrl(url) } }));
    } catch (err) {
      setError(err.message);
      setVisibilityOps((prev) => ({ ...prev, [img.id]: { loading: false, newUrl: null } }));
    }
  }

  // --- Multi-select ---
  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
    setShowBulkMove(false);
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onBulkDelete() {
    if (!confirm(`Delete ${selected.size} image${selected.size === 1 ? "" : "s"} permanently?`)) return;
    setBulkLoading(true);
    try {
      await api.bulkImages("delete", Array.from(selected));
      setSelected(new Set());
      setSelectMode(false);
      await refresh(currentFolder);
      await refreshFolders();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  }

  async function onBulkMove() {
    if (!bulkFolderId) return;
    setBulkLoading(true);
    try {
      await api.bulkImages("move", Array.from(selected), bulkFolderId);
      setSelected(new Set());
      setShowBulkMove(false);
      setBulkFolderId("");
      setSelectMode(false);
      await refresh(currentFolder);
      await refreshFolders();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  }

  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Breadcrumb + new-folder bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <nav className="flex items-center gap-1 text-sm">
          <button
            onClick={() => selectFolder(null)}
            className={`rounded px-2 py-1 transition ${
              currentFolder === null ? "text-zinc-100 font-medium" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Home
          </button>
          {trail.map((f, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={f.id} className="flex items-center gap-1">
                <span className="text-zinc-600">/</span>
                <button
                  onClick={() => selectFolder(f.id)}
                  disabled={last}
                  className={`rounded px-2 py-1 transition ${
                    last ? "text-zinc-100 font-medium" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {f.name}
                </button>
              </span>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {showNewFolder ? (
            <>
              <input
                type="text"
                placeholder="Folder name"
                value={newFolderName}
                autoFocus
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onCreateFolder()}
                className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm w-40 focus:outline-none focus:border-zinc-600"
              />
              <button
                onClick={onCreateFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition"
              >
                {creatingFolder ? "…" : "Create"}
              </button>
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-600 transition"
            >
              + New folder
            </button>
          )}
        </div>
      </div>

      {/* ── Upload controls ── */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Visibility */}
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
        >
          <option value="private">Private (portal only)</option>
          <option value="public">Public (direct link)</option>
        </select>
        <span className="text-xs text-zinc-500">
          New uploads will be <span className="text-zinc-300">{visibility}</span>, into{" "}
          <span className="text-zinc-300">
            {currentFolder === null ? "Home" : folderPath(currentFolder)}
          </span>.
        </span>
      </div>

      {/* ── Drag-and-drop zone ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
        onDrop={onDrop}
        onClick={() => !uploading && fileRef.current?.click()}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition
          ${dragActive ? "border-zinc-300 bg-zinc-800/50" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"}
          ${uploading ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
        />
        <p className="text-sm text-zinc-300">
          {uploading ? "Uploading…" : "Drag & drop images here, or click to choose"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, GIF, WebP, HEIC · multiple files supported</p>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* ── Upload results ── */}
      {results.length > 0 && (
        <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-200">
              Uploaded {okResults.length} image{okResults.length === 1 ? "" : "s"}
            </h2>
            {okResults.length > 1 && (
              <button
                onClick={() => copy(okResults.map((r) => absUrl(r.url)).join("\n"))}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Copy all
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {okResults.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => copy(absUrl(r.url))}
                  title="Copy URL"
                  className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:bg-zinc-700"
                >
                  {copied === absUrl(r.url) ? "Copied" : "Copy"}
                </button>
                <a href={r.url} target="_blank" rel="noreferrer"
                   className="truncate font-mono text-zinc-400 hover:text-zinc-200">
                  {absUrl(r.url)}
                </a>
              </li>
            ))}
          </ul>
          {failResults.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
              {failResults.map((r, i) => (
                <li key={i} className="text-xs text-red-400">
                  {r.name}: {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Gallery header: select-mode toggle ── */}
      {images.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-zinc-500">
            {images.length} image{images.length === 1 ? "" : "s"}
            {currentFolder !== null && (
              <span> in <span className="text-zinc-300">{folderPath(currentFolder)}</span></span>
            )}
          </p>
          <button
            onClick={toggleSelectMode}
            className={`text-xs px-3 py-1 rounded-md transition ${
              selectMode
                ? "bg-zinc-700 text-zinc-200"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
            }`}
          >
            {selectMode ? "Cancel selection" : "Select"}
          </button>
        </div>
      )}

      {/* ── Sticky selection toolbar ── */}
      {selectMode && selected.size > 0 && (
        <div className="sticky top-4 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="text-sm text-zinc-300 font-medium">
            {selected.size} selected
          </span>
          <button
            onClick={onBulkDelete}
            disabled={bulkLoading}
            className="rounded-md bg-red-900/60 px-3 py-1 text-xs text-red-300 hover:bg-red-900 disabled:opacity-50 transition"
          >
            Delete selected
          </button>
          {showBulkMove ? (
            <div className="flex items-center gap-2">
              <select
                value={bulkFolderId}
                onChange={(e) => setBulkFolderId(e.target.value)}
                className="rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs"
              >
                <option value="">Pick a folder…</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{folderPath(f.id)}</option>
                ))}
              </select>
              <button
                onClick={onBulkMove}
                disabled={!bulkFolderId || bulkLoading}
                className="rounded-md bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition"
              >
                Move
              </button>
              <button
                onClick={() => { setShowBulkMove(false); setBulkFolderId(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            folders.length > 0 && (
              <button
                onClick={() => setShowBulkMove(true)}
                disabled={bulkLoading}
                className="rounded-md bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition"
              >
                Move to folder…
              </button>
            )
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Folder + image grid ── */}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : childFolders.length === 0 && images.length === 0 ? (
        <p className="text-zinc-500">
          {currentFolder === null
            ? "No images yet. Upload some above, or create a folder."
            : "This folder is empty."}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {/* Subfolder tiles first */}
          {childFolders.map((f) => (
            <div
              key={f.id}
              onClick={() => selectFolder(f.id)}
              className="group relative flex flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3 h-40 cursor-pointer hover:border-zinc-600 transition"
            >
              <div className="flex items-start justify-between">
                <svg className="w-8 h-8 text-zinc-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" />
                </svg>
                {f.can_modify && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
                    className="text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div>
                <p className="text-sm text-zinc-200 font-medium truncate">{f.name}</p>
                <p className="text-xs text-zinc-500">
                  {f.count} item{f.count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ))}

          {/* Image tiles */}
          {images.map((img) => {
            const visOp = visibilityOps[img.id];
            const isSelected = selected.has(img.id);

            return (
              <figure
                key={img.id}
                className={`group relative rounded-lg overflow-hidden border bg-zinc-900 transition
                  ${isSelected ? "border-zinc-300 ring-2 ring-zinc-300/40" : "border-zinc-800"}`}
              >
                {/* Selection checkbox overlay */}
                {selectMode && img.can_modify && (
                  <button
                    onClick={() => toggleSelect(img.id)}
                    className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition
                      ${isSelected
                        ? "bg-zinc-200 border-zinc-200"
                        : "bg-zinc-900/70 border-zinc-400 hover:border-zinc-200"}`}
                    aria-label={isSelected ? "Deselect" : "Select"}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-zinc-900" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                )}

                <a
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => selectMode && img.can_modify && (e.preventDefault(), toggleSelect(img.id))}
                >
                  <img
                    src={img.url}
                    alt={img.original_name || img.id}
                    loading="lazy"
                    className="w-full h-40 object-cover"
                  />
                </a>

                <figcaption className="flex flex-col gap-1 px-2 py-1.5 text-xs text-zinc-400">
                  {/* Visibility row */}
                  <div className="flex items-center justify-between gap-1">
                    <span className={img.visibility === "public" ? "text-emerald-400" : "text-amber-400"}>
                      {img.visibility}
                    </span>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                      {/* Visibility toggle — only when can_modify */}
                      {img.can_modify && (
                        <button
                          onClick={() => onToggleVisibility(img)}
                          disabled={visOp?.loading}
                          title={img.visibility === "public" ? "Make private" : "Make public"}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition"
                        >
                          {visOp?.loading ? "…" : img.visibility === "public" ? "→ private" : "→ public"}
                        </button>
                      )}
                      {/* Delete — gated on can_modify (owner or admin) */}
                      {img.can_modify && (
                        <button
                          onClick={() => onDelete(img.id)}
                          className="text-red-400 hover:text-red-300 transition"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* New URL after visibility toggle */}
                  {visOp?.newUrl && (
                    <div className="flex items-center gap-1.5 mt-0.5 border-t border-zinc-800 pt-1">
                      <button
                        onClick={() => copy(visOp.newUrl)}
                        className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700 transition"
                      >
                        {copied === visOp.newUrl ? "Copied" : "Copy"}
                      </button>
                      <span className="truncate font-mono text-zinc-500 text-[10px]">{visOp.newUrl}</span>
                    </div>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </main>
  );
}
