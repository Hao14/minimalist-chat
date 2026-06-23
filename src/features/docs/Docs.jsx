import { useEffect, useMemo, useRef, useState } from 'react';
import { get, onDisconnect, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const emojis = ['📄', '📝', '☕', '🧘', '🌅', '📌', '💡', '🚀', '🔬', '📚'];
const emptyEditor = { title: '', content: '', emoji: '📄', tags: '' };

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
    const allowed = roomId === 'global' || (await get(ref(db, `rooms_meta/${roomId}/permissions/docs`)).catch(() => null))?.val() !== false;
    if (!allowed) return window.showToast?.('Docs editing is disabled in this room.');
    const now = timestamp();
    const document = { ...emptyEditor, tags: [], by: user.uid, byName: user.displayName, createdAt: now, updatedAt: now };
    const documentRef = push(ref(db, `room_docs/${roomId}`));
    await set(documentRef, document);
    window.awardXP?.(user.uid, 'technical', 5);
    window.awardXP?.(user.uid, 'creativity', 5);
    openDocument({ id: documentRef.key, ...document });
  };

  const saveDocument = async (nextEditor) => {
    if (!activeId) return;
    try {
      const allowed = roomId === 'global' || (await get(ref(db, `rooms_meta/${roomId}/permissions/docs`)).catch(() => null))?.val() !== false;
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

  const closeEditor = () => {
    window.clearTimeout(saveTimer.current);
    if (dirty.current) saveDocument(editor);
    dirty.current = false;
    setActiveId(null);
  };

  const deleteDocument = async () => {
    if (!activeId || !window.confirm('Delete this document for everyone?')) return;
    const id = activeId;
    setActiveId(null);
    dirty.current = false;
    await remove(ref(db, `room_docs/${roomId}/${id}`));
  };

  if (activeId) {
    return (
      <div id="docs-editor-view">
        <div className="docs-editor-bar">
          <button type="button" className="docs-icon-btn" id="doc-back-btn" onClick={closeEditor}><i className="ph-bold ph-arrow-left" /> Back</button>
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
          <div className="doc-collaborators" title="Real-time co-authors">
            <i className="ph-bold ph-users-three" />
            {collaborators.length ? collaborators.map((entry) => <span key={entry.uid}>{entry.name || 'Someone'}</span>) : <span>Just you</span>}
          </div>
          <span className="doc-save-status" id="doc-save-status">{saveStatus}</span>
          <button type="button" className="docs-icon-btn danger" id="doc-delete-btn" aria-label="Delete document" onClick={deleteDocument}><i className="ph-bold ph-trash" /></button>
        </div>
        <div className="docs-editor-body">
          <input id="doc-title-input" value={editor.title} onChange={(event) => editDocument('title', event.target.value)} placeholder="Untitled document" aria-label="Document title" />
          <input id="doc-tags-input" value={editor.tags} onChange={(event) => editDocument('tags', event.target.value)} placeholder="Tags (comma separated)" aria-label="Document tags" />
          <textarea id="doc-content-input" ref={contentRef} value={editor.content} onChange={(event) => editDocument('content', event.target.value)} placeholder="Start writing... everyone in the room sees changes live." aria-label="Document content" />
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
