// Progress bar for batch uploads; progress = { done, total, loaded, bytes } or null.
// Held at 99% until every response is back (server may still be converting/storing).
export default function UploadProgress({ progress }) {
  if (!progress) return null;
  const pct = progress.done === progress.total ? 100 : Math.min(99, Math.round((progress.loaded / progress.bytes) * 100));
  return (
    <div className="mb-6">
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-zinc-300 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">{pct}% · {progress.done} / {progress.total} files</p>
    </div>
  );
}
