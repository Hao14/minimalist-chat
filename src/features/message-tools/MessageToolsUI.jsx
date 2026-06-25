export function MessageMenu({ menu, onAction }) {
  if (!menu?.open) return null;

  return (
    <div
      id="msg-menu"
      className="msg-menu"
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => onAction('forward')}>
        <i className="ph-bold ph-share-fat" /> Forward
      </button>
      <button type="button" onClick={() => onAction('bookmark')}>
        <i className="ph-bold ph-bookmark-simple" /> {menu.saved ? 'Remove from saved' : 'Save / bookmark'}
      </button>
      {menu.canFlag ? (
        <button type="button" onClick={() => onAction('flag')}>
          <i className="ph-bold ph-flag" /> {menu.important ? 'Unflag important' : 'Flag important'}
        </button>
      ) : null}
      <button type="button" onClick={() => onAction('impact')}>
        <i className="ph-bold ph-fire" /> View impact
      </button>
    </div>
  );
}

export function ForwardModal({ forward, onClose, onForward }) {
  if (!forward?.open) return null;

  return (
    <div id="forward-modal" className="mt-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mt-box">
        <div className="mt-head">
          <span>Forward to…</span>
          <button id="forward-close" type="button" onClick={onClose}>✖</button>
        </div>
        <div id="forward-list">
          {forward.rooms.map((room) => (
            <button className="mt-row" key={room.id} type="button" onClick={() => onForward(room.id)}>
              <i className="ph-bold ph-chats" /> {room.name}
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
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          onSubmit(String(formData.get('collection') || 'Saved'));
        }}
      >
        <div className="mt-head">
          <span>Save message</span>
          <button type="button" onClick={onClose}>✖</button>
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
          <p>Group saved messages by topic, project, or anything you like.</p>
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
          role="button"
          tabIndex={0}
          onClick={() => onOpen(bookmark)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(bookmark);
            }
          }}
        >
          <div className="mt-bookmark-mark">
            {(bookmark.roomName || bookmark.name || 'S').charAt(0).toUpperCase()}
          </div>
          <div className="mt-bookmark-body">
            <div className="mt-bookmark-text">{bookmark.text || 'Saved message'}</div>
            <div className="mt-bookmark-sub">
              <span>{bookmark.name || 'Someone'}</span>
              <span>in {bookmark.roomName || 'room'}</span>
              <span>{formatSavedTime(bookmark.ts)}</span>
            </div>
          </div>
          <button
            className="mt-bookmark-del"
            type="button"
            title="Remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(bookmark.id);
            }}
          >
            ×
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
    <div id="bookmarks-panel" className="mt-side-panel mt-saved-panel">
      <div className="mt-side-head">
        <div className="mt-side-title">
          <span><i className="ph-bold ph-bookmark-simple" aria-hidden="true" /> Saved</span>
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
