import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref, remove, set } from 'firebase/database';
import { db as firebaseDb } from '../../lib/firebase.js';

const DB_NAME = 'minimalist-private-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vaultItems';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const SHARE_DURATIONS = [
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
  { label: '7 days', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', value: 30 * 24 * 60 * 60 * 1000 },
];

function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(timestamp) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return 'Saved';
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Vault storage failed.'));
  });
}

function openVaultDb() {
  if (!window.indexedDB) {
    return Promise.reject(new Error('Private vault storage is not supported in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open private vault.'));
  });
}

async function readVaultItems(userId) {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.index('userId').getAll(window.IDBKeyRange.only(userId));
    const items = await requestToPromise(request);
    return items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } finally {
    db.close();
  }
}

async function saveVaultItem(item) {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(item));
  } finally {
    db.close();
  }
}

async function deleteVaultItem(id) {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}

function FilePreview({ item }) {
  return (
    <div className="vault-file-icon" aria-hidden="true">
      <i className={item.fileType?.startsWith('image/') ? 'ph-bold ph-image-square' : 'ph-bold ph-file-lock'} />
    </div>
  );
}

function vaultTypeLabel(type) {
  if (type === 'note') return 'Note';
  if (type === 'file') return 'File';
  return 'Item';
}

function vaultStatusLine(counts, totalBytes) {
  const totalItems = counts.notes + counts.files + counts.saved;
  if (!totalItems) return 'Awaiting first private item.';
  return `${totalItems} private item${totalItems === 1 ? '' : 's'} · ${formatBytes(totalBytes)} local files`;
}

function savedBookmarkList(bookmarks = {}) {
  return Object.entries(bookmarks || {})
    .map(([id, bookmark]) => ({ id, ...bookmark }))
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

function shareUrlFor(id) {
  return `${window.location.origin}/vault/share/${id}`;
}

export function VaultPanel({ userId, userName = 'You', initialView = 'all', bookmarks = {} }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [activeType, setActiveType] = useState(initialView || 'all');
  const [query, setQuery] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [savedBookmarks, setSavedBookmarks] = useState(bookmarks || {});
  const [shareItemId, setShareItemId] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [lastShare, setLastShare] = useState(null);
  const fileInputRef = useRef(null);

  const loadItems = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setStatus('ready');
      return;
    }

    setStatus('loading');
    try {
      setItems(await readVaultItems(userId));
      setStatus('ready');
    } catch (error) {
      setStatus(error.message || 'Vault failed to load.');
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) loadItems();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadItems]);

  useEffect(() => {
    if (initialView) setActiveType(initialView);
  }, [initialView]);

  useEffect(() => {
    setSavedBookmarks(bookmarks || {});
  }, [bookmarks]);

  useEffect(() => {
    const handleBookmarksUpdated = (event) => setSavedBookmarks(event.detail || {});
    window.addEventListener('minimalist:bookmarks-updated', handleBookmarksUpdated);
    return () => window.removeEventListener('minimalist:bookmarks-updated', handleBookmarksUpdated);
  }, []);

  useEffect(() => {
    const handleVaultOpen = (event) => {
      if (event.detail?.view) setActiveType(event.detail.view);
    };
    window.addEventListener('minimalist:vault-open', handleVaultOpen);
    return () => window.removeEventListener('minimalist:vault-open', handleVaultOpen);
  }, []);

  const counts = useMemo(() => ({
    notes: items.filter((item) => item.type === 'note').length,
    files: items.filter((item) => item.type === 'file').length,
    saved: savedBookmarkList(savedBookmarks).length,
  }), [items, savedBookmarks]);

  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + (Number(item.size) || 0), 0), [items]);

  const savedEntries = useMemo(() => savedBookmarkList(savedBookmarks), [savedBookmarks]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeType !== 'all' && item.type !== activeType) return false;
      if (!term) return true;
      return [
        item.title,
        item.body,
        item.fileName,
        item.fileType,
      ].filter(Boolean).some((value) => value.toLowerCase().includes(term));
    });
  }, [activeType, items, query]);

  const filteredSaved = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return savedEntries;
    return savedEntries.filter((bookmark) => [
      bookmark.text,
      bookmark.name,
      bookmark.roomName,
      bookmark.collection,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [query, savedEntries]);

  const saveNote = async (event) => {
    event.preventDefault();
    const title = noteTitle.trim();
    const body = noteBody.trim();

    if (!title && !body) {
      window.showToast?.('Add a note title or body first.', true);
      return;
    }

    const now = Date.now();
    await saveVaultItem({
      id: newId(),
      userId,
      type: 'note',
      title: title || 'Untitled private note',
      body,
      ownerName: userName,
      createdAt: now,
      updatedAt: now,
    });

    setNoteTitle('');
    setNoteBody('');
    setComposerOpen(false);
    window.showToast?.('Saved to Vault.', false);
    loadItems();
  };

  const saveFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      window.showToast?.(`${oversized.name} is over the 50MB private-vault limit.`, true);
      event.target.value = '';
      return;
    }

    const now = Date.now();
    try {
      await Promise.all(files.map((file) => saveVaultItem({
        id: newId(),
        userId,
        type: 'file',
        title: file.name,
        fileName: file.name,
        fileType: file.type || 'Unknown file',
        size: file.size,
        blob: file,
        ownerName: userName,
        createdAt: now,
        updatedAt: now,
      })));

      window.showToast?.(`${files.length} file${files.length === 1 ? '' : 's'} saved to Vault.`, false);
      event.target.value = '';
      loadItems();
    } catch (error) {
      window.showToast?.(`Vault upload failed: ${error.message || 'Unknown error'}`, true);
    }
  };

  const removeItem = async (item) => {
    const confirmed = await window.appConfirm?.({
      kicker: 'Vault',
      title: `Delete ${item.type === 'note' ? 'note' : 'file'}?`,
      message: `"${item.title || item.fileName}" will be removed from this device.`,
      confirmText: 'Delete',
      cancelText: 'Keep it',
      destructive: true,
    });

    if (!confirmed) return;
    await deleteVaultItem(item.id);
    window.showToast?.('Removed from Vault.', false);
    loadItems();
  };

  const downloadFile = (item) => {
    if (!item.blob) return;
    const url = URL.createObjectURL(item.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.fileName || item.title || 'vault-file';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openSavedBookmark = (bookmark) => {
    if (!bookmark?.roomId) return;
    window.switchRoom?.(bookmark.roomId, bookmark.roomName, bookmark.shortId, { channelId: bookmark.channelId || 'general' });
    document.getElementById('vault-panel')?.classList.remove('open');
  };

  const removeSavedBookmark = async (bookmark) => {
    if (!bookmark?.id || !userId) return;
    await remove(ref(firebaseDb, `users/${userId}/bookmarks/${bookmark.id}`));
    window.showToast?.('Removed from saved.', false);
  };

  const createShareLink = async (item, durationMs) => {
    if (!item || item.type !== 'note' || !userId) return;
    setShareBusy(true);
    try {
      const shareId = newId();
      const expiresAt = Date.now() + durationMs;
      await set(ref(firebaseDb, `vault_shares/${shareId}`), {
        type: 'note',
        title: item.title || 'Untitled private note',
        body: item.body || '',
        ownerId: userId,
        ownerName: item.ownerName || userName,
        createdAt: Date.now(),
        expiresAt,
      });

      const url = shareUrlFor(shareId);
      setLastShare({ itemId: item.id, url, expiresAt });
      await navigator.clipboard?.writeText(url);
      window.showToast?.(`Share link copied. Expires ${formatDate(expiresAt)}.`, false);
    } catch (error) {
      window.showToast?.(`Share link failed: ${error.message || 'Unknown error'}`, true);
    } finally {
      setShareBusy(false);
    }
  };

  const visibleCount = activeType === 'saved' ? filteredSaved.length : filteredItems.length;

  return (
    <div className="vault-shell vault-redesign">
      <section className="vault-hero vault-hero-modern">
        <div className="vault-lock vault-orb" aria-hidden="true">
          <i className="ph-bold ph-fingerprint" />
        </div>
        <div className="vault-hero-copy">
          <span className="vault-kicker">Private vault</span>
          <h3>{userName}&apos;s secure shelf</h3>
          <p>Notes and files saved locally on this device. Keep drafts, receipts, private links, and personal room resources close without mixing them into chat.</p>
          <div className="vault-code-line" aria-label="Vault storage status">
            <span>indexedDB://vault</span>
            <strong>{vaultStatusLine(counts, totalBytes)}</strong>
          </div>
        </div>
      </section>

      <section className="vault-actions-bar" aria-label="Vault quick actions">
        <button
          type="button"
          className="vault-primary-action"
          onClick={() => {
            setComposerOpen((value) => !value);
            setActiveType('note');
          }}
        >
          <i className="ph-bold ph-note-pencil" /> New note
        </button>
        <button type="button" className="vault-secondary-action" onClick={() => fileInputRef.current?.click()}>
          <i className="ph-bold ph-upload-simple" /> Add files
        </button>
        <button type="button" className="vault-secondary-action" onClick={() => setActiveType('saved')}>
          <i className="ph-bold ph-bookmark-simple" /> Saved
        </button>
      </section>

      <section className="vault-stats vault-command-strip" aria-label="Vault stats">
        <span><i className="ph-bold ph-note" /><strong>{counts.notes}</strong> notes</span>
        <span><i className="ph-bold ph-files" /><strong>{counts.files}</strong> files</span>
        <span><i className="ph-bold ph-bookmark-simple" /><strong>{counts.saved}</strong> saved</span>
        <span><i className="ph-bold ph-hard-drives" /><strong>{formatBytes(totalBytes)}</strong> stored</span>
      </section>

      <section className="vault-workbench" aria-label="Vault actions">
        {composerOpen && (
        <form className="vault-note-form vault-note-card" onSubmit={saveNote}>
          <div className="vault-card-head">
            <div>
              <label htmlFor="vault-note-title">Private note</label>
              <span>Quick capture</span>
            </div>
            <i className="ph-bold ph-pencil-simple-line" aria-hidden="true" />
          </div>
          <input
            id="vault-note-title"
            value={noteTitle}
            onChange={(event) => setNoteTitle(event.target.value)}
            placeholder="Title..."
          />
          <textarea
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="Write a private note..."
            rows="4"
          />
          <button type="submit"><i className="ph-bold ph-lock-key-open" /> Save note</button>
        </form>
        )}

        <section className="vault-file-drop vault-drop-card">
          <div>
            <strong><i className="ph-bold ph-upload-simple" /> Private files</strong>
            <span>Images, PDFs, docs, zips — up to 50MB each.</span>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Add files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={saveFiles}
          />
        </section>
      </section>

      <section className={`vault-library ${activeType === 'saved' ? 'vault-library-saved' : ''}`}>
        <div className="vault-library-head">
          <div>
            <span className="vault-kicker">Library</span>
            <strong>{visibleCount} visible</strong>
          </div>
          <div className="vault-filter-row">
            {['all', 'note', 'file', 'saved'].map((type) => (
              <button
                key={type}
                type="button"
                className={`vault-filter ${activeType === type ? 'active' : ''}`}
                onClick={() => setActiveType(type)}
              >
                {type === 'all' ? 'All' : type === 'note' ? 'Notes' : type === 'file' ? 'Files' : 'Saved'}
              </button>
            ))}
          </div>
        </div>

        <label className="vault-search-wrap">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <input
            className="vault-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vault..."
            aria-label="Search vault"
          />
        </label>

        <div className="vault-list" aria-live="polite">
          {activeType !== 'saved' && status === 'loading' && <div className="vault-empty">Opening vault...</div>}
          {activeType !== 'saved' && status !== 'ready' && status !== 'loading' && <div className="vault-empty danger">{status}</div>}
          {activeType === 'saved' && filteredSaved.length === 0 && (
            <div className="vault-empty vault-saved-empty">
              <i className="ph-bold ph-bookmark-simple" />
              <strong>No saved messages yet.</strong>
              <span>Use a message menu to save something, then it will live here beside notes and files.</span>
            </div>
          )}
          {activeType === 'saved' && filteredSaved.map((bookmark, index) => (
            <article className="vault-item vault-saved-card" key={bookmark.id} style={{ '--vault-delay': `${Math.min(index * 28, 220)}ms` }}>
              <div className="vault-file-icon vault-saved-icon" aria-hidden="true">
                {(bookmark.roomName || bookmark.collection || 'S').charAt(0).toUpperCase()}
              </div>
              <div className="vault-item-copy">
                <div className="vault-item-head">
                  <strong>{bookmark.text || 'Saved message'}</strong>
                  <span>{formatDate(bookmark.ts)}</span>
                </div>
                <div className="vault-item-meta">
                  <span>{bookmark.collection || 'Saved'}</span>
                  <span>{bookmark.name || 'Someone'}</span>
                  <span>{bookmark.roomName || 'Room'}</span>
                </div>
                <p>{bookmark.text || 'No preview available.'}</p>
                <div className="vault-item-actions">
                  <button type="button" onClick={() => openSavedBookmark(bookmark)}>
                    <i className="ph-bold ph-arrow-square-out" /> Open
                  </button>
                  <button type="button" className="danger" onClick={() => removeSavedBookmark(bookmark)}>
                    <i className="ph-bold ph-trash" /> Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
          {activeType !== 'saved' && status === 'ready' && filteredItems.length === 0 && (
            <div className="vault-empty">
              <i className="ph-bold ph-lock-simple" />
              <strong>No private items yet.</strong>
              <span>Save a note or upload a file to start building your Vault.</span>
            </div>
          )}

          {activeType !== 'saved' && status === 'ready' && filteredItems.map((item, index) => (
            <article className={`vault-item vault-item-${item.type}`} key={item.id} style={{ '--vault-delay': `${Math.min(index * 28, 220)}ms` }}>
              {item.type === 'file' && <FilePreview item={item} />}
              {item.type === 'note' && (
                <div className="vault-file-icon vault-note-icon" aria-hidden="true">
                  <i className="ph-bold ph-note-pencil" />
                </div>
              )}
              <div className="vault-item-copy">
                <div className="vault-item-head">
                  <strong>{item.title || item.fileName || 'Untitled'}</strong>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <div className="vault-item-meta">
                  <span>{vaultTypeLabel(item.type)}</span>
                  <span>{item.ownerName || userName}</span>
                </div>
                {item.type === 'note' ? (
                  <p>{item.body || 'Empty note'}</p>
                ) : (
                  <p>{formatBytes(item.size)} · {item.fileType || 'File'}</p>
                )}
                <div className="vault-item-actions">
                  {item.type === 'file' && (
                    <button type="button" onClick={() => downloadFile(item)}>
                      <i className="ph-bold ph-download-simple" /> Download
                    </button>
                  )}
                  {item.type === 'note' && (
                    <button type="button" onClick={() => setShareItemId((value) => (value === item.id ? null : item.id))}>
                      <i className="ph-bold ph-share-network" /> Share
                    </button>
                  )}
                  <button type="button" className="danger" onClick={() => removeItem(item)}>
                    <i className="ph-bold ph-trash" /> Delete
                  </button>
                </div>
                {item.type === 'note' && shareItemId === item.id && (
                  <div className="vault-share-panel">
                    <strong>Share this note</strong>
                    <span>Pick how long the link should stay open.</span>
                    <div className="vault-share-options">
                      {SHARE_DURATIONS.map((duration) => (
                        <button
                          key={duration.label}
                          type="button"
                          disabled={shareBusy}
                          onClick={() => createShareLink(item, duration.value)}
                        >
                          {duration.label}
                        </button>
                      ))}
                    </div>
                    {lastShare?.itemId === item.id && (
                      <label className="vault-share-url">
                        <span>Copied link</span>
                        <input readOnly value={lastShare.url} onFocus={(event) => event.target.select()} />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
