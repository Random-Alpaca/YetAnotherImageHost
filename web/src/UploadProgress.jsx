// Progress bar for batch uploads; progress = { done, total, loaded, bytes } or null.
// Held at 99% until every response is back (server may still be converting/storing).
export default function UploadProgress({ progress }) {
  if (!progress) return null;
  const pct = progress.done === progress.total ? 100 : Math.min(99, Math.round((progress.loaded / progress.bytes) * 100));
  return (
    <div className="progress">
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="dim">{pct}% · {progress.done} / {progress.total} files</p>
    </div>
  );
}
