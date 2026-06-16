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

  async function onUpload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      await api.upload(file, visibility);
      fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
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

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Upload */}
      <form onSubmit={onUpload} className="flex flex-wrap items-center gap-3 mb-8">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
        />
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
        >
          <option value="private">Private (portal only)</option>
          <option value="public">Public (direct link)</option>
        </select>
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-zinc-100 text-zinc-900 font-medium px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Gallery */}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-zinc-500">No images yet. Upload one above.</p>
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
