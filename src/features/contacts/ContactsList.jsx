import { useMemo, useState } from 'react';
import './contacts.css';

const CONTACT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'messages', label: 'Messages' },
  { id: 'requests', label: 'Requests' },
];

const PRIORITY_AVATAR_LIMIT = 6;

const EMPTY_FILTER_COPY = {
  online: ['No one is online', 'Your contacts will appear here when they are active.'],
  messages: ['No recent messages', 'Private-message contacts will appear here.'],
  requests: ['No contact requests', 'Incoming and pending requests will appear here.'],
};

function ContactActions({ contact, onAcceptRequest, onOpenPrivateChat, onOpenProfile, onPrepareProfile, onRemoveFriend, onSendRequest }) {
  if (contact.status === 'accepted' || (!contact.status && contact.lastPm)) {
    return (
      <>
        <button
          className="contact-icon-btn pm-open-btn"
          onClick={(event) => onOpenPrivateChat(contact.uid, contact.displayName, {
            opener: event.currentTarget,
            photoUrl: contact.avatar || '',
          })}
          aria-label={`Message ${contact.displayName}`}
          title="Message"
          type="button"
        >
          <i className="ph-bold ph-chat-circle-text" aria-hidden="true" />
        </button>
        <button
          className="contact-icon-btn"
          onClick={() => onOpenProfile(contact)}
          onFocus={() => onPrepareProfile?.(contact)}
          onPointerDown={() => onPrepareProfile?.(contact)}
          onPointerEnter={() => onPrepareProfile?.(contact)}
          aria-label={`Open ${contact.displayName} profile`}
          title="View profile"
          type="button"
        >
          <i className="ph-bold ph-user-circle" aria-hidden="true" />
        </button>
      </>
    );
  }

  if (contact.status === 'pending_received') {
    return (
      <>
        <button
          className="mini-btn contact-accept-btn"
          onClick={() => onAcceptRequest(contact.uid)}
          aria-label={`Accept ${contact.displayName}'s request`}
          type="button"
        >
          <i className="ph-bold ph-check" aria-hidden="true" /> Accept
        </button>
        <button
          className="mini-btn danger"
          onClick={() => onRemoveFriend(contact.uid)}
          aria-label={`Decline ${contact.displayName}'s request`}
          type="button"
        >
          <i className="ph-bold ph-x" aria-hidden="true" /> Decline
        </button>
      </>
    );
  }

  if (contact.status === 'pending_sent') {
    return <span className="contact-requested">Requested</span>;
  }

  return (
    <button
      className="mini-btn outline contact-add-btn"
      onClick={() => onSendRequest(contact.uid)}
      aria-label={`Add ${contact.displayName}`}
      type="button"
    >
      <i className="ph-bold ph-user-plus" aria-hidden="true" /> Add
    </button>
  );
}

function getContactActivity(contact) {
  if (contact.unread) {
    return {
      label: contact.lastPm ? `New message · ${contact.lastPm}` : 'Sent you a message',
      tone: 'message',
    };
  }
  if (contact.status === 'pending_received') return { label: 'Wants to connect', tone: 'request' };
  if (contact.status === 'pending_sent') return { label: 'Request sent', tone: 'pending' };
  if (contact.profileStatus) return { label: contact.profileStatus, tone: 'profile' };
  if (contact.lastPm) return { label: contact.lastPm, tone: 'message-muted' };
  if (contact.discoverySource === 'room') return { label: 'In this room', tone: 'room' };
  if (contact.discoverySource === 'suggested') return { label: 'Suggested contact', tone: 'suggested' };
  if (contact.discoverySource === 'search') return { label: 'Found in people', tone: 'suggested' };
  return null;
}

function matchesContactFilter(contact, filter) {
  if (filter === 'online') return contact.status === 'accepted' && contact.isOnline;
  if (filter === 'messages') return Boolean(contact.lastPm || contact.unread);
  if (filter === 'requests') return contact.status === 'pending_received' || contact.status === 'pending_sent';
  return true;
}

function ContactItem({ contact, prioritizeAvatar, onAcceptRequest, onOpenPrivateChat, onOpenProfile, onPrepareProfile, onRemoveFriend, onSendRequest }) {
  const activity = getContactActivity(contact);
  const presenceLabel = contact.isOnline ? 'Online' : 'Offline';
  const relationshipClass = contact.status || (contact.lastPm ? 'recent' : 'suggested');

  return (
    <li
      className={`contact-item contact-status-${relationshipClass} ${contact.isOnline ? 'is-online' : 'is-offline'} ${contact.unread ? 'has-unread' : ''}`}
      data-activity-tone={activity?.tone || 'none'}
    >
      <div className="contact-info">
        <button
          className="avatar-wrapper contact-profile-btn"
          onClick={() => onOpenProfile(contact)}
          onFocus={() => onPrepareProfile?.(contact)}
          onPointerDown={() => onPrepareProfile?.(contact)}
          onPointerEnter={() => onPrepareProfile?.(contact)}
          title="View profile"
          aria-label={`View ${contact.displayName} profile`}
          type="button"
        >
          <img
            src={contact.avatar}
            className="contact-avatar"
            alt=""
            loading={prioritizeAvatar ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={prioritizeAvatar ? 'high' : 'auto'}
          />
          <span className={`status-dot ${contact.isOnline ? 'online' : 'offline'}`} title={presenceLabel} aria-hidden="true" />
        </button>
        <span className="contact-copy">
          <span className="contact-name">{contact.displayName}</span>
          <span className="contact-meta">
            <span className={`contact-presence-label ${contact.isOnline ? 'online' : 'offline'}`}>
              {presenceLabel}
            </span>
            {contact.shortId ? <span className="contact-short-id">#{contact.shortId}</span> : null}
          </span>
          {activity ? (
            <span className={`contact-activity contact-activity-${activity.tone}`} title={activity.label}>
              {activity.label}
            </span>
          ) : null}
        </span>
        <span
          className="unread-indicator"
          id={`dot-${contact.uid}`}
          role={contact.unread ? 'status' : undefined}
          aria-label={contact.unread ? `Unread private message from ${contact.displayName}` : undefined}
          aria-hidden={contact.unread ? undefined : true}
        />
      </div>
      <div className="contact-actions">
        <ContactActions
          contact={contact}
          onAcceptRequest={onAcceptRequest}
          onOpenPrivateChat={onOpenPrivateChat}
          onOpenProfile={onOpenProfile}
          onPrepareProfile={onPrepareProfile}
          onRemoveFriend={onRemoveFriend}
          onSendRequest={onSendRequest}
        />
      </div>
    </li>
  );
}

function ContactSection({ priorityAvatarUids, section, ...handlers }) {
  const headingId = `contacts-section-${section.id}`;
  return (
    <li className={`contacts-section contacts-section-${section.id} ${section.subdued ? 'is-subdued' : ''}`}>
      <section aria-labelledby={headingId}>
        <div className="contacts-section-header">
          <h3 id={headingId}>{section.title}</h3>
          <span className="contacts-section-count" aria-label={`${section.items.length} people`}>{section.items.length}</span>
        </div>
        <ul className="contacts-section-list" role="list">
          {section.items.map((contact) => (
            <ContactItem
              key={contact.uid}
              contact={contact}
              prioritizeAvatar={priorityAvatarUids.has(contact.uid)}
              {...handlers}
            />
          ))}
        </ul>
      </section>
    </li>
  );
}

function ContactsLoadingState() {
  return (
    <li className="contacts-state contacts-loading-state" aria-label="Loading contacts">
      <div className="contacts-state-heading">
        <span className="contacts-state-spinner" aria-hidden="true" />
        <span>Loading people…</span>
      </div>
      <div className="contacts-skeleton-list" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span className="contacts-skeleton-row" key={index}>
            <span className="contacts-skeleton-avatar" />
            <span className="contacts-skeleton-copy">
              <span />
              <span />
            </span>
          </span>
        ))}
      </div>
    </li>
  );
}

function ContactsState({ status, onRetry }) {
  if (status?.mode === 'loading') return <ContactsLoadingState />;
  const isError = status?.mode === 'error';
  const icon = isError ? 'ph-warning-circle' : status?.mode === 'signed-out' ? 'ph-lock-key' : 'ph-users-three';
  return (
    <li className={`contacts-state ${isError ? 'is-error' : ''}`} role={isError ? 'alert' : 'status'}>
      <span className="contacts-state-icon" aria-hidden="true"><i className={`ph-bold ${icon}`} /></span>
      <strong>{status?.title || (isError ? 'Contacts unavailable' : 'No contacts yet')}</strong>
      <span>{status?.message || 'Search for people or join a room to discover them.'}</span>
      {isError && onRetry ? (
        <button className="contacts-retry-btn" onClick={onRetry} type="button">
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" /> Try again
        </button>
      ) : null}
    </li>
  );
}

function ContactsFilterEmpty({ activeFilter, searchQuery, onShowAll }) {
  const [title, copy] = EMPTY_FILTER_COPY[activeFilter] || (
    searchQuery
      ? [`No matches for “${searchQuery}”`, 'Try another name or short ID.']
      : ['No contacts yet', 'Search for people or join a room to discover them.']
  );
  return (
    <li className="contacts-state contacts-filter-empty" role="status">
      <span className="contacts-state-icon" aria-hidden="true"><i className="ph-bold ph-user-list" /></span>
      <strong>{title}</strong>
      <span>{copy}</span>
      {activeFilter !== 'all' ? (
        <button className="contacts-show-all-btn" onClick={onShowAll} type="button">Show everyone</button>
      ) : null}
    </li>
  );
}

function ContactsOverview({ activeFilter, onFilterChange, summary }) {
  const totalContacts = Number(summary?.totalContacts || 0);
  const onlineCount = Number(summary?.online || 0);
  const filterCounts = {
    all: Number(summary?.all || 0),
    online: onlineCount,
    messages: Number(summary?.messages || 0),
    requests: Number(summary?.requests || 0),
  };

  return (
    <li className="contacts-overview">
      <p className="contacts-summary-line">
        <span className="contacts-summary-dot" aria-hidden="true" />
        <strong>{totalContacts}</strong> {totalContacts === 1 ? 'contact' : 'contacts'}
        <span aria-hidden="true">·</span>
        <span>{onlineCount} online</span>
      </p>
      <div className="contacts-filter-bar" role="toolbar" aria-label="Filter contacts">
        {CONTACT_FILTERS.map((filter) => {
          const selected = activeFilter === filter.id;
          return (
            <button
              className={`contacts-filter-btn ${selected ? 'is-active' : ''}`}
              key={filter.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.id === 'online' ? <span className="contacts-filter-dot" aria-hidden="true" /> : null}
              <span>{filter.label}</span>
              <span className="contacts-filter-count" aria-label={`${filterCounts[filter.id]} matching`}>{filterCounts[filter.id]}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

export default function ContactsList({
  sections,
  summary,
  searchQuery = '',
  status = null,
  onAcceptRequest,
  onOpenPrivateChat,
  onOpenProfile,
  onPrepareProfile,
  onRemoveFriend,
  onRetry,
  onSendRequest,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const filteredSections = useMemo(() => sections
    .map((section) => ({
      ...section,
      items: section.items.filter((contact) => matchesContactFilter(contact, activeFilter)),
    }))
    .filter((section) => section.items.length), [activeFilter, sections]);
  const priorityAvatarUids = useMemo(() => new Set(
    filteredSections
      .flatMap((section) => section.items)
      .slice(0, PRIORITY_AVATAR_LIMIT)
      .map((contact) => contact.uid),
  ), [filteredSections]);

  if (status) return <ContactsState status={status} onRetry={onRetry} />;

  const handlers = {
    onAcceptRequest,
    onOpenPrivateChat,
    onOpenProfile,
    onPrepareProfile,
    onRemoveFriend,
    onSendRequest,
  };

  return (
    <>
      <ContactsOverview activeFilter={activeFilter} onFilterChange={setActiveFilter} summary={summary} />
      {filteredSections.length ? filteredSections.map((section) => (
        <ContactSection
          key={section.id}
          section={section}
          priorityAvatarUids={priorityAvatarUids}
          {...handlers}
        />
      )) : (
        <ContactsFilterEmpty
          activeFilter={activeFilter}
          searchQuery={searchQuery}
          onShowAll={() => setActiveFilter('all')}
        />
      )}
    </>
  );
}
