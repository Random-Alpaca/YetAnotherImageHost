import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth, useShell } from "../App.jsx";
import Icon from "../Icon.jsx";
import { Modal } from "../Chrome.jsx";
import UploadProgress from "../UploadProgress.jsx";
import ShareDialog from "../ShareDialog.jsx";
import { LoadMore, PhotoCard, Viewer, absUrl, copyText } from "../Photos.jsx";
import usePagedGallery from "../usePagedGallery.js";

// "none" = unfiled (library root), "all" = every image the user may see.
const fetchImages = (key, options) => api.listImages(key === "all" ? undefined : key, options);

const ACCESS_LABEL = { everyone: "everyone signed in", admins: "admins only", shared: "specific people" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function FolderCard({ folder, onOpen, onDelete }) {
  return (
    <article className="folder-card">
      <button className="folder-cover" onClick={onOpen} aria-label={`Open ${folder.name}`}>
        <span className="skeleton-cover"><Icon name="folder" /></span>
      </button>
      <div className="folder-info">
        <div>
          <h3>{folder.name}</h3>
          <p>{plural(folder.count, "photo")}<span>·</span>{folder.is_public ? "Public album" : ACCESS_LABEL[folder.access] || "Not shared"}</p>
        </div>
        {folder.can_modify && (
          <button className="icon-button" onClick={onDelete} aria-label={`Delete ${folder.name}`}><Icon name="trash" /></button>
        )}
      </div>
    </article>
  );
}

function Empty({ title, children }) {
  return <div className="empty"><Icon name="image" /><h2>{title}</h2><p>{children}</p></div>;
}

// Folders published as public albums.
export function Shared() {
  const { folders, foldersLoading, query } = useShell();
  const nav = useNavigate();
  const q = query.toLowerCase();
  const albums = folders.filter((f) => f.is_public && f.name.toLowerCase().includes(q));
  return (
    <>
      <div className="page-heading"><div><h1>Shared albums</h1><p>Albums available to anyone with a link</p></div></div>
      {foldersLoading ? <p className="dim">Loading…</p> : albums.length === 0 ? (
        <Empty title="No shared albums">Open a folder and choose Share to publish it as an album.</Empty>
      ) : (
        <div className="folders-grid">
          {albums.map((f) => <FolderCard key={f.id} folder={f} onOpen={() => nav(`/f/${f.id}`)} />)}
        </div>
      )}
    </>
  );
}

export default function Portal() {
  const { folderId } = useParams();
  const { pathname } = useLocation();
  return <Library galleryKey={folderId ?? (pathname === "/photos" ? "all" : "none")} />;
}

function Library({ galleryKey }) {
  const { setAuth } = useAuth();
  const nav = useNavigate();
  const { folders, foldersLoading, setFolders, refreshFolders, query, toast } = useShell();
  const gallery = usePagedGallery(galleryKey, fetchImages);
  const { images, loading, total } = gallery;

  const mode = galleryKey === "none" ? "home" : galleryKey === "all" ? "photos" : "folder";
  const folder = mode === "folder" ? folders.find((f) => f.id === galleryKey) || null : null;
  const currentFolderId = mode === "folder" ? galleryKey : null; // upload / new-folder target

  const [error, setError] = useState("");
  const [view, setView] = useState("grid");
  const [dialog, setDialog] = useState(null); // "new-folder" | "share" | "move"
  const [viewerIndex, setViewerIndex] = useState(null);

  // Upload
  const [visibility, setVisibility] = useState("private");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [results, setResults] = useState([]);
  const fileRef = useRef(null);

  // Selection
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Per-page UI resets when the route changes (the gallery cache survives).
  useEffect(() => {
    setSelected(new Set());
    setSelectMode(false);
    setDialog(null);
    setViewerIndex(null);
    setResults([]);
    setError("");
  }, [galleryKey]);

  // Keep only selectable images that are still on screen.
  useEffect(() => {
    const available = new Set(images.filter((i) => i.can_modify).map((i) => i.id));
    setSelected((prev) => new Set([...prev].filter((id) => available.has(id))));
  }, [images]);

  useEffect(() => {
    if (gallery.errorStatus === 401) { setFolders([]); setAuth(null, null); }
  }, [gallery.errorStatus, setAuth, setFolders]);

  const q = query.toLowerCase();
  const childFolders = mode === "photos" ? [] : folders.filter(
    (f) => (f.parent_id || null) === currentFolderId && f.name.toLowerCase().includes(q));
  const shown = q ? images.filter((i) => (i.original_name || "").toLowerCase().includes(q)) : images;

  function folderPath(id) {
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    const parts = [];
    for (let cur = id; cur && byId[cur]; cur = byId[cur].parent_id) parts.unshift(byId[cur].name);
    return parts.join(" / ");
  }

  const refreshAll = () => Promise.all([refreshFolders(), gallery.refresh({ invalidate: true })]);

  async function onDeleteFolder(f) {
    if (!confirm(`Delete folder "${f.name}"? Its contents move up one level.`)) return;
    try {
      await api.deleteFolder(f.id);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length, loaded: 0, bytes: 1 });
    setError("");
    try {
      const { results } = await api.upload(files, visibility, {
        ...(currentFolderId ? { folderId: currentFolderId } : {}),
        onProgress: setProgress,
      });
      setResults(results);
      if (fileRef.current) fileRef.current.value = "";
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function onCopy(url) {
    toast((await copyText(url)) ? "Link copied" : "Clipboard is unavailable");
  }

  // --- Single-image actions (viewer) ---
  async function onToggleVisibility(img) {
    try {
      const updated = await api.setVisibility(img.id, img.visibility === "public" ? "private" : "public");
      gallery.update((imgs) => imgs.map((i) => (i.id === img.id ? { ...i, ...updated, thumbnails: updated.thumbnails || [] } : i)));
      toast(`File is now ${updated.visibility}. Its direct link changed.`);
      await gallery.refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDelete(id) {
    if (!confirm("Delete this image permanently?")) return;
    try {
      await api.deleteImage(id);
      setViewerIndex(null);
      gallery.update((imgs) => imgs.filter((i) => i.id !== id), -1);
      await Promise.all([refreshFolders(), gallery.refresh()]);
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Selection / bulk ---
  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => { setSelected(new Set()); setSelectMode(false); };

  async function bulk(action, folderId) {
    setBulkBusy(true);
    try {
      const { results } = await api.bulkImages(action, Array.from(selected), folderId);
      const failed = results.filter((r) => !r.ok);
      clearSelection();
      setDialog(null);
      if (failed.length) setError(`${plural(failed.length, "image")} could not be changed: ${failed[0].error}`);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  function onBulkDelete() {
    if (confirm(`Delete ${plural(selected.size, "image")} permanently?`)) bulk("delete");
  }

  const title = mode === "home" ? "Library" : mode === "photos" ? "All photos" : folder?.name || "Folder";
  const sub = mode === "photos" ? plural(total, "image") : mode === "folder" && folder ? plural(folder.count, "photo") : "";
  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);
  const missing = mode === "folder" && !foldersLoading && !folder;
  const parent = folder?.parent_id ? folders.find((f) => f.id === folder.parent_id) : null;
  const destination = mode === "folder" ? folderPath(galleryKey) : "Library";

  if (missing) {
    return <Empty title="Folder not found">It may have been deleted, or you don't have access. <Link to="/">Back to library</Link></Empty>;
  }

  return (
    <div className={`${view === "list" ? "list-view" : ""} ${selectMode ? "selecting" : ""}`}>
      {mode === "folder" && (
        <Link className="back-link" to={parent ? `/f/${parent.id}` : "/"}><Icon name="left" />{parent ? parent.name : "Back to library"}</Link>
      )}

      <div className="page-heading">
        <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
        <div className="actions">
          {folder?.can_modify && <button className="btn" onClick={() => setDialog("rename")}>Rename</button>}
          {folder?.can_modify && <button className="btn" onClick={() => setDialog("share")}><Icon name="link" />Share</button>}
          <button className="btn" onClick={() => setDialog("new-folder")}><Icon name="plus" />{mode === "folder" ? "New subfolder" : "New folder"}</button>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Icon name="upload" />Upload images</button>
        </div>
      </div>

      {folder && (
        <div className="folder-summary">
          <Icon name={folder.is_public ? "globe" : "lock"} />
          <span>Album: {folder.is_public ? "anyone with the link" : "not shared publicly"} &nbsp;·&nbsp; Portal: {ACCESS_LABEL[folder.access] || folder.access}</span>
          {folder.can_modify && <button onClick={() => setDialog("share")}>Manage access</button>}
        </div>
      )}

      <div className="toolbar">
        <div className="tabs">
          {mode === "folder" ? <button className="active">Photos <em>{total}</em></button> : (
            <>
              <Link to="/" className={`tab ${mode === "home" ? "active" : ""}`}>Library</Link>
              <Link to="/photos" className={`tab ${mode === "photos" ? "active" : ""}`}>All photos <em>{mode === "photos" ? total : ""}</em></Link>
            </>
          )}
          {images.length > 0 && (
            <button onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}>{selectMode ? "Cancel selection" : "Select photos"}</button>
          )}
        </div>
        <div className="toolbar-end">
          <div className="view-switch">
            <button aria-label="Grid view" title="Grid view" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Icon name="library" /></button>
            <button aria-label="List view" title="List view" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><Icon name="list" /></button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="form-error">{error}</p>}
      {gallery.error && (
        <p role="alert" className="form-error">
          {gallery.error} <button className="link-button" onClick={() => gallery.refresh()}>Retry loading photos</button>
        </p>
      )}
      <UploadProgress progress={progress} />

      {results.length > 0 && (
        <section className="results">
          <div className="section-line">
            <h2>Uploaded {plural(okResults.length, "image")}</h2>
            {okResults.length > 1 && <button onClick={() => onCopy(okResults.map((r) => absUrl(r.url)).join("\n"))}>Copy all links</button>}
          </div>
          {okResults.map((r) => (
            <div key={r.id} className="file-row">
              <button className="btn" onClick={() => onCopy(absUrl(r.url))}><Icon name="copy" />Copy</button>
              <a href={r.url} target="_blank" rel="noreferrer">{absUrl(r.url)}</a>
            </div>
          ))}
          {failResults.map((r, i) => <p key={i} className="form-error">{r.name}: {r.error}</p>)}
        </section>
      )}

      {gallery.refreshing && <p role="status" className="dim">Updating photos…</p>}
      {loading || foldersLoading ? <p className="dim">Loading…</p> : (
        <>
          {childFolders.length > 0 && (
            <>
              <div className="section-line"><h2>Folders</h2><span>{childFolders.length}</span></div>
              <div className="folders-grid">
                {childFolders.map((f) => (
                  <FolderCard key={f.id} folder={f} onOpen={() => nav(`/f/${f.id}`)} onDelete={() => onDeleteFolder(f)} />
                ))}
              </div>
            </>
          )}
          {shown.length > 0 && (
            <>
              <div className="section-line">
                <h2>{q ? `Results for “${query}”` : "Photos"}</h2>
                <span>{gallery.images.length < total && !q ? `${images.length} of ${total} loaded` : plural(shown.length, "photo")}</span>
              </div>
              <div aria-busy={gallery.refreshing || gallery.loadingMore} className="photo-grid">
                {shown.map((img, i) => (
                  <PhotoCard
                    key={img.id}
                    image={img}
                    showVisibility
                    selected={selected.has(img.id)}
                    onSelect={img.can_modify ? () => { toggleSelect(img.id); setSelectMode(true); } : undefined}
                    onOpen={() => (selectMode && img.can_modify ? toggleSelect(img.id) : setViewerIndex(i))}
                  />
                ))}
              </div>
              <LoadMore gallery={gallery} />
            </>
          )}
          {childFolders.length === 0 && shown.length === 0 && !gallery.error && (
            q ? <Empty title="No matches">Try a different name. Search covers loaded photos and these folders.</Empty>
              : mode === "folder" ? <Empty title="This folder is empty">Upload images to get started.</Empty>
              : <Empty title="No images yet">Upload some below, or create a folder.</Empty>
          )}
        </>
      )}

      {/* Upload: always targets the page you're on */}
      <div
        className={`upload-strip ${dragActive ? "dragover" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}
      >
        <button className="strip-main" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <span><Icon name="upload" /></span>
          <span>
            <strong>{uploading ? "Uploading…" : "Upload images"}</strong>
            <small>Drop files here or choose images · PNG, JPG, GIF, WebP, HEIC · into {destination}</small>
          </span>
        </button>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Direct-file visibility">
          <option value="private">Private (portal only)</option>
          <option value="public">Public (direct link)</option>
        </select>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)}
               accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif" />
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <button className="icon-button" onClick={clearSelection} aria-label="Clear selection"><Icon name="close" /></button>
          <span>{selected.size} selected</span>
          <span className="divider" />
          <button data-hide-mobile onClick={() => setSelected(new Set(images.filter((i) => i.can_modify).map((i) => i.id)))}>Select loaded</button>
          <button onClick={() => setDialog("move")} disabled={bulkBusy}><Icon name="move" />Move</button>
          <button onClick={onBulkDelete} disabled={bulkBusy}><Icon name="trash" />Delete</button>
        </div>
      )}

      {dialog === "new-folder" && (
        <FolderNameDialog
          title={folder ? "New subfolder" : "New folder"}
          intro={`Organize images in a folder. Created in ${folder?.name || "your library"}; sharing starts off.`}
          submitLabel="Create folder"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const created = await api.createFolder(name, currentFolderId);
            await refreshFolders();
            setDialog(null);
            nav(`/f/${created.id}`);
          }} />
      )}
      {dialog === "rename" && folder && (
        <FolderNameDialog
          title="Rename folder"
          initial={folder.name}
          submitLabel="Save name"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (name !== folder.name) {
              const updated = await api.updateFolder(folder.id, { name });
              setFolders((fs) => fs.map((f) => (f.id === updated.id ? { ...f, name: updated.name } : f)));
            }
            setDialog(null);
          }} />
      )}
      {dialog === "share" && folder && (
        <ShareDialog folder={folder} onClose={() => setDialog(null)}
          onChange={(updated) => {
            setFolders((fs) => fs.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)));
            gallery.refresh({ invalidate: true });
            refreshFolders();
          }} />
      )}
      {dialog === "move" && (
        <MoveDialog count={selected.size} folders={folders} folderPath={folderPath} busy={bulkBusy}
          onClose={() => setDialog(null)} onMove={(id) => bulk("move", id)} />
      )}

      {viewerIndex !== null && shown[viewerIndex] && (
        <Viewer
          images={shown}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onStep={(n) => setViewerIndex((i) => (i === null ? i : (i + n + shown.length) % shown.length))}
          actions={(img) => (
            <>
              <button className="btn" onClick={() => onCopy(absUrl(img.url))}><Icon name="copy" />Copy link</button>
              {img.can_modify && (
                <>
                  <button className="btn" onClick={() => onToggleVisibility(img)}>
                    <Icon name={img.visibility === "public" ? "lock" : "globe"} />Make {img.visibility === "public" ? "private" : "public"}
                  </button>
                  <button className="btn btn-danger" onClick={() => onDelete(img.id)}><Icon name="trash" />Delete</button>
                </>
              )}
            </>
          )}
        />
      )}
    </div>
  );
}

// Name prompt shared by "new folder" and "rename"; server errors (e.g. a sibling
// already has the name) show inline.
function FolderNameDialog({ title, intro, initial = "", submitLabel, onClose, onSubmit }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!name.trim()) return setError("Give your folder a name.");
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{submitLabel}</button></>}>
      {intro && <p>{intro}</p>}
      <label className="field">
        <span>Folder name</span>
        <input autoFocus value={name} maxLength={80} placeholder="e.g. A weekend away"
               onFocus={(e) => e.target.select()}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </label>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function MoveDialog({ count, folders, folderPath, busy, onClose, onMove }) {
  const [dest, setDest] = useState("");
  return (
    <Modal title="Move selected photos" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => onMove(dest || null)}>Move photos</button></>}>
      <p>Move {plural(count, "selected image")} to another folder.</p>
      <label className="field">
        <span>Destination folder</span>
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">Library (no folder)</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}
        </select>
      </label>
      <p className="note">Photos moved into a public album become visible to anyone with that album link.</p>
    </Modal>
  );
}
