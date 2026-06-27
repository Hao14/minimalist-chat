import { useEffect, useMemo, useRef, useState } from 'react';
import { get, onDisconnect, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const emojis = ['📄', '📝', '☕', '🧘', '🌅', '📌', '💡', '🚀', '🔬', '📚'];
const emptyEditor = { title: '', content: '', emoji: '📄', tags: '' };

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

function DocumentCard({ document, onOpen }) {
  const preview = document.content?.replace(/\s+/g, ' ').slice(0, 120) || 'Empty document.';
  return (
    <button type="button" className="doc-card" onClick={() => onOpen(document)}>
      <span className="doc-card-emoji">{document.emoji || '📄'}</span>
      <span className="doc-card-title">{document.title || 'Untitled'}</span>
      <span className="doc-card-preview">{preview}</span>
      <span className="doc-card-tags">{(document.tags || []).map((tag) => <span key={tag} className="doc-card-tag">{tag}</span>)}</span>
      <span className="doc-card-meta"><span>🕘 {formatDate(document.updatedAt)}</span><span>👤 {document.byName || 'Unknown'}</span></span>
    </button>
  );
}

export function Docs({ roomId, user }) {
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [editor, setEditor] = useState(emptyEditor);
  const [collaborators, setCollaborators] = useState([]);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const contentRef = useRef(null);

  useEffect(() => onValue(ref(db, `room_docs/${roomId}`), (snapshot) => {
    const value = snapshot.val() || {};
    setDocuments(Object.entries(value).map(([id, document]) => ({ id, ...document })));
  }), [roomId]);

  useEffect(() => {
    if (!activeId) return undefined;
    return onValue(ref(db, `room_docs/${roomId}/${activeId}`), (snapshot) => {
      const remote = snapshot.val();
      if (!remote || dirty.current) return;
      setEditor((current) => ({
        title: document.activeElement?.id === 'doc-title-input' ? current.title : remote.title || '',
        content: document.activeElement?.id === 'doc-content-input' ? current.content : remote.content || '',
        tags: document.activeElement?.id === 'doc-tags-input' ? current.tags : (remote.tags || []).join(', '),
        emoji: remote.emoji || '📄',
      }));
    });
  }, [activeId, roomId]);

  useEffect(() => {
    if (!activeId || !user?.uid) return undefined;
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
    onDisconnect(meRef).remove();
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
  }, [activeId, roomId, user]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const tags = useMemo(() => [...new Set(documents.flatMap((document) => document.tags || []))], [documents]);
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...documents]
      .filter((document) => activeTag === 'all' || (document.tags || []).includes(activeTag))
      .filter((document) => !query || document.title?.toLowerCase().includes(query) || document.content?.toLowerCase().includes(query))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [activeTag, documents, search]);

  const openDocument = (document) => {
    dirty.current = false;
    setDeleteConfirmOpen(false);
    setDeletingDocument(false);
    setEditor({
      title: document.title || '',
      content: document.content || '',
      emoji: document.emoji || '📄',
      tags: (document.tags || []).join(', '),
    });
    setSaveStatus('Saved');
    setActiveId(document.id);
  };

  const createDocument = async () => {
    const allowed = await docsAllowed(roomId, user);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    const now = timestamp();
    const document = { ...emptyEditor, tags: [], by: user.uid, byName: user.displayName, createdAt: now, updatedAt: now };
    const documentRef = push(ref(db, `room_docs/${roomId}`));
    await set(documentRef, document);
    window.awardXP?.(user.uid, 'technical', 5);
    window.awardXP?.(user.uid, 'creativity', 5);
    openDocument({ id: documentRef.key, ...document });
  };

  const downloadMarkdown = () => {
    const title = (editor.title || 'Untitled document').trim();
    const safeName = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'document';
    const blob = new Blob([`# ${title}\n\n${editor.content || ''}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${safeName}.md`;
    link.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Document downloaded.', false);
  };

  const duplicateDocument = async () => {
    const allowed = await docsAllowed(roomId, user);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    const now = timestamp();
    const copy = {
      ...emptyEditor,
      title: `${editor.title || 'Untitled'} copy`,
      content: editor.content || '',
      emoji: editor.emoji || '📄',
      tags: editor.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      by: user.uid,
      byName: user.displayName,
      createdAt: now,
      updatedAt: now,
    };
    const documentRef = push(ref(db, `room_docs/${roomId}`));
    await set(documentRef, copy);
    openDocument({ id: documentRef.key, ...copy });
    window.showToast?.('Document duplicated.', false);
  };

  const saveDocument = async (nextEditor) => {
    if (!activeId) return;
    try {
      const allowed = await docsAllowed(roomId, user);
      if (!allowed) {
        setSaveStatus('Editing disabled');
        window.showToast?.('Docs editing is disabled in this room.');
        return;
      }
      await update(ref(db, `room_docs/${roomId}/${activeId}`), {
        title: nextEditor.title,
        content: nextEditor.content,
        emoji: nextEditor.emoji,
        tags: nextEditor.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        updatedAt: timestamp(),
      });
      dirty.current = false;
      setSaveStatus('Saved');
    } catch {
      setSaveStatus('Save failed');
    }
  };

  const editDocument = (field, value) => {
    const nextEditor = { ...editor, [field]: value };
    setEditor(nextEditor);
    dirty.current = true;
    setSaveStatus('Saving…');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveDocument(nextEditor), 600);
  };

  const formatSelection = (type) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = editor.content.slice(start, end);
    const formats = {
      bold: ['**', '**', 'bold text'],
      italic: ['_', '_', 'italic text'],
      heading: ['## ', '', 'Heading'],
      bullet: ['- ', '', 'List item'],
      quote: ['> ', '', 'Quote'],
      code: ['`', '`', 'code'],
    };
    const [before, after, fallback] = formats[type] || formats.bold;
    const replacement = `${before}${selected || fallback}${after}`;
    const nextContent = `${editor.content.slice(0, start)}${replacement}${editor.content.slice(end)}`;
    editDocument('content', nextContent);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + (selected || fallback).length;
    });
  };

  const insertAtCursor = (value, selectOffset = 0, selectLength = 0) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const nextContent = `${editor.content.slice(0, start)}${value}${editor.content.slice(end)}`;
    editDocument('content', nextContent);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + value.length;
      textarea.selectionStart = selectLength ? start + selectOffset : cursor;
      textarea.selectionEnd = selectLength ? start + selectOffset + selectLength : cursor;
    });
  };

  const runDocMenuAction = async (action) => {
    setOpenMenu(null);
    const textarea = contentRef.current;
    switch (action) {
      case 'new':
        await createDocument();
        break;
      case 'download':
        downloadMarkdown();
        break;
      case 'duplicate':
        await duplicateDocument();
        break;
      case 'delete':
        deleteDocument();
        break;
      case 'undo':
      case 'redo':
        textarea?.focus();
        window.document.execCommand(action);
        break;
      case 'select-all':
        textarea?.focus();
        textarea?.select();
        break;
      case 'word-count': {
        const words = (editor.content || '').trim().split(/\s+/).filter(Boolean).length;
        window.showToast?.(`${words} word${words === 1 ? '' : 's'} in this document.`, false);
        break;
      }
      case 'date':
        insertAtCursor(new Date().toLocaleString());
        break;
      case 'link':
        insertAtCursor('[link text](https://)', 1, 9);
        break;
      case 'table':
        insertAtCursor('\n| Column | Column |\n| --- | --- |\n| Value | Value |\n');
        break;
      case 'divider':
        insertAtCursor('\n\n---\n\n');
        break;
      case 'quote':
      case 'code':
      case 'heading':
      case 'bold':
      case 'italic':
      case 'bullet':
        formatSelection(action);
        break;
      default:
        window.showToast?.('That document command is not available yet.');
    }
  };

  const docsMenus = {
    File: [
      ['new', 'New document'],
      ['duplicate', 'Duplicate'],
      ['download', 'Download Markdown'],
      ['delete', 'Delete document'],
    ],
    Edit: [
      ['undo', 'Undo'],
      ['redo', 'Redo'],
      ['select-all', 'Select all'],
    ],
    View: [
      ['word-count', 'Word count'],
    ],
    Insert: [
      ['date', 'Date / time'],
      ['link', 'Link'],
      ['table', 'Table'],
      ['divider', 'Divider'],
    ],
    Format: [
      ['heading', 'Heading'],
      ['bold', 'Bold'],
      ['italic', 'Italic'],
      ['bullet', 'Bullet list'],
      ['quote', 'Quote'],
      ['code', 'Inline code'],
    ],
  };

  const closeEditor = () => {
    window.clearTimeout(saveTimer.current);
    if (dirty.current) saveDocument(editor);
    dirty.current = false;
    setDeleteConfirmOpen(false);
    setActiveId(null);
  };

  const deleteDocument = async () => {
    if (!activeId || deletingDocument) return;
    const allowed = await docsAllowed(roomId, user);
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteDocument = async () => {
    if (!activeId || deletingDocument) return;
    const id = activeId;
    const allowed = await docsAllowed(roomId, user);
    if (!allowed) {
      setDeleteConfirmOpen(false);
      window.showToast?.('Docs editing is disabled in this room.');
      return;
    }
    setDeletingDocument(true);
    try {
      window.clearTimeout(saveTimer.current);
      dirty.current = false;
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

  if (activeId) {
    return (
      <div id="docs-editor-view" className="docs-google-editor">
        <header className="docs-file-bar">
          <div className="docs-file-left">
            <button type="button" className="docs-icon-btn docs-back-btn" id="doc-back-btn" onClick={closeEditor} aria-label="Back to documents">
              <i className="ph-bold ph-arrow-left" />
            </button>
            <span className="docs-file-icon" aria-hidden="true">{editor.emoji || '📄'}</span>
            <div className="docs-title-stack">
              <input id="doc-title-input" value={editor.title} onChange={(event) => editDocument('title', event.target.value)} placeholder="Untitled document" aria-label="Document title" />
              <div className="docs-meta-line">
                <span className="doc-save-status" id="doc-save-status">{saveStatus}</span>
                <span className="doc-collaborators" title="Real-time co-authors">
                  <i className="ph-bold ph-users-three" />
                  {collaborators.length ? collaborators.map((entry) => <span key={entry.uid}>{entry.name || 'Someone'}</span>) : <span>Just you</span>}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="docs-icon-btn danger" id="doc-delete-btn" aria-label="Delete document" onClick={deleteDocument}><i className="ph-bold ph-trash" /></button>
        </header>

        <div className="docs-editor-bar docs-google-toolbar">
          <div className="docs-menu-row" aria-label="Document menus">
            {Object.entries(docsMenus).map(([menu, items]) => (
              <div className="docs-menu" key={menu}>
                <button
                  type="button"
                  aria-expanded={openMenu === menu}
                  onClick={() => setOpenMenu((current) => (current === menu ? null : menu))}
                >
                  {menu}
                </button>
                {openMenu === menu ? (
                  <div className="docs-menu-popover" role="menu">
                    {items.map(([action, label]) => (
                      <button key={action} type="button" role="menuitem" onClick={() => runDocMenuAction(action)}>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="docs-toolbar-menu" aria-label="Toolbar menu">
            <span>Toolbar</span>
            <button type="button" onClick={() => formatSelection('bold')}><strong>B</strong></button>
            <button type="button" onClick={() => formatSelection('italic')}><em>I</em></button>
            <button type="button" onClick={() => formatSelection('heading')}>H2</button>
            <button type="button" onClick={() => formatSelection('bullet')}>• List</button>
          </div>
          <label className="docs-format-menu">
            Format
            <select onChange={(event) => { if (event.target.value) formatSelection(event.target.value); event.target.value = ''; }} defaultValue="">
              <option value="" disabled>Choose…</option>
              <option value="heading">Heading</option>
              <option value="bold">Bold</option>
              <option value="italic">Italic</option>
              <option value="bullet">Bullet list</option>
              <option value="quote">Quote</option>
              <option value="code">Inline code</option>
            </select>
          </label>
          <div className="doc-emoji-pick" id="doc-emoji-pick" aria-label="Document icon">
            {emojis.map((emoji) => <button key={emoji} type="button" className={emoji === editor.emoji ? 'active' : ''} aria-label={`Use ${emoji}`} onClick={() => editDocument('emoji', emoji)}>{emoji}</button>)}
          </div>
        </div>
        {deleteConfirmOpen ? (
          <div className="docs-confirm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingDocument) setDeleteConfirmOpen(false); }}>
            <section className="docs-confirm-card" role="dialog" aria-modal="true" aria-labelledby="docs-delete-title">
              <div className="docs-confirm-icon"><i className="ph-bold ph-trash" /></div>
              <div className="docs-confirm-copy">
                <span className="docs-confirm-kicker">Delete document</span>
                <h3 id="docs-delete-title">Delete “{editor.title || 'Untitled'}”?</h3>
                <p>This removes the document for everyone in this room. This cannot be undone.</p>
              </div>
              <div className="docs-confirm-actions">
                <button type="button" className="docs-confirm-cancel" disabled={deletingDocument} onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
                <button type="button" className="docs-confirm-delete" disabled={deletingDocument} onClick={confirmDeleteDocument}>
                  {deletingDocument ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
        <div className="docs-editor-body">
          <section className="docs-page-shell" aria-label="Document page">
            <div className="docs-ruler" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, index) => <span key={index} />)}
            </div>
            <label className="docs-tags-field">
              <span>Tags</span>
              <input id="doc-tags-input" value={editor.tags} onChange={(event) => editDocument('tags', event.target.value)} placeholder="project, notes, decisions" aria-label="Document tags" />
            </label>
            <textarea id="doc-content-input" ref={contentRef} value={editor.content} onChange={(event) => editDocument('content', event.target.value)} placeholder="Start writing... everyone in the room sees changes live." aria-label="Document content" />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div id="docs-list-view">
      <div className="docs-toolbar">
        <input id="docs-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search docs..." aria-label="Search documents" />
        <button type="button" className="docs-new-btn" id="docs-new-btn" onClick={createDocument}><i className="ph-bold ph-plus" /> New doc</button>
      </div>
      <div className="docs-tags" id="docs-tags">
        {['all', ...tags].map((tag) => <button key={tag} type="button" className={`docs-tag-chip ${tag === activeTag ? 'active' : ''}`} onClick={() => setActiveTag(tag)}>{tag === 'all' ? 'All' : tag}</button>)}
      </div>
      <div className="docs-grid" id="docs-grid">
        {filteredDocuments.length ? filteredDocuments.map((document) => <DocumentCard key={document.id} document={document} onOpen={openDocument} />) : <div className="docs-empty">No documents yet. Click “New doc” to start one.</div>}
      </div>
    </div>
  );
}
