import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

// Credits required by the licenses of the design guidance and the typeface.
export function Footer() {
  return (
    <footer className="page-footer">
      <span>
        Design based on{" "}
        <a href="https://github.com/heydamir/unslop" target="_blank" rel="noreferrer">Unslop</a>{" "}
        by Damir Sokolovsky (<a href="https://github.com/heydamir" target="_blank" rel="noreferrer">@heydamir</a>),{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
        {" · "}Typeface <a href="/fonts/OFL.txt" target="_blank" rel="noreferrer">Geist</a> by Vercel, SIL OFL 1.1
      </span>
    </footer>
  );
}

// Full-width page without the sidebar: login, signup and public albums.
export function Bare({ children }) {
  return (
    <div className="shell bare">
      <main>{children}</main>
      <Footer />
    </div>
  );
}

// Native <dialog> modal. Rendered only while open; closes on Esc or backdrop click.
export function Modal({ title, onClose, footer, children }) {
  const ref = useRef(null);
  // showModal() runs after React's autoFocus, so focus the first field ourselves.
  useEffect(() => {
    ref.current.showModal();
    ref.current.querySelector("input:not([type=checkbox]), select")?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const r = e.target.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
