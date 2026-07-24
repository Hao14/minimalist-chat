function handleMessageMenuKeyDown(event, onClose) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose({ restoreFocus: true });
    return;
  }

  const items = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)'));
  const currentIndex = items.indexOf(document.activeElement);
  if (currentIndex < 0 || items.length < 2) return;

  let nextIndex = null;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}

const dialogFocusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function handleModalKeyDown(event, onClose) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = Array.from(event.currentTarget.querySelectorAll(dialogFocusableSelector))
    .filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const bookmarkOpenButtonStyle = {
  appearance: 'none',
  background: 'transparent',
  border: 0,
  boxShadow: 'none',
  color: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  flex: '1 1 auto',
  alignItems: 'center',
  gap: '0.6rem',
  font: 'inherit',
  margin: 0,
  minWidth: 0,
  padding: 0,
  textAlign: 'left',
  textTransform: 'none',
  width: 'auto',
};

const bookmarkTextStyle = { display: 'block' };

export function MessageMenu({ menu, onAction, onClose }) {
  if (!menu?.open) return null;

  return (
    <div
      id="msg-menu"
      className="msg-menu"
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => handleMessageMenuKeyDown(event, onClose)}
      role="menu"
      aria-label="Message actions"
    >
      {menu.canEdit ? (
        <button type="button" role="menuitem" autoFocus onClick={() => onAction('edit')}>
          <i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit message
        </button>
      ) : null}
      <button type="button" role="menuitem" autoFocus={!menu.canEdit} onClick={() => onAction('forward')}>
        <i className="ph-bold ph-share-fat" aria-hidden="true" /> Forward
      </button>
      <button type="button" role="menuitem" onClick={() => onAction('bookmark')}>
        <i className="ph-bold ph-bookmark-simple" aria-hidden="true" /> {menu.saved ? 'Remove from saved' : 'Save / bookmark'}
      </button>
      {menu.canFlag ? (
        <button type="button" role="menuitem" onClick={() => onAction('flag')}>
          <i className="ph-bold ph-flag" aria-hidden="true" /> {menu.important ? 'Unflag important' : 'Flag important'}
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => onAction('impact')}>
        <i className="ph-bold ph-fire" aria-hidden="true" /> View impact
      </button>
      {menu.canDelete ? <div className="msg-menu-divider" role="separator" /> : null}
      {menu.canDelete ? (
        <button className="msg-menu-danger" type="button" role="menuitem" onClick={() => onAction('delete')}>
          <i className="ph-bold ph-trash" aria-hidden="true" /> Delete message
        </button>
      ) : null}
    </div>
  );
}

export function ForwardModal({ forward, onClose, onForward }) {
  if (!forward?.open) return null;

  return (
    <div id="forward-modal" className="mt-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="mt-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-dialog-title"
        tabIndex={-1}
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
      >
        <div className="mt-head">
          <span id="forward-dialog-title">Forward to…</span>
          <button
            id="forward-close"
            type="button"
            onClick={onClose}
            aria-label="Close forward message dialog"
            autoFocus={forward.loading || !forward.rooms.length}
          >
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        </div>
        <div id="forward-list">
          {forward.loading ? <div className="mt-row" role="status">Loading rooms…</div> : null}
          {forward.rooms.map((room, index) => (
            <button className="mt-row" key={room.id} type="button" onClick={() => onForward(room.id)} autoFocus={!forward.loading && index === 0}>
              <i className="ph-bold ph-chats" aria-hidden="true" /> {room.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BookmarkCollectionDialog({ bookmarkPrompt, onClose, onSubmit }) {
  if (!bookmarkPrompt?.open) return null;

  return (
    <div className="mt-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        className="mt-box mt-bookmark-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmark-dialog-title"
        aria-describedby="bookmark-dialog-description"
        tabIndex={-1}
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          onSubmit(String(formData.get('collection') || 'Saved'));
        }}
      >
        <div className="mt-head">
          <span id="bookmark-dialog-title">Save message</span>
          <button type="button" onClick={onClose} aria-label="Close save message dialog">
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-bookmark-form">
          <label htmlFor="bookmark-collection-input">Collection</label>
          <input
            id="bookmark-collection-input"
            name="collection"
            defaultValue="Saved"
            autoFocus
            maxLength={48}
            placeholder="Saved"
          />
          <p id="bookmark-dialog-description">Group saved messages by topic, project, or anything you like.</p>
        </div>
        <div className="mt-bookmark-actions">
          <button type="button" className="mt-row" onClick={onClose}>Cancel</button>
          <button type="submit" className="mt-row mt-row-primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function formatSavedTime(value) {
  if (!value) return 'Saved';
  return new Date(Number(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function BookmarkGroup({ group, onOpen, onRemove }) {
  return (
    <section className="mt-bookmark-group">
      <div className="mt-coll-title">
        <span><i className="ph-bold ph-folder-simple" aria-hidden="true" /> {group.name}</span>
        <strong>{group.items.length}</strong>
      </div>
      {group.items.map((bookmark) => (
        <div
          className="mt-bookmark mt-bookmark-card"
          key={bookmark.id}
        >
          <button
            type="button"
            style={bookmarkOpenButtonStyle}
            onClick={() => onOpen(bookmark)}
            aria-label={`Open saved message from ${bookmark.name || 'Someone'} in ${bookmark.roomName || 'room'}`}
          >
            <span className="mt-bookmark-mark" aria-hidden="true">
              {(bookmark.roomName || bookmark.name || 'S').charAt(0).toUpperCase()}
            </span>
            <span className="mt-bookmark-body">
              <span className="mt-bookmark-text" style={bookmarkTextStyle}>{bookmark.text || 'Saved message'}</span>
              <span className="mt-bookmark-sub">
                <span>{bookmark.name || 'Someone'}</span>
                <span>in {bookmark.roomName || 'room'}</span>
                <span>{formatSavedTime(bookmark.ts)}</span>
              </span>
            </span>
          </button>
          <button
            className="mt-bookmark-del"
            type="button"
            title="Remove saved message"
            aria-label={`Remove saved message from ${bookmark.name || 'Someone'} in ${bookmark.roomName || 'room'}`}
            onClick={() => onRemove(bookmark.id)}
          >
            <i className="ph-bold ph-trash" aria-hidden="true" />
          </button>
        </div>
      ))}
    </section>
  );
}

export function BookmarksPanel({ bookmarks, open, onClose, onOpenBookmark, onRemoveBookmark }) {
  if (!open) return null;

  const entries = Object.entries(bookmarks || {}).map(([id, bookmark]) => ({ id, ...bookmark }));
  const groups = entries
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .reduce((acc, bookmark) => {
      const name = bookmark.collection || 'Saved';
      if (!acc[name]) acc[name] = [];
      acc[name].push(bookmark);
      return acc;
    }, {});

  const groupEntries = Object.entries(groups).map(([name, items]) => ({ name, items }));

  return (
    <div id="bookmarks-panel" className="mt-side-panel mt-saved-panel" role="dialog" aria-labelledby="bookmarks-panel-title">
      <div className="mt-side-head">
        <div className="mt-side-title">
          <span id="bookmarks-panel-title"><i className="ph-bold ph-bookmark-simple" aria-hidden="true" /> Saved</span>
          <small>{entries.length ? `${entries.length} captured message${entries.length === 1 ? '' : 's'}` : 'Your private message shelf'}</small>
        </div>
        <button id="bookmarks-close" type="button" onClick={onClose} aria-label="Close saved messages">
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>
      </div>
      <div id="bookmarks-list">
        {groupEntries.length ? groupEntries.map((group) => (
          <BookmarkGroup
            group={group}
            key={group.name}
            onOpen={onOpenBookmark}
            onRemove={onRemoveBookmark}
          />
        )) : (
          <div className="mt-empty mt-saved-empty">
            <i className="ph-bold ph-bookmark-simple" aria-hidden="true" />
            <strong>Nothing saved yet</strong>
            <span>Use a message menu to save it, then jump back here whenever you need it.</span>
          </div>
        )}
      </div>
    </div>
  );
}
