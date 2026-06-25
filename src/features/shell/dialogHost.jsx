/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

let setDialogState = null;
let activeResolver = null;
let dialogRoot = null;

function closeDialog(value) {
  const resolver = activeResolver;
  activeResolver = null;
  setDialogState?.(null);
  resolver?.(value);
}

function AppDialogHost() {
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    setDialogState = setDialog;
    return () => {
      if (setDialogState === setDialog) setDialogState = null;
    };
  }, []);

  if (!dialog) return null;

  return (
    <div className="app-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(false); }}>
      <section className="app-dialog-card" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div className="app-dialog-head">
          <div>
            <span>{dialog.kicker || 'Confirm'}</span>
            <h3 id="app-dialog-title">{dialog.title || 'Are you sure?'}</h3>
          </div>
          <button type="button" onClick={() => closeDialog(false)} aria-label="Close dialog">✖</button>
        </div>
        <p>{dialog.message || dialog.description || 'Please confirm this action.'}</p>
        <div className="app-dialog-actions">
          <button type="button" onClick={() => closeDialog(false)}>{dialog.cancelText || 'Cancel'}</button>
          <button type="button" className={dialog.destructive ? 'danger' : ''} onClick={() => closeDialog(true)}>
            {dialog.confirmText || 'Confirm'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ensureDialogHost() {
  let host = document.getElementById('app-dialog-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'app-dialog-root';
    document.body.appendChild(host);
  }

  if (!dialogRoot) dialogRoot = createRoot(host);
  dialogRoot.render(<AppDialogHost />);
}

window.appConfirm = function appConfirm(options = {}) {
  ensureDialogHost();
  return new Promise((resolve) => {
    activeResolver?.(false);
    activeResolver = resolve;
    setDialogState?.({
      type: 'confirm',
      ...options,
    });
  });
};

ensureDialogHost();
