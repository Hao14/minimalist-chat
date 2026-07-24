import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';
import {
  FONT_OPTIONS,
  contentToEditorHtml,
  contentToPlainText,
  editorHtmlToContent,
  sanitizeEditorHtml,
} from './richTextDocument.js';

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'TD', 'TH']);

const EMPTY_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  ordered: false,
  unordered: false,
  justify: 'left',
  block: 'p',
  font: 'Inter',
  fontSize: 11,
};

function ToolbarButton({ label, icon, active = false, disabled = false, children, onClick, className = '' }) {
  return (
    <button
      type="button"
      className={`docs-command-btn ${active ? 'is-active' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon ? <i className={`ph-bold ${icon}`} aria-hidden="true" /> : children}
    </button>
  );
}

function ColorPalette({ label, icon, current, disabled, onSelect }) {
  return (
    <label className="docs-color-control" title={label}>
      <i className={`ph-bold ${icon}`} aria-hidden="true" />
      <input type="color" value={current} disabled={disabled} aria-label={label} onChange={(event) => onSelect(event.target.value)} />
      <span className="docs-color-indicator" style={{ background: current }} aria-hidden="true" />
    </label>
  );
}

function AvatarStack({ collaborators, currentUser }) {
  const entries = useMemo(() => {
    const me = currentUser?.uid ? [{
      uid: currentUser.uid,
      name: currentUser.displayName || 'You',
      photoUrl: currentUser.photoUrl || '',
      me: true,
    }] : [];
    const others = collaborators
      .filter((entry) => entry.uid !== currentUser?.uid)
      .map((entry) => ({ ...entry, me: false }));
    return [...me, ...others];
  }, [collaborators, currentUser]);
  const visible = entries.slice(0, 3);
  const overflow = Math.max(0, entries.length - visible.length);

  return (
    <div className="docs-avatar-stack" aria-label={`${entries.length || 1} person${entries.length === 1 ? '' : 's'} present`}>
      {visible.map((entry, index) => (
        <span
          key={entry.uid}
          className="docs-avatar"
          style={{ '--avatar-index': index }}
          title={entry.me ? 'You' : entry.name || 'Room member'}
        >
          {normalizeStoredAvatarUrl(entry.photoUrl) ? <img src={normalizeStoredAvatarUrl(entry.photoUrl)} alt="" referrerPolicy="no-referrer" /> : (entry.name || 'R').slice(0, 1).toUpperCase()}
        </span>
      ))}
      {overflow ? <span className="docs-avatar docs-avatar-more">+{overflow}</span> : null}
    </div>
  );
}

function selectionInside(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer);
}

function closestBlock(node, editor) {
  let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (current && current !== editor) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return editor;
}

function selectedBlocks(editor, range) {
  const blocks = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;
      try {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      } catch {
        return NodeFilter.FILTER_SKIP;
      }
    },
  });
  while (walker.nextNode()) blocks.push(walker.currentNode);
  if (!blocks.length) blocks.push(closestBlock(range.startContainer, editor));
  return [...new Set(blocks)].filter((block) => block && block !== editor);
}

function safeExternalUrl(raw, { image = false } = {}) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
    const parsed = new URL(withProtocol);
    if (image && !['http:', 'https:'].includes(parsed.protocol)) return '';
    if (!image && !['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function updateEditorEmptyState(element) {
  if (!element) return;
  const hasEmbeddedContent = Boolean(element.querySelector('img, table, hr, input[type="checkbox"]'));
  const hasText = Boolean((element.textContent || '').replace(/\u200b/g, '').trim());
  element.dataset.empty = hasText || hasEmbeddedContent ? 'false' : 'true';
}

export function RichTextEditor({
  documentId,
  editor,
  canEdit,
  permissionLoading,
  saveStatus,
  collaborators,
  user,
  deletingDocument,
  deleteConfirm,
  onChange,
  onClose,
  onCreate,
  onDuplicate,
  onDownload,
  onDelete,
}) {
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const savedRangeRef = useRef(null);
  const lastEmittedContentRef = useRef(null);
  const [openMenu, setOpenMenu] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [activePopover, setActivePopover] = useState('');
  const [toolbarState, setToolbarState] = useState(EMPTY_TOOLBAR_STATE);
  const [textColor, setTextColor] = useState('#111827');
  const [highlightColor, setHighlightColor] = useState('#FFF2A8');
  const [pageZoom, setPageZoom] = useState(1);
  const [showRuler, setShowRuler] = useState(true);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [imageUrl, setImageUrl] = useState('https://');
  const [imageAlt, setImageAlt] = useState('');
  const [commentText, setCommentText] = useState('');
  const [tableSize, setTableSize] = useState({ rows: 3, columns: 3 });
  const emojis = ['📄', '📝', '☕', '🧘', '🌅', '📌', '💡', '🚀', '🔬', '📚'];
  const plainText = useMemo(() => contentToPlainText(editor.content), [editor.content]);
  const wordCount = useMemo(() => plainText.split(/\s+/).filter(Boolean).length, [plainText]);
  const characterCount = plainText.length;
  const otherPresenceCount = collaborators.filter((entry) => entry.uid !== user?.uid).length;

  const emitContent = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    updateEditorEmptyState(element);
    const nextContent = editorHtmlToContent(element.innerHTML);
    lastEmittedContentRef.current = nextContent;
    onChange('content', nextContent);
  }, [onChange]);

  const updateToolbarState = useCallback(() => {
    const element = contentRef.current;
    if (!element || !selectionInside(element)) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const block = closestBlock(anchor, element);
    const blockName = block?.tagName?.toLowerCase() || 'p';
    const fontValue = String(document.queryCommandValue('fontName') || 'Inter').replace(/["']/g, '').split(',')[0];
    const justify = document.queryCommandState('justifyCenter') ? 'center'
      : document.queryCommandState('justifyRight') ? 'right'
        : document.queryCommandState('justifyFull') ? 'justify' : 'left';
    setToolbarState((current) => ({
      ...current,
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      ordered: document.queryCommandState('insertOrderedList'),
      unordered: document.queryCommandState('insertUnorderedList'),
      justify,
      block: blockName,
      font: FONT_OPTIONS.includes(fontValue) ? fontValue : current.font,
    }));
  }, []);

  const captureRange = useCallback(() => {
    const element = contentRef.current;
    const selection = window.getSelection();
    if (!element || !selection?.rangeCount || !selectionInside(element)) return;
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    updateToolbarState();
  }, [updateToolbarState]);

  const restoreRange = useCallback(() => {
    const element = contentRef.current;
    if (!element) return false;
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    if (savedRangeRef.current && element.contains(savedRangeRef.current.commonAncestorContainer)) {
      selection.addRange(savedRangeRef.current);
      return true;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
    return true;
  }, []);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    if (lastEmittedContentRef.current === editor.content) return;
    element.innerHTML = contentToEditorHtml(editor.content);
    updateEditorEmptyState(element);
    lastEmittedContentRef.current = editor.content;
  }, [documentId, editor.content]);

  useEffect(() => {
    const handleSelectionChange = () => captureRange();
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [captureRange]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpenMenu('');
      setEmojiOpen(false);
      setActivePopover('');
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  const afterCommand = useCallback(() => {
    emitContent();
    window.requestAnimationFrame(() => {
      captureRange();
      updateToolbarState();
    });
  }, [captureRange, emitContent, updateToolbarState]);

  const runCommand = useCallback((command, value = null) => {
    if (!canEdit || !restoreRange()) return;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, value);
    afterCommand();
  }, [afterCommand, canEdit, restoreRange]);

  const applyBlock = useCallback((tag) => {
    runCommand('formatBlock', `<${tag}>`);
    setToolbarState((current) => ({ ...current, block: tag }));
  }, [runCommand]);

  const applyFontSize = useCallback((requestedSize) => {
    const size = Math.max(8, Math.min(72, Number(requestedSize) || 11));
    if (!canEdit || !restoreRange()) return;
    document.execCommand('fontSize', false, '7');
    contentRef.current?.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = `${size}pt`;
      span.append(...font.childNodes);
      font.replaceWith(span);
    });
    setToolbarState((current) => ({ ...current, fontSize: size }));
    afterCommand();
  }, [afterCommand, canEdit, restoreRange]);

  const applyBlockStyle = useCallback((property, value) => {
    if (!canEdit || !restoreRange()) return;
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    selectedBlocks(contentRef.current, range).forEach((block) => {
      block.style[property] = value;
    });
    afterCommand();
  }, [afterCommand, canEdit, restoreRange]);

  const insertHtml = useCallback((html) => {
    if (!canEdit || !restoreRange()) return;
    document.execCommand('insertHTML', false, sanitizeEditorHtml(html));
    afterCommand();
  }, [afterCommand, canEdit, restoreRange]);

  const insertChecklist = useCallback(() => {
    insertHtml('<div class="docs-check-item"><input type="checkbox" contenteditable="false" aria-label="Checklist item"><span>Checklist item</span></div><p><br></p>');
  }, [insertHtml]);

  const applyLink = () => {
    const url = safeExternalUrl(linkUrl);
    if (!url) {
      window.showToast?.('Enter a valid web or email link.');
      return;
    }
    if (!canEdit || !restoreRange()) return;
    const selection = window.getSelection();
    if (selection.isCollapsed) document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
    else document.execCommand('createLink', false, url);
    setActivePopover('');
    afterCommand();
  };

  const insertImage = () => {
    const url = safeExternalUrl(imageUrl, { image: true });
    if (!url) {
      window.showToast?.('Enter a valid http or https image URL.');
      return;
    }
    insertHtml(`<p><img src="${url}" alt="${String(imageAlt || '').replace(/[<>"']/g, '')}"></p><p><br></p>`);
    setActivePopover('');
  };

  const insertTable = () => {
    const rows = Math.max(1, Math.min(10, Number(tableSize.rows) || 3));
    const columns = Math.max(1, Math.min(8, Number(tableSize.columns) || 3));
    const header = `<tr>${Array.from({ length: columns }, (_, index) => `<th>Column ${index + 1}</th>`).join('')}</tr>`;
    const body = Array.from({ length: Math.max(0, rows - 1) }, () => `<tr>${Array.from({ length: columns }, () => '<td><br></td>').join('')}</tr>`).join('');
    insertHtml(`<table><thead>${header}</thead><tbody>${body}</tbody></table><p><br></p>`);
    setActivePopover('');
  };

  const addComment = () => {
    const comment = String(commentText || '').trim();
    if (!comment) {
      window.showToast?.('Write a comment first.');
      return;
    }
    if (!canEdit || !restoreRange()) return;
    const selection = window.getSelection();
    if (selection.isCollapsed) {
      window.showToast?.('Select text to comment on.');
      return;
    }
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.className = 'docs-inline-comment';
    span.dataset.comment = comment.slice(0, 500);
    span.title = `Comment: ${comment.slice(0, 500)}`;
    try {
      range.surroundContents(span);
    } catch {
      span.append(range.extractContents());
      range.insertNode(span);
    }
    setCommentText('');
    setActivePopover('');
    afterCommand();
  };

  const printDocument = () => {
    const content = sanitizeEditorHtml(contentRef.current?.innerHTML || '');
    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'Print document');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    if (!frameDocument) {
      frame.remove();
      window.showToast?.('Printing is not available in this browser.');
      return;
    }
    frameDocument.open();
    frameDocument.write('<!doctype html><html><head></head><body></body></html>');
    frameDocument.close();
    frameDocument.title = String(editor.title || 'Untitled document');
    const printStyle = frameDocument.createElement('style');
    printStyle.textContent = 'body{font:11pt Arial,sans-serif;color:#111827;margin:.8in;line-height:1.55}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px}.docs-check-item{display:flex;gap:8px;align-items:flex-start}';
    frameDocument.head.append(printStyle);
    const contentTemplate = frameDocument.createElement('template');
    contentTemplate.innerHTML = content;
    frameDocument.body.append(contentTemplate.content.cloneNode(true));
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 800);
    }, 100);
  };

  const showWordCount = () => window.showToast?.(`${wordCount} word${wordCount === 1 ? '' : 's'} · ${characterCount} characters`, false);

  const runMenuAction = async (action) => {
    setOpenMenu('');
    switch (action) {
      case 'new': await onCreate(); break;
      case 'duplicate': await onDuplicate(); break;
      case 'download': onDownload(); break;
      case 'print': printDocument(); break;
      case 'delete': onDelete(); break;
      case 'undo': runCommand('undo'); break;
      case 'redo': runCommand('redo'); break;
      case 'select-all': {
        contentRef.current?.focus();
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        captureRange();
        break;
      }
      case 'word-count': showWordCount(); break;
      case 'toggle-ruler': setShowRuler((value) => !value); break;
      case 'zoom-in': setPageZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(1)))); break;
      case 'zoom-out': setPageZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(1)))); break;
      case 'zoom-reset': setPageZoom(1); break;
      case 'date': insertHtml(`<p>${new Date().toLocaleString()}</p>`); break;
      case 'link': captureRange(); setActivePopover('link'); break;
      case 'image': captureRange(); setActivePopover('image'); break;
      case 'comment': captureRange(); setActivePopover('comment'); break;
      case 'table': captureRange(); setActivePopover('table'); break;
      case 'checklist': insertChecklist(); break;
      case 'divider': insertHtml('<hr><p><br></p>'); break;
      case 'quote': applyBlock('blockquote'); break;
      case 'code-block': applyBlock('pre'); break;
      case 'normal': applyBlock('p'); break;
      case 'h1': applyBlock('h1'); break;
      case 'h2': applyBlock('h2'); break;
      case 'h3': applyBlock('h3'); break;
      case 'bold': runCommand('bold'); break;
      case 'italic': runCommand('italic'); break;
      case 'underline': runCommand('underline'); break;
      case 'strike': runCommand('strikeThrough'); break;
      case 'subscript': runCommand('subscript'); break;
      case 'superscript': runCommand('superscript'); break;
      case 'clear': runCommand('removeFormat'); break;
      default: break;
    }
  };

  const menus = {
    File: [
      ['new', 'New document'], ['duplicate', 'Duplicate'], ['download', 'Download Markdown'], ['print', 'Print'], ['delete', 'Delete document'],
    ],
    Edit: [['undo', 'Undo'], ['redo', 'Redo'], ['select-all', 'Select all']],
    View: [['word-count', 'Word count'], ['toggle-ruler', showRuler ? 'Hide ruler' : 'Show ruler'], ['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['zoom-reset', 'Reset zoom']],
    Insert: [['link', 'Link'], ['comment', 'Comment'], ['image', 'Image by URL'], ['table', 'Table'], ['checklist', 'Checklist'], ['date', 'Date / time'], ['divider', 'Divider']],
    Format: [['normal', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['quote', 'Quote'], ['code-block', 'Code block'], ['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline'], ['strike', 'Strikethrough'], ['clear', 'Clear formatting']],
  };

  const disabledMenuActions = new Set(['new', 'duplicate', 'delete', 'undo', 'redo', 'link', 'comment', 'image', 'table', 'checklist', 'date', 'divider', 'quote', 'code-block', 'normal', 'h1', 'h2', 'h3', 'bold', 'italic', 'underline', 'strike', 'clear']);
  const formattingDisabled = permissionLoading || !canEdit;
  const currentBlock = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(toolbarState.block) ? toolbarState.block : 'p';
  const blockLabels = { p: 'Normal text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', blockquote: 'Quote', pre: 'Code block' };

  const handleEditorKeyDown = (event) => {
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      captureRange();
      setActivePopover('link');
      return;
    }
    if (commandKey && event.shiftKey && event.key === '7') {
      event.preventDefault();
      runCommand('insertOrderedList');
      return;
    }
    if (commandKey && event.shiftKey && event.key === '8') {
      event.preventDefault();
      runCommand('insertUnorderedList');
      return;
    }
    if (commandKey && event.key === '\\') {
      event.preventDefault();
      runCommand('removeFormat');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      runCommand(event.shiftKey ? 'outdent' : 'indent');
    }
  };

  const handlePaste = (event) => {
    if (!canEdit) return;
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    restoreRange();
    if (html) document.execCommand('insertHTML', false, sanitizeEditorHtml(html));
    else document.execCommand('insertText', false, text);
    afterCommand();
  };

  const handleEditorClick = (event) => {
    const checkbox = event.target.closest?.('input[type="checkbox"]');
    if (!checkbox) return;
    if (!canEdit) {
      event.preventDefault();
      return;
    }
    if (checkbox.checked) checkbox.setAttribute('checked', '');
    else checkbox.removeAttribute('checked');
    emitContent();
  };

  return (
    <div id="docs-editor-view" className="docs-rich-editor" ref={rootRef}>
      <header className="docs-file-bar">
        <div className="docs-file-left">
          <button type="button" className="docs-icon-btn docs-back-btn" onClick={onClose} aria-label="Back to documents"><i className="ph-bold ph-arrow-left" /></button>
          <div className="docs-emoji-control">
            <button type="button" className="docs-file-icon" aria-label="Choose document icon" aria-expanded={emojiOpen} disabled={!canEdit} onClick={() => setEmojiOpen((value) => !value)}>
              <span aria-hidden="true">{editor.emoji || '📄'}</span><i className="ph-bold ph-caret-down" aria-hidden="true" />
            </button>
            {emojiOpen ? (
              <div className="docs-emoji-popover" role="menu" aria-label="Document icon">
                {emojis.map((emoji) => <button key={emoji} type="button" className={emoji === editor.emoji ? 'is-active' : ''} aria-label={`Use ${emoji}`} onClick={() => { onChange('emoji', emoji); setEmojiOpen(false); }}>{emoji}</button>)}
              </div>
            ) : null}
          </div>
          <div className="docs-title-stack">
            <input id="doc-title-input" value={editor.title} maxLength={180} onChange={(event) => onChange('title', event.target.value)} placeholder="Untitled document" aria-label="Document title" readOnly={!canEdit} />
            <div className="docs-meta-line">
              <span className={`doc-save-status is-${saveStatus.toLowerCase().replace(/[^a-z]+/g, '-')}`} role="status" aria-live="polite" aria-atomic="true">{saveStatus}</span>
              <span className="docs-presence-label"><i className="ph-bold ph-circle" aria-hidden="true" /> {otherPresenceCount ? `${otherPresenceCount} other ${otherPresenceCount === 1 ? 'person' : 'people'} present` : 'No one else present'}</span>
            </div>
          </div>
        </div>
        <div className="docs-file-actions">
          <AvatarStack collaborators={collaborators} currentUser={user} />
          <button type="button" className="docs-icon-btn danger" aria-label="Delete document" disabled={!canEdit || deletingDocument} onClick={onDelete}><i className="ph-bold ph-trash" /></button>
        </div>
      </header>

      <div className="docs-command-surface">
        <div className="docs-menu-strip" aria-label="Document menus">
          <div className="docs-menu-row">
            {Object.entries(menus).map(([menu, items]) => (
              <div className="docs-menu" key={menu}>
                <button type="button" aria-expanded={openMenu === menu} onClick={() => { setOpenMenu((current) => current === menu ? '' : menu); setActivePopover(''); }}>{menu}</button>
                {openMenu === menu ? (
                  <div className="docs-menu-popover" role="menu">
                    {items.map(([action, label]) => {
                      const disabled = !canEdit && disabledMenuActions.has(action);
                      return <button key={action} type="button" role="menuitem" disabled={disabled} onClick={() => runMenuAction(action)}>{label}</button>;
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <span className="docs-live-copy"><i className="ph-bold ph-cloud-check" /> Shared in this room</span>
        </div>

        <div className="docs-format-toolbar" role="toolbar" aria-label="Text formatting">
          <div className="docs-toolbar-scroll">
          <div className="docs-toolbar-group">
            <ToolbarButton label="Undo" icon="ph-arrow-counter-clockwise" disabled={formattingDisabled} onClick={() => runCommand('undo')} />
            <ToolbarButton label="Redo" icon="ph-arrow-clockwise" disabled={formattingDisabled} onClick={() => runCommand('redo')} />
            <ToolbarButton label="Print" icon="ph-printer" onClick={printDocument} />
          </div>
          <div className="docs-toolbar-group docs-toolbar-selects">
            <label className="docs-toolbar-select docs-block-select">
              <span className="sr-only">Paragraph style</span>
              <select value={currentBlock} disabled={formattingDisabled} onChange={(event) => applyBlock(event.target.value)}>
                {Object.entries(blockLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="docs-toolbar-select docs-font-select">
              <span className="sr-only">Font</span>
              <select value={toolbarState.font} disabled={formattingDisabled} onChange={(event) => { runCommand('fontName', event.target.value); setToolbarState((current) => ({ ...current, font: event.target.value })); }}>
                {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>
            <div className="docs-font-size" aria-label="Font size">
              <ToolbarButton label="Decrease font size" icon="ph-minus" disabled={formattingDisabled} onClick={() => applyFontSize(toolbarState.fontSize - 1)} />
              <input type="number" min="8" max="72" value={toolbarState.fontSize} disabled={formattingDisabled} aria-label="Font size" onChange={(event) => setToolbarState((current) => ({ ...current, fontSize: Number(event.target.value) || 11 }))} onBlur={(event) => applyFontSize(event.target.value)} />
              <ToolbarButton label="Increase font size" icon="ph-plus" disabled={formattingDisabled} onClick={() => applyFontSize(toolbarState.fontSize + 1)} />
            </div>
          </div>
          <div className="docs-toolbar-group">
            <ToolbarButton label="Bold" active={toolbarState.bold} disabled={formattingDisabled} onClick={() => runCommand('bold')}><strong>B</strong></ToolbarButton>
            <ToolbarButton label="Italic" active={toolbarState.italic} disabled={formattingDisabled} onClick={() => runCommand('italic')}><em>I</em></ToolbarButton>
            <ToolbarButton label="Underline" active={toolbarState.underline} disabled={formattingDisabled} onClick={() => runCommand('underline')}><u>U</u></ToolbarButton>
            <ToolbarButton label="Strikethrough" active={toolbarState.strike} disabled={formattingDisabled} onClick={() => runCommand('strikeThrough')}><s>S</s></ToolbarButton>
            <ColorPalette label="Text color" icon="ph-text-aa" current={textColor} disabled={formattingDisabled} onSelect={(value) => { setTextColor(value); runCommand('foreColor', value); }} />
            <ColorPalette label="Highlight color" icon="ph-highlighter-circle" current={highlightColor} disabled={formattingDisabled} onSelect={(value) => { setHighlightColor(value); runCommand('hiliteColor', value); }} />
          </div>
          <div className="docs-toolbar-group">
            <ToolbarButton label="Insert link" icon="ph-link" disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover('link'); }} />
            <ToolbarButton label="Add comment" icon="ph-chat-circle" disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover('comment'); }} />
            <ToolbarButton label="Insert image" icon="ph-image" disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover('image'); }} />
          </div>
          <div className="docs-toolbar-group">
            <ToolbarButton label={`Align ${toolbarState.justify}`} icon={`ph-text-align-${toolbarState.justify === 'justify' ? 'justify' : toolbarState.justify}`} active={activePopover === 'align'} disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover((value) => value === 'align' ? '' : 'align'); }} />
            <ToolbarButton label="Line spacing" icon="ph-arrows-vertical" active={activePopover === 'spacing'} disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover((value) => value === 'spacing' ? '' : 'spacing'); }} />
            <ToolbarButton label="Checklist" icon="ph-list-checks" disabled={formattingDisabled} onClick={insertChecklist} />
            <ToolbarButton label="Bulleted list" icon="ph-list-bullets" active={toolbarState.unordered} disabled={formattingDisabled} onClick={() => runCommand('insertUnorderedList')} />
            <ToolbarButton label="Numbered list" icon="ph-list-numbers" active={toolbarState.ordered} disabled={formattingDisabled} onClick={() => runCommand('insertOrderedList')} />
            <ToolbarButton label="Decrease indent" icon="ph-text-outdent" disabled={formattingDisabled} onClick={() => runCommand('outdent')} />
            <ToolbarButton label="Increase indent" icon="ph-text-indent" disabled={formattingDisabled} onClick={() => runCommand('indent')} />
            <ToolbarButton label="Clear formatting" icon="ph-eraser" disabled={formattingDisabled} onClick={() => runCommand('removeFormat')} />
            <ToolbarButton label="More formatting" icon="ph-dots-three" active={activePopover === 'more'} disabled={formattingDisabled} onClick={() => { captureRange(); setActivePopover((value) => value === 'more' ? '' : 'more'); }} />
          </div>
          </div>

          {activePopover === 'align' ? (
            <div className="docs-inline-popover docs-compact-popover" role="menu" aria-label="Text alignment">
              {[['left', 'ph-text-align-left'], ['center', 'ph-text-align-center'], ['right', 'ph-text-align-right'], ['justify', 'ph-text-align-justify']].map(([alignment, icon]) => (
                <ToolbarButton key={alignment} label={`Align ${alignment}`} icon={icon} active={toolbarState.justify === alignment} onClick={() => { runCommand(alignment === 'justify' ? 'justifyFull' : `justify${alignment[0].toUpperCase()}${alignment.slice(1)}`); setActivePopover(''); }} />
              ))}
            </div>
          ) : null}
          {activePopover === 'spacing' ? (
            <div className="docs-inline-popover docs-list-popover" role="menu" aria-label="Line spacing">
              {[1, 1.15, 1.5, 2].map((spacing) => <button key={spacing} type="button" onClick={() => { applyBlockStyle('lineHeight', String(spacing)); setActivePopover(''); }}>{spacing === 1 ? 'Single' : spacing === 2 ? 'Double' : String(spacing)}</button>)}
            </div>
          ) : null}
          {activePopover === 'more' ? (
            <div className="docs-inline-popover docs-list-popover" role="menu" aria-label="More formatting">
              <button type="button" onClick={() => runMenuAction('quote')}>Quote</button>
              <button type="button" onClick={() => runMenuAction('code-block')}>Code block</button>
              <button type="button" onClick={() => runMenuAction('superscript')}>Superscript</button>
              <button type="button" onClick={() => runMenuAction('subscript')}>Subscript</button>
              <button type="button" onClick={() => { applyBlockStyle('direction', 'ltr'); setActivePopover(''); }}>Left to right</button>
              <button type="button" onClick={() => { applyBlockStyle('direction', 'rtl'); setActivePopover(''); }}>Right to left</button>
              <button type="button" onClick={() => runMenuAction('clear')}>Clear formatting</button>
            </div>
          ) : null}
          {activePopover === 'link' ? (
            <div className="docs-inline-popover docs-form-popover" role="dialog" aria-label="Insert link">
              <label>Link URL<input autoFocus value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyLink(); }} /></label>
              <div><button type="button" onClick={() => { restoreRange(); runCommand('unlink'); setActivePopover(''); }}>Remove link</button><button type="button" className="primary" onClick={applyLink}>Apply</button></div>
            </div>
          ) : null}
          {activePopover === 'comment' ? (
            <div className="docs-inline-popover docs-form-popover" role="dialog" aria-label="Add comment">
              <label>Comment<textarea autoFocus value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add context for collaborators…" /></label>
              <div><button type="button" onClick={() => setActivePopover('')}>Cancel</button><button type="button" className="primary" onClick={addComment}>Comment</button></div>
            </div>
          ) : null}
          {activePopover === 'image' ? (
            <div className="docs-inline-popover docs-form-popover" role="dialog" aria-label="Insert image">
              <label>Image URL<input autoFocus value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} /></label>
              <label>Alt text<input value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} placeholder="Describe this image" /></label>
              <div><button type="button" onClick={() => setActivePopover('')}>Cancel</button><button type="button" className="primary" onClick={insertImage}>Insert</button></div>
            </div>
          ) : null}
          {activePopover === 'table' ? (
            <div className="docs-inline-popover docs-form-popover" role="dialog" aria-label="Insert table">
              <div className="docs-table-size-fields">
                <label>Rows<input type="number" min="1" max="10" value={tableSize.rows} onChange={(event) => setTableSize((current) => ({ ...current, rows: event.target.value }))} /></label>
                <label>Columns<input type="number" min="1" max="8" value={tableSize.columns} onChange={(event) => setTableSize((current) => ({ ...current, columns: event.target.value }))} /></label>
              </div>
              <div><button type="button" onClick={() => setActivePopover('')}>Cancel</button><button type="button" className="primary" onClick={insertTable}>Insert table</button></div>
            </div>
          ) : null}
        </div>
      </div>

      {!permissionLoading && !canEdit ? <div className="docs-permission-note" role="note"><i className="ph-bold ph-lock-key" /> Read-only — ask a room manager to enable Docs editing.</div> : null}
      {deleteConfirm}

      <div className="docs-editor-body">
        <section className="docs-page-viewport" aria-label="Document page" style={{ '--docs-page-zoom': pageZoom }}>
          {showRuler ? <div className="docs-ruler" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={index} />)}</div> : null}
          <div className="docs-page-shell">
            <label className="docs-tags-field"><span>Tags</span><input id="doc-tags-input" value={editor.tags} maxLength={512} onChange={(event) => onChange('tags', event.target.value)} placeholder="Add tags…" aria-label="Document tags (32 characters per tag)" readOnly={!canEdit} /></label>
            <div
              id="doc-content-input"
              ref={contentRef}
              className={`docs-rich-content ${canEdit ? '' : 'is-readonly'}`}
              contentEditable={canEdit}
              suppressContentEditableWarning
              role="textbox"
              aria-label="Document content"
              aria-multiline="true"
              data-placeholder="Start writing… changes save to this room."
              spellCheck
              onInput={emitContent}
              onPaste={handlePaste}
              onKeyDown={handleEditorKeyDown}
              onClick={handleEditorClick}
              onKeyUp={captureRange}
              onMouseUp={captureRange}
            />
          </div>
        </section>
      </div>

      <footer className="docs-status-bar">
        <div><span>Words: {wordCount}</span><span>Characters: {characterCount}</span></div>
        <div><button type="button" onClick={() => setPageZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(1))))} aria-label="Zoom out"><i className="ph-bold ph-minus" /></button><button type="button" onClick={() => setPageZoom(1)}>{Math.round(pageZoom * 100)}%</button><button type="button" onClick={() => setPageZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(1))))} aria-label="Zoom in"><i className="ph-bold ph-plus" /></button><span>Page 1 of 1</span></div>
      </footer>
    </div>
  );
}
