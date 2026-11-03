import { useEffect, useState } from "react";
import { api } from "./api.js";
import Icon from "./Icon.jsx";
import { Modal } from "./Chrome.jsx";
import { copyText } from "./Photos.jsx";

// Sharing for one folder, same model as the server: who can see it inside the
// portal (access + shared_with), and, independently, a public album link
// (is_public → public_slug) with an optional public_upload. Every change saves
// immediately, exactly like the API's PATCH.
export default function ShareDialog({ folder, onChange, onClose }) {
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const albumUrl = folder.public_slug ? `${window.location.origin}/a/${folder.public_slug}` : null;
  const shared = folder.shared_with || [];

  useEffect(() => {
    api.userNames().then((d) => setPeople(d.users || [])).catch(() => {});
  }, []);

  async function patch(body) {
    setBusy(true);
    setError("");
    try {
      onChange(await api.updateFolder(folder.id, body));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Share folder" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p>{folder.name} · {folder.count} photo{folder.count === 1 ? "" : "s"}</p>

      <fieldset className="share-fields" disabled={busy}>
        <label className="field">
          <span>Who can view it inside the portal?</span>
          <select value={folder.access || "everyone"} onChange={(e) => patch({ access: e.target.value })}>
            <option value="everyone">Everyone signed in</option>
            <option value="admins">Admins only</option>
            <option value="shared">Only specific people</option>
          </select>
        </label>

        {folder.access === "shared" && (
          <div className="field">
            <span>Allowed people</span>
            <div className="chips">
              {people.length === 0 && <small>No other accounts yet.</small>}
              {people.map((p) => {
                const on = shared.includes(p.id);
                return (
                  <button key={p.id} className={`chip ${on ? "on" : ""}`} aria-pressed={on}
                          onClick={() => patch({ shared_with: on ? shared.filter((x) => x !== p.id) : [...shared, p.id] })}>
                    {p.username}
                  </button>
                );
              })}
            </div>
            <small>The owner and admins always have access.</small>
          </div>
        )}

        <label className="toggle-row">
          <span>
            <strong>Public album link</strong>
            <p>Anyone with the link can view this album without an account.</p>
          </span>
          <input className="switch" type="checkbox" checked={!!folder.public_slug}
                 onChange={(e) => patch({ is_public: e.target.checked })} aria-label="Public album link" />
        </label>

        {albumUrl && (
          <>
            <div className="share-link">
              <span>{albumUrl}</span>
              <button className="btn" onClick={async () => { if (await copyText(albumUrl)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
                <Icon name="copy" />{copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <label className="toggle-row">
              <span>
                <strong>Let visitors add photos</strong>
                <p>Visitors can upload images to this album. Their uploads stay private files.</p>
              </span>
              <input className="switch" type="checkbox" checked={!!folder.public_upload}
                     onChange={(e) => patch({ public_upload: e.target.checked })} aria-label="Let visitors add photos" />
            </label>
            <p className="note">Turning off public sharing issues a new link next time — the old one stops working for good.</p>
          </>
        )}
      </fieldset>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
