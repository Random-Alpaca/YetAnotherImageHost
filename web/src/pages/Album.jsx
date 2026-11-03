// Public album view. Rendered outside <Protected> — no session required, the
// slug in the URL is the credential. Logged-out visitors can reach nothing else.
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";
import { Bare } from "../Chrome.jsx";
import Icon from "../Icon.jsx";
import UploadProgress from "../UploadProgress.jsx";
import { LoadMore, PhotoCard, Viewer } from "../Photos.jsx";
import usePagedGallery from "../usePagedGallery.js";

const fetchAlbum = (slug, options) => api.getAlbum(slug, options);

export default function Album() {
  const { slug } = useParams();
  return <AlbumContent key={slug} slug={slug} />;
}

function AlbumContent({ slug }) {
  const auth = useAuth();
  const gallery = usePagedGallery(slug, fetchAlbum);
  const { album, images, loading, total } = gallery;
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [failed, setFailed] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(null);
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

  if (loading) return <Bare><p className="dim">Loading…</p></Bare>;
  if (!album) return (
    <Bare>
      <div className="empty">
        <Icon name="image" />
        <h2>Album unavailable</h2>
        <p role="alert">{gallery.error || "This album could not be found."}</p>
        <button className="btn" onClick={() => gallery.refresh()}>Try again</button>
      </div>
    </Bare>
  );

  return (
    <Bare>
      <div className="album-top">
        <span>Public album</span>
        {auth.isAuthed
          ? <Link className="btn" to="/">Back to library</Link>
          : <Link className="text-link" to="/login">Sign in</Link>}
      </div>
      <div className="album-banner">
        <h1>{album.name}</h1>
        <p>
          {total} photo{total === 1 ? "" : "s"}
          {images.length < total && ` · ${images.length} loaded`}
          {album.can_upload && " · anyone with this link can add photos"}
        </p>
      </div>

      {album.can_upload && (
        <div
          className={`upload-strip ${dragActive ? "dragover" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}
        >
          <button className="strip-main" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <span><Icon name="upload" /></span>
            <span>
              <strong>{uploading ? "Uploading…" : "Add photos"}</strong>
              <small>Drop files here or choose images · PNG, JPG, GIF, WebP, HEIC</small>
            </span>
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)}
                 accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif" />
        </div>
      )}

      <UploadProgress progress={progress} />
      {error && <p role="alert" className="form-error">{error}</p>}
      {gallery.error && (
        <p role="alert" className="form-error">
          {gallery.error} <button className="link-button" onClick={() => gallery.refresh()}>Retry loading photos</button>
        </p>
      )}
      {failed.map((r, i) => <p key={i} className="form-error">{r.name}: {r.error}</p>)}

      {gallery.refreshing && <p role="status" className="dim">Updating photos…</p>}
      {images.length === 0 ? (
        <div className="empty"><Icon name="image" /><h2>No photos yet</h2><p>This album is empty.</p></div>
      ) : (
        <>
          <div aria-busy={gallery.refreshing || gallery.loadingMore} className="photo-grid">
            {images.map((img, i) => <PhotoCard key={img.id} image={img} onOpen={() => setViewerIndex(i)} />)}
          </div>
          <LoadMore gallery={gallery} />
        </>
      )}

      {viewerIndex !== null && images[viewerIndex] && (
        <Viewer
          images={images}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onStep={(n) => setViewerIndex((i) => (i === null ? i : (i + n + images.length) % images.length))}
        />
      )}
    </Bare>
  );
}
