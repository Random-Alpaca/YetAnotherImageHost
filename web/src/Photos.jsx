import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import GalleryThumbnail from "./GalleryThumbnail.jsx";

export const absUrl = (u) => (u && u.startsWith("http") ? u : window.location.origin + u);
export const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// One tile. `onSelect` is passed only where selection is possible (owner/admin).
export function PhotoCard({ image, selected, onOpen, onSelect, showVisibility }) {
  const name = image.original_name || image.id;
  return (
    <article className={`photo-card ${selected ? "selected" : ""}`}>
      <button className="photo-open" onClick={onOpen} aria-label={`View ${name}`}>
        <GalleryThumbnail image={image} />
      </button>
      {onSelect && (
        <button className="photo-check" onClick={onSelect} aria-label={`${selected ? "Deselect" : "Select"} ${name}`}>
          {selected && <Icon name="check" />}
        </button>
      )}
      <div className="photo-info">
        <strong>{name}</strong>
        {showVisibility && (
          <small><Icon name={image.visibility === "public" ? "globe" : "lock"} />{image.visibility === "public" ? "Public file" : "Private file"}</small>
        )}
      </div>
    </article>
  );
}

export function LoadMore({ gallery }) {
  if (!gallery.nextCursor) return null;
  return (
    <div className="load-more">
      <button className="btn" onClick={gallery.loadMore} disabled={gallery.loadingMore || gallery.refreshing}>
        {gallery.loadingMore ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}

// Full-screen viewer over a list of images. `actions(image)` renders the footer buttons.
export function Viewer({ images, index, onStep, onClose, actions }) {
  const ref = useRef(null);
  const image = images[index];
  useEffect(() => { ref.current.showModal(); }, []);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onStep]);
  if (!image) return null;
  const name = image.original_name || image.id;
  return (
    <dialog ref={ref} id="viewer" aria-label="Image viewer" onClose={onClose}>
      <div id="viewerContent">
        <div className="viewer-head">
          <div><strong>{name}</strong><small>{index + 1} of {images.length}</small></div>
          <button className="icon-button" onClick={onClose} aria-label="Close image viewer"><Icon name="close" /></button>
        </div>
        <div className="viewer-stage">
          <button className="icon-button" onClick={() => onStep(-1)} aria-label="Previous photo"><Icon name="left" /></button>
          <img src={image.url} alt={name} />
          <button className="icon-button" onClick={() => onStep(1)} aria-label="Next photo"><Icon name="right" /></button>
        </div>
        <div className="viewer-footer">
          <span>{[image.size && `${mb(image.size)} MB`, image.visibility && `${image.visibility === "public" ? "Public" : "Private"} direct file`].filter(Boolean).join(" · ")}</span>
          <div className="actions">
            {actions?.(image)}
            <a className="btn" href={image.url} download={image.original_name || true}><Icon name="download" />Download</a>
          </div>
        </div>
      </div>
    </dialog>
  );
}
