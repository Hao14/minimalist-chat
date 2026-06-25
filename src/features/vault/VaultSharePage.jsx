import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';

function formatExpiry(value) {
  if (!value) return 'No expiry';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return 'Unknown expiry';
  }
}

export default function VaultSharePage() {
  const { shareId } = useParams();
  const [state, setState] = useState({ status: 'loading', note: null, error: '' });

  useEffect(() => {
    let cancelled = false;

    async function loadShare() {
      if (!shareId) {
        setState({ status: 'missing', note: null, error: 'This share link is missing an id.' });
        return;
      }

      try {
        const snapshot = await get(ref(db, `vault_shares/${shareId}`));
        if (cancelled) return;

        if (!snapshot.exists()) {
          setState({ status: 'missing', note: null, error: 'This note link does not exist or was removed.' });
          return;
        }

        const note = snapshot.val();
        if (note.expiresAt && Date.now() > Number(note.expiresAt)) {
          setState({ status: 'expired', note, error: 'This shared note has expired.' });
          return;
        }

        setState({ status: 'ready', note, error: '' });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', note: null, error: error.message || 'Unable to open this shared note.' });
        }
      }
    }

    loadShare();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const expiry = useMemo(() => formatExpiry(state.note?.expiresAt), [state.note?.expiresAt]);
  const isReady = state.status === 'ready';

  return (
    <main className="vault-share-page">
      <section className="vault-share-card">
        <div className="vault-share-brand">
          <span className="blip-logo-mini" aria-hidden="true"><span /><span /></span>
          <strong>Minimalist Vault</strong>
        </div>

        <div className={`vault-share-status vault-share-status-${state.status}`}>
          <i className={`ph-bold ${isReady ? 'ph-lock-key-open' : 'ph-warning-circle'}`} aria-hidden="true" />
          <span>{isReady ? `Shared by ${state.note?.ownerName || 'someone'}` : state.error}</span>
        </div>

        {isReady ? (
          <>
            <div className="vault-share-note">
              <span className="vault-kicker">Shared private note</span>
              <h1>{state.note?.title || 'Untitled note'}</h1>
              <p>{state.note?.body || 'This note has no body.'}</p>
            </div>
            <div className="vault-share-meta">
              <span><i className="ph-bold ph-clock" /> Expires {expiry}</span>
              <span><i className="ph-bold ph-link" /> Read-only link</span>
            </div>
          </>
        ) : (
          <div className="vault-share-note vault-share-note-empty">
            <span className="vault-kicker">Shared private note</span>
            <h1>Nothing to open here.</h1>
            <p>{state.status === 'loading' ? 'Checking this secure note link…' : state.error}</p>
          </div>
        )}

        <div className="vault-share-actions">
          <Link to="/">Minimalist home</Link>
          <Link to="/login">Open app</Link>
        </div>
      </section>
    </main>
  );
}
