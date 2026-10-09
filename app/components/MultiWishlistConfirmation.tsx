import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { action } from "../routes/app.settings";

type Props = { onClose: () => void; onEnabled: () => void };

export function MultiWishlistConfirmation({ onClose, onEnabled }: Props) {
  const fetcher = useFetcher<typeof action>();
  const dialog = useRef<HTMLDialogElement>(null);
  const handled = useRef(false);
  const [confirmation, setConfirmation] = useState("");
  const saving = fetcher.state !== "idle";
  const error = fetcher.data?.kind === "multiWishlist" && !fetcher.data.saved ? fetcher.data.error : null;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    modal?.querySelector<HTMLInputElement>('input[name="confirmation"]')?.focus();
    return () => { modal?.close(); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.kind === "multiWishlist" && fetcher.data.saved && !handled.current) {
      handled.current = true;
      onEnabled();
      onClose();
    }
  }, [fetcher.state, fetcher.data, onEnabled, onClose]);

  return <dialog ref={dialog} className="ss-mode-dialog" aria-labelledby="ss-mode-title" aria-describedby="ss-mode-warning" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <header className="ss-mode-header">
      <h2 id="ss-mode-title">Switch to Multi-Wishlist</h2>
      <button type="button" className="ss-mode-close" aria-label="Close confirmation" onClick={onClose} disabled={saving}>×</button>
    </header>
    <fetcher.Form method="post" action="/app/settings" onSubmit={(event) => { if (confirmation !== "ENABLE" || saving) event.preventDefault(); }}>
      <input type="hidden" name="intent" value="enableMultiWishlist" />
      <div className="ss-mode-body">
        <h3>Switch to Multi-Wishlist</h3>
        <p>You are switching to Multiple Lists mode.</p>
        <div className="ss-mode-benefit">
          <strong>✓ The Benefit:</strong>
          <p>Shoppers can easily create and name their own lists, making it super simple to keep track of all their saved items.</p>
        </div>
        <div className="ss-mode-warning" id="ss-mode-warning">
          <strong>⚠ NOTE: This is a one-way switch.</strong>
          <p>Once enabled, you cannot switch back to Single List mode. This ensures that the custom lists your shoppers create are never deleted or broken by a mode change.</p>
        </div>
        <label htmlFor="ss-mode-confirmation">To confirm, type &quot;ENABLE&quot; below:</label>
        <input id="ss-mode-confirmation" name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type the word mentioned above in quotes" autoComplete="off" spellCheck={false} disabled={saving} aria-invalid={Boolean(error)} aria-describedby={error ? "ss-mode-error" : undefined} />
        {error && <p id="ss-mode-error" className="ss-mode-error" role="alert">{error}</p>}
      </div>
      <footer className="ss-mode-footer">
        <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="ss-primary" disabled={confirmation !== "ENABLE" || saving}>{saving ? "Enabling…" : "Enable Mode"}</button>
      </footer>
    </fetcher.Form>
  </dialog>;
}
