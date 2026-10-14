// Public album view. Rendered outside <Protected> — no session required, the
// slug in the URL is the credential. Logged-out visitors can reach nothing else.
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import UploadProgress from "../UploadProgress.jsx";
import GalleryThumbnail from "../GalleryThumbnail.jsx";
import usePagedGallery from "../usePagedGallery.js";

const fetchAlbum = (slug, options) => api.getAlbum(slug, options);

export default function Album() {
  const { slug } = useParams();
  return <AlbumContent key={slug} slug={slug} />;
}

function AlbumContent({ slug }) {
  const gallery = usePagedGallery(slug, fetchAlbum);
  const { album, images, loading, total } = gallery;
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [failed, setFailed] = useState([]);
  const fileRef = useRef(null);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length, loaded: 0, bytes: 1 });
    setFailed([]);
    setError("");
    try {
      const { results } = await api.albumUpload(slug, files, setProgress);
      setFailed(results.filter((r) => !r.ok));
      if (fileRef.current) fileRef.current.value = "";
      await gallery.refresh({ invalidate: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-zinc-500">Loading…</div>;
  if (!album) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-zinc-500">
      <p role="alert">{gallery.error || "Album unavailable."}</p>
      <button onClick={() => gallery.refresh()} className="text-sm underline">Try again</button>
    </div>
  );

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-lg font-semibold mb-1">{album.name}</h1>
      <p className="text-xs text-zinc-500 mb-6">
        {total} photo{total === 1 ? "" : "s"}
        {images.length < total && ` · ${images.length} loaded`}
        {album.can_upload && " · anyone with this link can add photos"}
      </p>

      {album.can_upload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}
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
            {uploading ? "Uploading…" : "Drag & drop photos here, or click to choose"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, GIF, WebP, HEIC</p>
        </div>
      )}

      <UploadProgress progress={progress} />

      {error && <p role="alert" className="text-sm text-red-400 mb-4">{error}</p>}
      {gallery.error && (
        <p role="alert" className="text-sm text-red-400 mb-4">
          {gallery.error}{" "}
          <button onClick={() => gallery.refresh()} className="underline hover:text-red-300">Retry loading photos</button>
        </p>
      )}

      {failed.length > 0 && (
        <ul className="mb-6 space-y-1">
          {failed.map((r, i) => (
            <li key={i} className="text-xs text-red-400">{r.name}: {r.error}</li>
          ))}
        </ul>
      )}

      {gallery.refreshing && <p role="status" className="text-xs text-zinc-500 mb-3">Updating photos…</p>}
      {images.length === 0 ? (
        <p className="text-zinc-500">No photos in this album yet.</p>
      ) : (
        <div aria-busy={gallery.refreshing || gallery.loadingMore} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img) => (
            <a
              key={img.id}
              href={img.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 block"
            >
              <GalleryThumbnail image={img} />
            </a>
          ))}
        </div>
      )}
      {gallery.nextCursor && (
        <div className="mt-6 text-center">
          <button
            onClick={gallery.loadMore}
            disabled={gallery.loadingMore || gallery.refreshing}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {gallery.loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </main>
  );
}
