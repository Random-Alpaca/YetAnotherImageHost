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
  const [activeFolder, setActiveFolder] = useState(undefined); // undefined = All
  const [uploadFolderId, setUploadFolderId] = useState(""); // "" = no folder
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

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
      const { images } = await api.listImages(folder);
      setImages(images || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshFolders();
    refresh(undefined);
  }, []);

  // When activeFolder changes, re-fetch images for that folder
  function selectFolder(folder) {
    setActiveFolder(folder);
    setSelected(new Set());
    refresh(folder);
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

  // --- Upload ---
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      let folderOpts = {};
      if (showNewFolder && newFolderName.trim()) {
        folderOpts = { folderName: newFolderName.trim() };
      } else if (uploadFolderId) {
        folderOpts = { folderId: uploadFolderId };
      }
      const { results } = await api.upload(files, visibility, folderOpts);
      setResults(results);
      if (fileRef.current) fileRef.current.value = "";
      // If a new folder was created, refresh folder list
      if (showNewFolder && newFolderName.trim()) {
        setNewFolderName("");
        setShowNewFolder(false);
        await refreshFolders();
      }
      await refresh(activeFolder);
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
      await refresh(activeFolder);
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
      await refresh(activeFolder);
      await refreshFolders();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  }

  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);

  // Folder label helpers
  const folderLabel = (id) => {
    if (id === undefined) return "All";
    if (id === "none") return "Unfiled";
    return folders.find((f) => f.id === id)?.name || id;
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Folder bar ── */}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {/* All */}
          <button
            onClick={() => selectFolder(undefined)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition
              ${activeFolder === undefined
                ? "bg-zinc-200 text-zinc-900"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
          >
            All
          </button>
          {/* Unfiled */}
          <button
            onClick={() => selectFolder("none")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition
              ${activeFolder === "none"
                ? "bg-zinc-200 text-zinc-900"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
          >
            Unfiled
          </button>
          {/* Per-folder chips */}
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => selectFolder(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition
                ${activeFolder === f.id
                  ? "bg-zinc-200 text-zinc-900"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              {f.name}
              {f.count != null && (
                <span className="ml-1.5 opacity-60">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

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
          New uploads will be <span className="text-zinc-300">{visibility}</span>.
        </span>

        {/* Folder picker for upload */}
        <div className="flex items-center gap-2 ml-auto">
          {showNewFolder ? (
            <>
              <input
                type="text"
                placeholder="New folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm w-36 focus:outline-none focus:border-zinc-600"
              />
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <select
                value={uploadFolderId}
                onChange={(e) => setUploadFolderId(e.target.value)}
                className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowNewFolder(true)}
                className="text-xs text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
              >
                + New folder
              </button>
            </>
          )}
        </div>
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
        {(showNewFolder ? newFolderName.trim() : uploadFolderId) && (
          <p className="mt-1 text-xs text-zinc-400">
            Uploading to: <span className="text-zinc-200">
              {showNewFolder ? `"${newFolderName}" (new folder)` : folderLabel(uploadFolderId)}
            </span>
          </p>
        )}
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
            {activeFolder !== undefined && (
              <span> in <span className="text-zinc-300">{folderLabel(activeFolder)}</span></span>
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
                  <option key={f.id} value={f.id}>{f.name}</option>
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

      {/* ── Gallery grid ── */}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-zinc-500">No images yet. Upload some above.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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
