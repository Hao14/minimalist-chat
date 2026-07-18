import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, onDisconnect, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import { RichTextEditor } from './RichTextEditor.jsx';
import { contentToMarkdown, contentToPlainText } from './richTextDocument.js';
import './docs.css';

const emptyEditor = { title: '', content: '', emoji: '📄', tags: '' };
const MAX_DOCUMENT_TITLE_LENGTH = 180;
const MAX_DOCUMENT_CONTENT_LENGTH = 60000;
const MAX_DOCUMENT_TAG_LENGTH = 32;

function normalizeTags(rawTags) {
  const values = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(',')
      : rawTags && typeof rawTags === 'object'
        ? Object.values(rawTags)
        : [];
  return [...new Set(values
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function editorTagsToArray(value) {
  return normalizeTags(String(value || '').split(','));
}

function sameDocument(left, right) {
  return Boolean(left && right && left.roomId === right.roomId && left.activeId === right.activeId);
}

function isRoomManager(roomData = {}, user) {
  if (!user?.uid) return false;
  if (user.uid === window.MY_ADMIN_UID) return true;
  if (roomData.creatorId) return roomData.creatorId === user.uid;
  return Object.keys(roomData.members || {})[0] === user.uid;
}

function permissionAllowed(roomData = {}, key, user) {
  const overrides = user?.uid ? roomData.memberPermissions?.[user.uid] : null;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
  if (Object.prototype.hasOwnProperty.call(roomData.permissions || {}, key)) return roomData.permissions[key] !== false;
  return true;
}

async function docsAllowed(roomId, user) {
  if (roomId === 'global') return true;
  const snapshot = await get(ref(db, `rooms_meta/${roomId}`)).catch(() => null);
  const roomData = snapshot?.val() || {};
  return isRoomManager(roomData, user) || permissionAllowed(roomData, 'docs', user);
}

function timestamp() {
  return Date.now();
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

function documentUpdatePayload(nextEditor) {
  return {
    title: String(nextEditor.title || '').slice(0, MAX_DOCUMENT_TITLE_LENGTH),
    content: String(nextEditor.content || ''),
    emoji: String(nextEditor.emoji || '📄').slice(0, 16),
    tags: editorTagsToArray(nextEditor.tags),
    updatedAt: timestamp(),
  };
}

function DocumentCard({ document, onOpen }) {
  const preview = contentToPlainText(document.content).slice(0, 120) || 'Empty document.';
  const tags = normalizeTags(document.tags);
  return (
    <button type="button" className="doc-card" onClick={() => onOpen(document)}>
      <span className="doc-card-emoji">{document.emoji || '📄'}</span>
      <span className="doc-card-title">{document.title || 'Untitled'}</span>
      <span className="doc-card-preview">{preview}</span>
      <span className="doc-card-tags">{tags.map((tag) => <span key={tag} className="doc-card-tag">{tag}</span>)}</span>
      <span className="doc-card-meta"><span>🕘 {formatDate(document.updatedAt)}</span><span>👤 {document.byName || 'Unknown'}</span></span>
    </button>
  );
}

export function Docs({ roomId, user }) {
  const isRoomTabActive = useRoomTabActivity('docs');
  const isRoomTabDataActive = useRoomTabDataActivity('docs');
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [editor, setEditor] = useState(emptyEditor);
  const [collaborators, setCollaborators] = useState([]);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [canEditDocs, setCanEditDocs] = useState(roomId === 'global');
  const [documentsStatus, setDocumentsStatus] = useState({ roomId: null, loading: true, error: '' });
  const [permissionStatus, setPermissionStatus] = useState({ roomId: null, loading: roomId !== 'global' });
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const editVersion = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const latestPendingSave = useRef({ roomId, activeId, editor, canEdit: roomId === 'global', user, version: 0 });
  const deleteDialogRef = useRef(null);
  const deleteCancelRef = useRef(null);
  const deletingDocumentRef = useRef(false);
  const loadingDocuments = documentsStatus.roomId !== roomId || documentsStatus.loading;
  const documentsError = documentsStatus.roomId === roomId ? documentsStatus.error : '';
  const permissionLoading = roomId !== 'global' && (permissionStatus.roomId !== roomId || permissionStatus.loading);
  const docsCanEdit = roomId === 'global' || (!permissionLoading && canEditDocs);

  const queueDocumentSave = useCallback((pending, { silent = false } = {}) => {
    if (!pending?.activeId || !pending.canEdit) return Promise.resolve(false);

    const save = async () => {
      const latestBeforePermission = latestPendingSave.current;
      if (sameDocument(pending, latestBeforePermission) && pending.version < latestBeforePermission.version) return false;
      if (pending.editor.content.length > MAX_DOCUMENT_CONTENT_LENGTH) return false;

      try {
        const allowed = await docsAllowed(pending.roomId, pending.user);
        const latestAfterPermission = latestPendingSave.current;
        if (sameDocument(pending, latestAfterPermission) && pending.version < latestAfterPermission.version) return false;
        if (!allowed) {
          if (mounted.current && sameDocument(pending, latestAfterPermission) && pending.version === latestAfterPermission.version) {
            setCanEditDocs(false);
            setSaveStatus('Editing disabled');
            if (!silent) window.showToast?.('Docs editing is disabled in this room.');
          }
          return false;
        }

        await update(ref(db, `room_docs/${pending.roomId}/${pending.activeId}`), documentUpdatePayload(pending.editor));
        const latestAfterSave = latestPendingSave.current;
        if (sameDocument(pending, latestAfterSave) && pending.version === latestAfterSave.version) {
          dirty.current = false;
          if (mounted.current && !silent) setSaveStatus('Saved');
        }
        return true;
      } catch {
        const latestAfterError = latestPendingSave.current;
        if (mounted.current && !silent && sameDocument(pending, latestAfterError) && pending.version === latestAfterError.version) {
          setSaveStatus('Save failed');
        }
        return false;
      }
    };

    const queuedSave = saveQueue.current.then(save, save);
    saveQueue.current = queuedSave.then(() => undefined, () => undefined);
    return queuedSave;
  }, []);

  const flushPendingSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const pending = latestPendingSave.current;
    if (!dirty.current || !pending.activeId) return Promise.resolve(false);
    return queueDocumentSave(pending);
  }, [queueDocumentSave]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    return onValue(ref(db, `room_docs/${roomId}`), (snapshot) => {
      const value = snapshot.val() || {};
      setDocuments(Object.entries(value).map(([id, document]) => ({ id, ...document, tags: normalizeTags(document?.tags) })));
      setDocumentsStatus({ roomId, loading: false, error: '' });
    }, (error) => {
      setDocuments([]);
      setDocumentsStatus({ roomId, loading: false, error: error.message || 'Could not load documents.' });
    });
  }, [isRoomTabDataActive, roomId]);

  useEffect(() => {
    if (!isRoomTabDataActive || roomId === 'global') {
      return undefined;
    }

    return onValue(ref(db, `rooms_meta/${roomId}`), (snapshot) => {
      const roomData = snapshot.val() || {};
      setCanEditDocs(isRoomManager(roomData, user) || permissionAllowed(roomData, 'docs', user));
      setPermissionStatus({ roomId, loading: false });
    }, () => {
      setCanEditDocs(false);
      setPermissionStatus({ roomId, loading: false });
    });
  }, [isRoomTabDataActive, roomId, user]);

  useEffect(() => {
    if (!isRoomTabDataActive || !activeId) return undefined;
    return onValue(ref(db, `room_docs/${roomId}/${activeId}`), (snapshot) => {
      const remote = snapshot.val();
      if (!remote || dirty.current) return;
      setEditor((current) => ({
        title: document.activeElement?.id === 'doc-title-input' ? current.title : remote.title || '',
        content: document.activeElement?.id === 'doc-content-input' ? current.content : remote.content || '',
        tags: document.activeElement?.id === 'doc-tags-input' ? current.tags : normalizeTags(remote.tags).join(', '),
        emoji: remote.emoji || '📄',
      }));
    });
  }, [activeId, isRoomTabDataActive, roomId]);

  useEffect(() => {
    if (!isRoomTabActive || !activeId || !user?.uid) return undefined;
    const meRef = ref(db, `room_docs/${roomId}/${activeId}/editing/${user.uid}`);
    const editingRef = ref(db, `room_docs/${roomId}/${activeId}/editing`);
    const markPresent = () => set(meRef, {
      uid: user.uid,
      name: user.displayName || 'Anonymous',
      photoUrl: user.photoUrl || '',
      at: timestamp(),
    }).catch(() => {});

    markPresent();
    const interval = window.setInterval(markPresent, 12000);
    onDisconnect(meRef).remove().catch(() => {});
    const unsubscribe = onValue(editingRef, (snapshot) => {
      const now = timestamp();
      setCollaborators(Object.values(snapshot.val() || {})
        .filter((entry) => entry?.uid && now - Number(entry.at || 0) < 35000)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    });

    return () => {
      window.clearInterval(interval);
      remove(meRef);
      unsubscribe();
    };
  }, [activeId, isRoomTabActive, roomId, user]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(saveTimer.current);
      const pending = latestPendingSave.current;
      if (dirty.current && pending.activeId) queueDocumentSave(pending, { silent: true });
    };
  }, [queueDocumentSave]);

  useEffect(() => {
    deletingDocumentRef.current = deletingDocument;
  }, [deletingDocument]);

  useEffect(() => {
    if (!isRoomTabActive || !deleteConfirmOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape' && !deletingDocumentRef.current) {
        event.preventDefault();
        setDeleteConfirmOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(deleteDialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !deleteDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, [deleteConfirmOpen, isRoomTabActive]);

  const tags = useMemo(() => [...new Set(documents.flatMap((document) => normalizeTags(document.tags)))], [documents]);
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...documents]
      .filter((document) => activeTag === 'all' || normalizeTags(document.tags).includes(activeTag))
      .filter((document) => !query || document.title?.toLowerCase().includes(query) || contentToPlainText(document.content).toLowerCase().includes(query))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [activeTag, documents, search]);
  const openDocument = (document) => {
    const nextEditor = {
      title: document.title || '',
      content: document.content || '',
      emoji: document.emoji || '📄',
      tags: normalizeTags(document.tags).join(', '),
    };
    const version = editVersion.current + 1;
    editVersion.current = version;
    dirty.current = false;
    latestPendingSave.current = { roomId, activeId: document.id, editor: nextEditor, canEdit: docsCanEdit, user, version };
    setDeleteConfirmOpen(false);
    setDeletingDocument(false);
    setEditor(nextEditor);
    setSaveStatus('Saved');
    setActiveId(document.id);
  };

  const createDocument = async () => {
    if (!docsCanEdit && !permissionLoading) return window.showToast?.('Docs editing is disabled in this room.');
    flushPendingSave();
    const allowed = await docsAllowed(roomId, user);
    setCanEditDocs(allowed);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    const now = timestamp();
    const document = { ...emptyEditor, tags: [], by: user.uid, byName: user.displayName, createdAt: now, updatedAt: now };
    const documentRef = push(ref(db, `room_docs/${roomId}`));
    try {
      await set(documentRef, document);
      window.awardXP?.(user.uid, 'technical', 5);
      window.awardXP?.(user.uid, 'creativity', 5);
      openDocument({ id: documentRef.key, ...document });
    } catch (error) {
      window.showToast?.(`Could not create document: ${error.message}`);
    }
  };

  const downloadMarkdown = () => {
    const title = (editor.title || 'Untitled document').trim();
    const safeName = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'document';
    const markdown = contentToMarkdown(editor.content || '');
    const blob = new Blob([`# ${title}\n\n${markdown}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${safeName}.md`;
    link.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Document downloaded.', false);
  };

  const duplicateDocument = async () => {
    if (!docsCanEdit && !permissionLoading) return window.showToast?.('Docs editing is disabled in this room.');
    flushPendingSave();
    const allowed = await docsAllowed(roomId, user);
    setCanEditDocs(allowed);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    const now = timestamp();
    const copySuffix = ' copy';
    const sourceTitle = String(editor.title || 'Untitled');
    const copy = {
      ...emptyEditor,
      title: `${sourceTitle.slice(0, MAX_DOCUMENT_TITLE_LENGTH - copySuffix.length)}${copySuffix}`,
      content: editor.content || '',
      emoji: editor.emoji || '📄',
      tags: editorTagsToArray(editor.tags),
      by: user.uid,
      byName: user.displayName,
      createdAt: now,
      updatedAt: now,
    };
    const documentRef = push(ref(db, `room_docs/${roomId}`));
    try {
      await set(documentRef, copy);
      openDocument({ id: documentRef.key, ...copy });
      window.showToast?.('Document duplicated.', false);
    } catch (error) {
      window.showToast?.(`Could not duplicate document: ${error.message}`);
    }
  };

  const editDocument = (field, value) => {
    if (!docsCanEdit) {
      setSaveStatus('Read only');
      window.showToast?.('Docs editing is disabled in this room.');
      return;
    }
    if (field === 'content' && value.length > MAX_DOCUMENT_CONTENT_LENGTH) {
      setSaveStatus('Document too large');
      window.showToast?.('This document has reached the 60,000 character room limit.');
      return;
    }
    if (field === 'title' && value.length > MAX_DOCUMENT_TITLE_LENGTH) {
      setSaveStatus('Title too long');
      return;
    }
    if (field === 'tags' && value.split(',').some((tag) => tag.trim().length > MAX_DOCUMENT_TAG_LENGTH)) {
      setSaveStatus('Tag too long');
      window.showToast?.('Document tags can be up to 32 characters each.');
      return;
    }
    const nextEditor = { ...editor, [field]: value };
    const version = editVersion.current + 1;
    editVersion.current = version;
    const pending = { roomId, activeId, editor: nextEditor, canEdit: docsCanEdit, user, version };
    latestPendingSave.current = pending;
    setEditor(nextEditor);
    dirty.current = true;
    setSaveStatus('Saving…');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => queueDocumentSave(pending), 600);
  };

  const emptyDocumentsCopy = (() => {
    if (loadingDocuments) return 'Loading documents...';
    if (documentsError) return documentsError;
    if (documents.length && !filteredDocuments.length) return 'No documents match the current search or tag.';
    if (!docsCanEdit && !permissionLoading) return 'No documents yet. Docs are read-only for you in this room.';
    return 'No documents yet. Click "New doc" to start one.';
  })();

  const closeEditor = () => {
    flushPendingSave();
    setDeleteConfirmOpen(false);
    setActiveId(null);
  };

  const deleteDocument = async () => {
    if (!activeId || deletingDocument) return;
    if (!docsCanEdit && !permissionLoading) return window.showToast?.('Docs editing is disabled in this room.');
    const allowed = await docsAllowed(roomId, user);
    setCanEditDocs(allowed);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteDocument = async () => {
    if (!activeId || deletingDocument) return;
    const id = activeId;
    const allowed = await docsAllowed(roomId, user);
    if (!allowed) {
      setCanEditDocs(false);
      setDeleteConfirmOpen(false);
      window.showToast?.('Docs editing is disabled in this room.');
      return;
    }
    setDeletingDocument(true);
    try {
      window.clearTimeout(saveTimer.current);
      dirty.current = false;
      editVersion.current += 1;
      latestPendingSave.current = { ...latestPendingSave.current, activeId: null, version: editVersion.current };
      await remove(ref(db, `room_docs/${roomId}/${id}`));
      setDeleteConfirmOpen(false);
      setActiveId(null);
      window.showToast?.('Document deleted.', false);
    } catch (error) {
      window.showToast?.(`Could not delete document: ${error.message}`);
    } finally {
      setDeletingDocument(false);
    }
  };

  const deleteConfirm = deleteConfirmOpen ? (
          <div className="docs-confirm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingDocument) setDeleteConfirmOpen(false); }}>
            <section ref={deleteDialogRef} className="docs-confirm-card" role="dialog" aria-modal="true" aria-labelledby="docs-delete-title" aria-describedby="docs-delete-description">
              <div className="docs-confirm-icon"><i className="ph-bold ph-trash" /></div>
              <div className="docs-confirm-copy">
                <span className="docs-confirm-kicker">Delete document</span>
                <h3 id="docs-delete-title">Delete “{editor.title || 'Untitled'}”?</h3>
                <p id="docs-delete-description">This removes the document for everyone in this room. This cannot be undone.</p>
              </div>
              <div className="docs-confirm-actions">
                <button ref={deleteCancelRef} type="button" className="docs-confirm-cancel" disabled={deletingDocument} onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
                <button type="button" className="docs-confirm-delete" disabled={deletingDocument} onClick={confirmDeleteDocument}>
                  {deletingDocument ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </section>
          </div>
  ) : null;

  if (activeId) {
    return (
      <RichTextEditor
        documentId={activeId}
        editor={editor}
        canEdit={docsCanEdit}
        permissionLoading={permissionLoading}
        saveStatus={saveStatus}
        collaborators={collaborators}
        user={user}
        deletingDocument={deletingDocument}
        deleteConfirm={deleteConfirm}
        onChange={editDocument}
        onClose={closeEditor}
        onCreate={createDocument}
        onDuplicate={duplicateDocument}
        onDownload={downloadMarkdown}
        onDelete={deleteDocument}
      />
    );
  }

  return (
    <div id="docs-list-view">
      <div className="docs-toolbar">
        <input id="docs-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search docs..." aria-label="Search documents" />
        <button type="button" className="docs-new-btn" id="docs-new-btn" disabled={permissionLoading || !docsCanEdit} aria-disabled={permissionLoading || !docsCanEdit} title={!docsCanEdit ? 'Docs editing is disabled in this room' : 'Create a new document'} onClick={createDocument}><i className="ph-bold ph-plus" /> New doc</button>
      </div>
      {!permissionLoading && !docsCanEdit ? (
        <div className="docs-permission-note" role="note">
          <i className="ph-bold ph-lock-key" /> Docs are read-only for you in this room. Existing documents can still be opened.
        </div>
      ) : null}
      <div className="docs-tags" id="docs-tags">
        {['all', ...tags].map((tag) => <button key={tag} type="button" className={`docs-tag-chip ${tag === activeTag ? 'active' : ''}`} aria-pressed={tag === activeTag} onClick={() => setActiveTag(tag)}>{tag === 'all' ? 'All' : tag}</button>)}
      </div>
      <div className="docs-grid" id="docs-grid">
        {filteredDocuments.length ? filteredDocuments.map((document) => <DocumentCard key={document.id} document={document} onOpen={openDocument} />) : <div className={`docs-empty ${documentsError ? 'error' : ''}`} role={loadingDocuments ? 'status' : documentsError ? 'alert' : 'note'}>{emptyDocumentsCopy}</div>}
      </div>
    </div>
  );
}
