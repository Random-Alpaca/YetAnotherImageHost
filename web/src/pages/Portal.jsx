import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

export default function Portal() {
  const auth = useAuth();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [visibility, setVisibility] = useState("private");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [results, setResults] = useState([]); // last bulk upload's per-file outcomes
  const [copied, setCopied] = useState(""); // url just copied (for feedback)
  const fileRef = useRef(null);

  async function refresh() {
    try {
      const { images } = await api.listImages();
      setImages(images);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  // Absolute URL so the list is copy-paste ready (esp. for public links).
  const absUrl = (u) => (u.startsWith("http") ? u : window.location.origin + u);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const { results } = await api.upload(files, visibility);
      setResults(results);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
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

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — selecting the text still works */
    }
  }

  async function onDelete(id) {
    if (!confirm("Delete this image permanently?")) return;
    try {
      await api.deleteImage(id);
      setImages((imgs) => imgs.filter((i) => i.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Upload controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
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
      </div>

      {/* Drag-and-drop zone */}
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
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
        />
        <p className="text-sm text-zinc-300">
          {uploading ? "Uploading…" : "Drag & drop images here, or click to choose"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, GIF, WebP · multiple files supported</p>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Result: list of uploaded image URLs */}
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

      {/* Gallery */}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-zinc-500">No images yet. Upload some above.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img) => (
            <figure key={img.id} className="group relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
              <a href={img.url} target="_blank" rel="noreferrer">
                <img src={img.url} alt={img.original_name || img.id} loading="lazy"
                     className="w-full h-40 object-cover" />
              </a>
              <figcaption className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-zinc-400">
                <span className={img.visibility === "public" ? "text-emerald-400" : "text-amber-400"}>
                  {img.visibility}
                </span>
                {auth.isAdmin && (
                  <button onClick={() => onDelete(img.id)}
                          className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition">
                    Delete
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
