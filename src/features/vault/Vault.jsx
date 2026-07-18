import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref, remove } from 'firebase/database';
import { db as firebaseDb } from '../../lib/firebase.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';

const DB_NAME = 'minimalist-private-vault';
const DB_VERSION = 2;
const STORE_NAME = 'vaultItems';
const BLOB_STORE_NAME = 'vaultItemBlobs';
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
    if (!formatDate.formatter) formatDate.formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return formatDate.formatter.format(new Date(timestamp));
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

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Vault storage failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Vault storage was aborted.'));
  });
}

function buildVaultItemSearchText(item) {
  return [
    item.title,
    item.body,
    item.fileName,
    item.fileType,
    item.ownerName,
    vaultTypeLabel(item.type),
    item.createdAt ? formatDate(item.createdAt) : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function toVaultListItem(item = {}) {
  const nextItem = { ...item };
  if (nextItem.blob) delete nextItem.blob;
  if (nextItem.type === 'file' && nextItem.hasBlob == null) nextItem.hasBlob = true;
  nextItem.searchText = buildVaultItemSearchText(nextItem);
  return nextItem;
}

function openVaultDb() {
  if (!window.indexedDB) {
    return Promise.reject(new Error('Private vault storage is not supported in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      let store = null;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      } else if (transaction) {
        store = transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
        if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'id' });
      }

      if (!transaction || !store || request.oldVersion >= 2) return;

      const blobStore = transaction.objectStore(BLOB_STORE_NAME);
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        const value = cursor.value || {};
        if (value.type === 'file') {
          const hasInlineBlob = value.blob instanceof Blob;
          if (hasInlineBlob) {
            blobStore.put({
              id: value.id,
              userId: value.userId,
              blob: value.blob,
              updatedAt: value.updatedAt || value.createdAt || Date.now(),
            });
          }

          const nextValue = { ...value, hasBlob: hasInlineBlob || value.hasBlob === true };
          if ('blob' in nextValue) delete nextValue.blob;
          cursor.update(nextValue);
        }

        cursor.continue();
      };
      cursorRequest.onerror = () => transaction.abort();
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
    return items
      .map((item) => toVaultListItem(item))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } finally {
    db.close();
  }
}

async function saveVaultItem(item) {
  const db = await openVaultDb();
  try {
    const storeNames = item.type === 'file' ? [STORE_NAME, BLOB_STORE_NAME] : [STORE_NAME];
    const tx = db.transaction(storeNames, 'readwrite');
    if (item.type === 'file') {
      const { blob, ...metadata } = item;
      tx.objectStore(STORE_NAME).put({ ...metadata, hasBlob: Boolean(blob) });
      tx.objectStore(BLOB_STORE_NAME).put({
        id: item.id,
        userId: item.userId,
        blob: blob || null,
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      });
    } else {
      tx.objectStore(STORE_NAME).put(item);
    }
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

async function saveVaultItemsBatch(items) {
  if (!items.length) return;
  const db = await openVaultDb();
  try {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const metadataStore = tx.objectStore(STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);
    items.forEach((item) => {
      const { blob, ...metadata } = item;
      metadataStore.put({ ...metadata, hasBlob: Boolean(blob) });
      blobStore.put({
        id: item.id,
        userId: item.userId,
        blob: blob || null,
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      });
    });
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

async function deleteVaultItem(id) {
  const db = await openVaultDb();
  try {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(BLOB_STORE_NAME).delete(id);
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

async function readVaultItemBlob(id) {
  const db = await openVaultDb();
  try {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readonly');
    const blobEntry = await requestToPromise(tx.objectStore(BLOB_STORE_NAME).get(id));
    if (blobEntry?.blob) return blobEntry.blob;

    const legacyItem = await requestToPromise(tx.objectStore(STORE_NAME).get(id));
    return legacyItem?.blob || null;
  } finally {
    db.close();
  }
}

function FilePreview({ item }) {
  return (
    <div className="vault-file-icon vault-item-icon" aria-hidden="true">
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

function searchTextForVaultItem(item) {
  return item.searchText || buildVaultItemSearchText(item);
}

function searchTextForBookmark(bookmark) {
  return [
    bookmark.text,
    bookmark.name,
    bookmark.roomName,
    bookmark.collection,
    bookmark.ts ? formatDate(bookmark.ts) : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function shareUrlFor(id) {
  return `${window.location.origin}/vault/share/${id}`;
}

async function postAuthedJson(url, body) {
  if (!window.currentUser?.getIdToken) throw new Error('Please sign in again first.');
  const response = await fetch(url, {
    method: 'POST',
    headers: await getAuthedJsonHeaders('Please sign in again first.'),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status}).`);
  return data;
}

function useDebouncedValue(value, delay = 150) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

const VaultStatCard = memo(function VaultStatCard({ icon, value, label }) {
  return (
    <span className="vault-stat-card">
      <i className={`ph-bold ${icon}`} aria-hidden="true" />
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
});

const VaultSavedCard = memo(function VaultSavedCard({ bookmark, index, selected, onOpen, onRemove, onSelect }) {
  return (
    <article className={`vault-item vault-saved-card ${selected ? 'is-selected selected' : ''}`} style={{ '--vault-delay': `${Math.min(index * 18, 140)}ms` }}>
      <div className="vault-file-icon vault-item-icon vault-saved-icon" aria-hidden="true">
        {(bookmark.roomName || bookmark.collection || 'S').charAt(0).toUpperCase()}
      </div>
      <div className="vault-item-copy">
        <button type="button" className="vault-item-preview-trigger" aria-pressed={selected} onClick={() => onSelect(bookmark.entryKey)}>
          <span className="vault-item-head">
            <strong>{bookmark.name ? `${bookmark.name} in ${bookmark.roomName || 'Room'}` : bookmark.roomName || 'Saved message'}</strong>
            <span>{formatDate(bookmark.ts)}</span>
          </span>
          <span className="vault-item-meta">
            <span>{bookmark.collection || 'Saved'}</span>
            <span>Message</span>
          </span>
          <span className="vault-item-preview-text">{bookmark.text || 'No preview available.'}</span>
        </button>
        <div className="vault-item-actions">
          <button type="button" aria-label="Open saved message" onClick={() => onOpen(bookmark)}>
            <i className="ph-bold ph-arrow-square-out" aria-hidden="true" /> <span>Open</span>
          </button>
          <button type="button" className="danger" aria-label="Remove saved message" onClick={() => onRemove(bookmark)}>
            <i className="ph-bold ph-trash" aria-hidden="true" /> <span>Remove</span>
          </button>
        </div>
      </div>
    </article>
  );
});

const VaultItemCard = memo(function VaultItemCard({
  item,
  index,
  shareItemId,
  shareBusy,
  shareBusyDuration,
  lastShare,
  userName,
  onDownload,
  onShareToggle,
  onShareCreate,
  onRemove,
  onSelect,
  selected,
}) {
  return (
    <article className={`vault-item vault-item-card vault-item-${item.type} ${selected ? 'is-selected selected' : ''}`} style={{ '--vault-delay': `${Math.min(index * 18, 140)}ms` }}>
      {item.type === 'file' && <FilePreview item={item} />}
      {item.type === 'note' && (
        <div className="vault-file-icon vault-item-icon vault-note-icon" aria-hidden="true">
          <i className="ph-bold ph-note-pencil" />
        </div>
      )}
      <div className="vault-item-copy">
        <button type="button" className="vault-item-preview-trigger" aria-pressed={selected} onClick={() => onSelect(item.entryKey)}>
          <span className="vault-item-head">
            <strong>{item.title || item.fileName || 'Untitled'}</strong>
            <span>{formatDate(item.createdAt)}</span>
          </span>
          <span className="vault-item-meta">
            <span>{vaultTypeLabel(item.type)}</span>
            <span>{item.ownerName || userName}</span>
          </span>
          <span className="vault-item-preview-text">{item.type === 'note' ? (item.body || 'Empty note') : `${formatBytes(item.size)} · ${item.fileType || 'File'}`}</span>
        </button>
        <div className="vault-item-actions">
          {item.type === 'file' && (
            <button type="button" aria-label={`Download ${item.fileName || 'file'}`} onClick={() => onDownload(item)}>
              <i className="ph-bold ph-download-simple" aria-hidden="true" /> <span>Download</span>
            </button>
          )}
          {item.type === 'note' && (
            <button type="button" aria-label={`Share ${item.title || 'note'}`} onClick={() => onShareToggle(item.id)}>
              <i className="ph-bold ph-share-network" aria-hidden="true" /> <span>Share</span>
            </button>
          )}
          <button type="button" className="danger" aria-label={`Delete ${item.title || item.fileName || 'item'}`} onClick={() => onRemove(item)}>
            <i className="ph-bold ph-trash" aria-hidden="true" /> <span>Delete</span>
          </button>
        </div>
        {item.type === 'note' && shareItemId === item.id && (
          <div className="vault-share-panel" aria-busy={shareBusy}>
            <strong>Share this note</strong>
            <span>Pick how long the link should stay open.</span>
            <div className="vault-share-options">
              {SHARE_DURATIONS.map((duration) => (
                <button
                  key={duration.label}
                  type="button"
                  disabled={shareBusy}
                  onClick={() => onShareCreate(item, duration.value)}
                >
                  {shareBusy && shareBusyDuration === duration.value ? 'Creating link' : duration.label}
                </button>
              ))}
            </div>
            {lastShare?.itemId === item.id && (
              <label className="vault-share-url">
                <span>Copied link</span>
                <input readOnly value={lastShare.url} aria-label="Copied share link" onFocus={(event) => event.target.select()} />
              </label>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

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
  const [shareBusyDuration, setShareBusyDuration] = useState(null);
  const [lastShare, setLastShare] = useState(null);
  const [sortMode, setSortMode] = useState('newest');
  const [selectedEntryKey, setSelectedEntryKey] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState(null);
  const fileInputRef = useRef(null);
  const noteTitleRef = useRef(null);
  const debouncedQuery = useDebouncedValue(query, 140);
  const [visibleLimitState, setVisibleLimitState] = useState({ key: '', limit: 36 });

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
      setItems([]);
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

  useEffect(() => {
    if (!composerOpen) return;
    window.requestAnimationFrame(() => noteTitleRef.current?.focus());
  }, [composerOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.storage?.estimate) return undefined;
    navigator.storage.estimate().then((estimate) => {
      if (!cancelled) setStorageEstimate(estimate);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [items.length]);

  const savedEntries = useMemo(() => savedBookmarkList(savedBookmarks), [savedBookmarks]);
  const { counts, totalBytes } = useMemo(() => {
    const nextCounts = { notes: 0, files: 0, saved: savedEntries.length };
    let nextTotalBytes = 0;

    items.forEach((item) => {
      if (item.type === 'note') nextCounts.notes += 1;
      if (item.type === 'file') nextCounts.files += 1;
      nextTotalBytes += Number(item.size) || 0;
    });

    return { counts: nextCounts, totalBytes: nextTotalBytes };
  }, [items, savedEntries.length]);

  const mergedEntries = useMemo(() => {
    const nextEntries = [
      ...items.map((item) => ({ ...item, entryKey: `local:${item.id}`, source: 'local' })),
      ...savedEntries.map((bookmark) => ({
        ...bookmark,
        type: 'saved',
        source: 'saved',
        entryKey: `saved:${bookmark.id}`,
        createdAt: Number(bookmark.ts || 0),
      })),
    ];

    return nextEntries.sort((a, b) => {
      if (sortMode === 'oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (sortMode === 'name') {
        const aName = a.title || a.fileName || a.text || a.roomName || '';
        const bName = b.title || b.fileName || b.text || b.roomName || '';
        return aName.localeCompare(bName);
      }
      if (sortMode === 'size') return Number(b.size || 0) - Number(a.size || 0);
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
  }, [items, savedEntries, sortMode]);

  const filteredEntries = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    return mergedEntries.filter((entry) => {
      if (activeType !== 'all' && entry.type !== activeType) return false;
      if (!term) return true;
      return entry.type === 'saved'
        ? searchTextForBookmark(entry).includes(term)
        : searchTextForVaultItem(entry).includes(term);
    });
  }, [activeType, debouncedQuery, mergedEntries]);

  const visibleListKey = `${activeType}:${sortMode}:${debouncedQuery.trim().toLowerCase()}`;
  const visibleLimit = visibleLimitState.key === visibleListKey ? visibleLimitState.limit : 36;
  const visibleEntries = useMemo(() => filteredEntries.slice(0, visibleLimit), [filteredEntries, visibleLimit]);
  const hiddenResultCount = Math.max(0, filteredEntries.length - visibleLimit);
  const canShowMore = activeType === 'saved' || status === 'ready';
  const hasQuery = debouncedQuery.trim().length > 0;
  const activeTypeLabel = activeType === 'all' ? 'items' : activeType === 'note' ? 'notes' : activeType === 'file' ? 'files' : 'saved messages';
  const selectedEntry = useMemo(
    () => mergedEntries.find((entry) => entry.entryKey === selectedEntryKey) || null,
    [mergedEntries, selectedEntryKey],
  );
  const storageUsage = Number(storageEstimate?.usage || 0);
  const storageQuota = Number(storageEstimate?.quota || 0);
  const storagePercent = storageQuota ? Math.min(100, Math.round((storageUsage / storageQuota) * 100)) : 0;
  const showMoreVaultItems = useCallback(() => {
    setVisibleLimitState((current) => ({
      key: visibleListKey,
      limit: (current.key === visibleListKey ? current.limit : 36) + 36,
    }));
  }, [visibleListKey]);

  const saveNote = async (event) => {
    event.preventDefault();
    const title = noteTitle.trim();
    const body = noteBody.trim();

    if (!title && !body) {
      window.showToast?.('Add a note title or body first.', true);
      return;
    }

    try {
      const now = Date.now();
      const nextItem = {
        id: newId(),
        userId,
        type: 'note',
        title: title || 'Untitled private note',
        body,
        ownerName: userName,
        createdAt: now,
        updatedAt: now,
      };
      await saveVaultItem(nextItem);

      setNoteTitle('');
      setNoteBody('');
      setComposerOpen(false);
      setItems((current) => [toVaultListItem(nextItem), ...current]);
      window.showToast?.('Saved to Vault.', false);
    } catch (error) {
      window.showToast?.(`Vault save failed: ${error.message || 'Unknown error'}`, true);
    }
  };

  const saveFileList = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      window.showToast?.(`${oversized.name} is over the 50MB private-vault limit.`, true);
      return;
    }

    const now = Date.now();
    try {
      const nextItems = files.map((file) => ({
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
      }));
      await saveVaultItemsBatch(nextItems);

      setItems((current) => [...nextItems.map((item) => toVaultListItem(item)), ...current]);
      setActiveType('file');
      window.showToast?.(`${files.length} file${files.length === 1 ? '' : 's'} saved to Vault.`, false);
    } catch (error) {
      window.showToast?.(`Vault upload failed: ${error.message || 'Unknown error'}`, true);
    }
  };

  const saveFiles = async (event) => {
    await saveFileList(event.target.files);
    event.target.value = '';
  };

  const removeItem = useCallback(async (item) => {
    const confirmed = await window.appConfirm?.({
      kicker: 'Vault',
      title: `Delete ${item.type === 'note' ? 'note' : 'file'}?`,
      message: `"${item.title || item.fileName}" will be removed from this device.`,
      confirmText: 'Delete',
      cancelText: 'Keep it',
      destructive: true,
    });

    if (!confirmed) return;
    try {
      await deleteVaultItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setSelectedEntryKey((current) => (current === item.entryKey ? null : current));
      window.showToast?.('Removed from Vault.', false);
    } catch (error) {
      window.showToast?.(`Vault delete failed: ${error.message || 'Unknown error'}`, true);
    }
  }, []);

  const downloadFile = useCallback(async (item) => {
    try {
      const blob = await readVaultItemBlob(item.id);
      if (!blob) throw new Error('File data is unavailable on this device.');

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.fileName || item.title || 'vault-file';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      window.showToast?.(`Vault download failed: ${error.message || 'Unknown error'}`, true);
    }
  }, []);

  const openSavedBookmark = useCallback((bookmark) => {
    if (!bookmark?.roomId) return;
    window.switchRoom?.(bookmark.roomId, bookmark.roomName, bookmark.shortId, { channelId: bookmark.channelId || 'general' });
    document.getElementById('vault-panel')?.classList.remove('open');
  }, []);

  const removeSavedBookmark = useCallback(async (bookmark) => {
    if (!bookmark?.id || !userId) return;
    try {
      await remove(ref(firebaseDb, `users/${userId}/bookmarks/${bookmark.id}`));
      window.showToast?.('Removed from saved.', false);
    } catch (error) {
      window.showToast?.(`Could not remove saved message: ${error.message || 'Unknown error'}`, true);
    }
  }, [userId]);

  const toggleSharePanel = useCallback((itemId) => {
    setShareItemId((value) => (value === itemId ? null : itemId));
  }, []);

  const createShareLink = useCallback(async (item, durationMs) => {
    if (!item || item.type !== 'note' || !userId) return;
    setShareBusy(true);
    setShareBusyDuration(durationMs);
    try {
      let expiresAt = Date.now() + durationMs;
      const endpoint = String(window.VAULT_SHARE_ENDPOINT || '').trim();
      if (window.MINIMALIST_FLAGS?.vaultShareBackend === false || !endpoint) {
        throw new Error('Secure Vault sharing is not configured for this deployment.');
      }
      const result = await postAuthedJson(endpoint, {
        item: {
          type: 'note',
          title: item.title || 'Untitled private note',
          body: item.body || '',
          ownerName: item.ownerName || userName,
        },
        durationMs,
      });
      const shareId = result.shareId;
      expiresAt = result.expiresAt || expiresAt;
      if (!shareId) throw new Error('Share endpoint did not return a link id.');

      const url = shareUrlFor(shareId);
      setLastShare({ itemId: item.id, url, expiresAt });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        window.showToast?.(`Share link copied. Expires ${formatDate(expiresAt)}.`, false);
      } else {
        window.showToast?.(`Share link ready. Expires ${formatDate(expiresAt)}.`, false);
      }
    } catch (error) {
      window.showToast?.(`Share link failed: ${error.message || 'Unknown error'}`, true);
    } finally {
      setShareBusy(false);
      setShareBusyDuration(null);
    }
  }, [userId, userName]);

  const visibleCount = filteredEntries.length;
  const collectionOptions = [
    { id: 'all', label: 'All', icon: 'ph-stack', count: counts.notes + counts.files + counts.saved },
    { id: 'note', label: 'Notes', icon: 'ph-note', count: counts.notes },
    { id: 'file', label: 'Files', icon: 'ph-files', count: counts.files },
    { id: 'saved', label: 'Saved', icon: 'ph-bookmark-simple', count: counts.saved },
  ];
  const selectedEntryTitle = selectedEntry?.title || selectedEntry?.fileName || selectedEntry?.roomName || 'Saved message';

  return (
    <div className="vault-shell vault-redesign vault-workspace-v3">
      <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Add private files" onChange={saveFiles} />

      <section className="vault-library" aria-labelledby="vault-library-title">
        <header className="vault-library-head">
          <div className="vault-library-heading">
            <h2 id="vault-library-title">Your library</h2>
            <span>{visibleCount} {visibleCount === 1 ? 'item' : 'items'} visible</span>
          </div>
          <div className="vault-library-actions">
            <button type="button" className="vault-primary-action" aria-label="Create a private note" aria-expanded={composerOpen} onClick={() => { setComposerOpen(true); setSelectedEntryKey(null); }}>
              <i className="ph-bold ph-note-pencil" aria-hidden="true" /> <span>New note</span>
            </button>
            <button type="button" className="vault-secondary-action" aria-label="Add private files" onClick={() => fileInputRef.current?.click()}>
              <i className="ph-bold ph-upload-simple" aria-hidden="true" /> <span>Add files</span>
            </button>
          </div>
        </header>

        <div className="vault-library-toolbar">
          <label className="vault-search-wrap">
            <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
            <input className="vault-search vault-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, files, and saved messages..." aria-label="Search vault" />
            {query ? <button type="button" className="vault-search-clear" onClick={() => setQuery('')} aria-label="Clear vault search"><i className="ph-bold ph-backspace" aria-hidden="true" /></button> : null}
          </label>
          <label className="vault-sort-control">
            <span>Sort</span>
            <select className="vault-sort-select" value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort vault items">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </label>
        </div>

        <div className="vault-filter-row vault-collection-filters" role="group" aria-label="Vault item filters">
          {collectionOptions.map((collection) => (
            <button key={collection.id} type="button" className={`vault-filter ${activeType === collection.id ? 'active' : ''}`} aria-pressed={activeType === collection.id} onClick={() => { setActiveType(collection.id); setShareItemId(null); }}>
              <i className={`ph-bold ${collection.icon}`} aria-hidden="true" />
              <span>{collection.label}</span>
              <strong className="vault-filter-count">{collection.count}</strong>
            </button>
          ))}
        </div>

        <p className="vault-result-status" aria-live="polite">Showing {visibleCount} {activeTypeLabel}{hasQuery ? ` matching “${debouncedQuery.trim()}”` : ''}.</p>

        <div id="vault-list" className="vault-list vault-library-list" aria-busy={activeType !== 'saved' && status === 'loading'}>
          {activeType !== 'saved' && status === 'loading' && <div className="vault-empty"><i className="ph-bold ph-spinner-gap" /><strong>Opening Vault</strong><span>Loading private items from this device.</span></div>}
          {activeType !== 'saved' && status !== 'ready' && status !== 'loading' && <div className="vault-empty danger" role="alert"><strong>Vault could not open</strong><span>{status}</span></div>}
          {(activeType === 'saved' || status === 'ready') && filteredEntries.length === 0 && (
            <div className="vault-empty">
              <i className={`ph-bold ${activeType === 'saved' ? 'ph-bookmark-simple' : 'ph-lock-simple'}`} />
              <strong>{hasQuery ? `No ${activeTypeLabel} match.` : activeType === 'saved' ? 'No saved messages yet.' : 'Nothing here yet.'}</strong>
              <span>{hasQuery ? 'Try another keyword or clear the search.' : activeType === 'saved' ? 'Save a message from its action menu and it will appear here.' : 'Create a note or add a private file to this device.'}</span>
            </div>
          )}

          {(activeType === 'saved' || status === 'ready') && visibleEntries.map((entry, index) => entry.type === 'saved' ? (
            <VaultSavedCard key={entry.entryKey} bookmark={entry} index={index} selected={selectedEntryKey === entry.entryKey} onSelect={setSelectedEntryKey} onOpen={openSavedBookmark} onRemove={removeSavedBookmark} />
          ) : (
            <VaultItemCard key={entry.entryKey} item={entry} index={index} selected={selectedEntryKey === entry.entryKey} shareItemId={shareItemId} shareBusy={shareBusy} shareBusyDuration={shareBusyDuration} lastShare={lastShare} userName={userName} onSelect={setSelectedEntryKey} onDownload={downloadFile} onShareToggle={toggleSharePanel} onShareCreate={createShareLink} onRemove={removeItem} />
          ))}
          {canShowMore && hiddenResultCount > 0 && <button type="button" className="vault-show-more" onClick={showMoreVaultItems}>Show {Math.min(hiddenResultCount, 36)} more</button>}
        </div>
      </section>

      <aside className="vault-utility-rail" aria-label="Vault tools">
        <section className="vault-device-panel">
          <div className="vault-device-icon" aria-hidden="true"><i className="ph-bold ph-fingerprint" /></div>
          <div className="vault-device-copy">
            <h2>Private on this device</h2>
            <p>Notes and files stay in this browser profile. Saved messages continue to point back to their rooms.</p>
          </div>
          <div className="vault-device-status"><span>LOCAL STORAGE</span><strong>{vaultStatusLine(counts, totalBytes)}</strong></div>
          <div className="vault-storage-meter" aria-label={storageQuota ? `${storagePercent}% of available browser storage used` : 'Browser storage estimate unavailable'}>
            <span style={{ width: `${storagePercent}%` }} />
          </div>
          <div className="vault-storage-copy"><span>{storageQuota ? `${formatBytes(storageUsage)} of ${formatBytes(storageQuota)} browser storage used` : `${formatBytes(totalBytes)} in Vault files`}</span><strong>{storagePercent}%</strong></div>
          <div className="vault-status-stats vault-stats-grid" aria-label="Vault totals">
            <VaultStatCard icon="ph-note" value={counts.notes} label="notes" />
            <VaultStatCard icon="ph-files" value={counts.files} label="files" />
            <VaultStatCard icon="ph-bookmark-simple" value={counts.saved} label="saved" />
            <VaultStatCard icon="ph-hard-drives" value={formatBytes(totalBytes)} label="Vault files" />
          </div>
        </section>

        {composerOpen ? (
          <form className="vault-note-form vault-note-card" onSubmit={saveNote}>
            <div className="vault-card-head"><div><h2>New private note</h2><span>Stored on this device</span></div><i className="ph-bold ph-pencil-simple-line" aria-hidden="true" /></div>
            <input ref={noteTitleRef} className="vault-note-input" id="vault-note-title" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Note title" />
            <textarea className="vault-note-textarea" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Write a private note..." rows="6" aria-label="Private note body" />
            <div className="vault-note-actions"><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="submit" className="is-primary"><i className="ph-bold ph-lock-key-open" aria-hidden="true" /> Save note</button></div>
          </form>
        ) : selectedEntry ? (
          <section className="vault-inspector-card vault-inspector">
            <div className="vault-card-head vault-inspector-head"><div><h2>Item details</h2><span>{selectedEntry.type === 'saved' ? 'Saved message' : vaultTypeLabel(selectedEntry.type)}</span></div><button type="button" className="vault-inspector-close" onClick={() => setSelectedEntryKey(null)} aria-label="Close item details"><i className="ph-bold ph-x" /></button></div>
            <div className="vault-inspector-icon" aria-hidden="true"><i className={`ph-bold ${selectedEntry.type === 'note' ? 'ph-note-pencil' : selectedEntry.type === 'file' ? 'ph-file-lock' : 'ph-bookmark-simple'}`} /></div>
            <h3>{selectedEntryTitle}</h3>
            <p className="vault-inspector-body">{selectedEntry.type === 'note' ? (selectedEntry.body || 'Empty note') : selectedEntry.type === 'file' ? `${formatBytes(selectedEntry.size)} · ${selectedEntry.fileType || 'File'}` : (selectedEntry.text || 'Saved message')}</p>
            <dl className="vault-inspector-meta"><div className="vault-inspector-meta-row"><dt>Saved</dt><dd>{formatDate(selectedEntry.createdAt)}</dd></div><div className="vault-inspector-meta-row"><dt>Owner</dt><dd>{selectedEntry.ownerName || selectedEntry.name || userName}</dd></div><div className="vault-inspector-meta-row"><dt>Location</dt><dd>{selectedEntry.type === 'saved' ? selectedEntry.roomName || 'Room' : 'This device'}</dd></div></dl>
          </section>
        ) : null}

        <section className={`vault-file-drop vault-drop-card ${dragActive ? 'is-dragging drag-active' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); void saveFileList(event.dataTransfer.files); }}>
          <div className="vault-drop-icon" aria-hidden="true"><i className="ph-bold ph-upload-simple" /></div>
          <div><h2>{dragActive ? 'Drop files here' : 'Add private files'}</h2><p>Images, PDFs, docs, and zips up to 50MB each.</p></div>
          <button type="button" className="vault-secondary-action" onClick={() => fileInputRef.current?.click()}>Choose files</button>
        </section>
      </aside>
    </div>
  );
}
