function ContactActions({ contact, onAcceptRequest, onOpenPrivateChat, onOpenProfile, onRemoveFriend, onSendRequest }) {
  if (contact.status === 'accepted') {
    return (
      <>
        <button
          className="contact-icon-btn pm-open-btn"
          onClick={() => onOpenPrivateChat(contact.uid, contact.displayName)}
          aria-label={`Message ${contact.displayName}`}
          title="Message"
          type="button"
        >
          <i className="ph-bold ph-chat-circle-text" />
        </button>
        <button
          className="contact-icon-btn"
          onClick={() => onOpenProfile(contact.uid)}
          aria-label={`Open ${contact.displayName} profile`}
          title="More Options"
          type="button"
        >
          <i className="ph-bold ph-dots-three-vertical" />
        </button>
      </>
    );
  }

  if (contact.status === 'pending_received') {
    return (
      <>
        <button className="mini-btn" onClick={() => onAcceptRequest(contact.uid)} type="button">Accept</button>
        <button className="mini-btn danger" onClick={() => onRemoveFriend(contact.uid)} type="button">Decline</button>
      </>
    );
  }

  if (contact.status === 'pending_sent') {
    return <span className="contact-requested">Requested</span>;
  }

  return (
    <button className="mini-btn outline contact-add-btn" onClick={() => onSendRequest(contact.uid)} type="button">
      <i className="ph-bold ph-user-plus" /> Add
    </button>
  );
}

function getContactStatusLabel(contact) {
  if (contact.status === 'accepted') return contact.isOnline ? 'Online now' : 'Offline';
  if (contact.status === 'pending_received') return 'Wants to connect';
  if (contact.status === 'pending_sent') return 'Request sent';
  return 'Suggested';
}

function ContactItem({ contact, onAcceptRequest, onOpenPrivateChat, onOpenProfile, onRemoveFriend, onSendRequest }) {
  const statusLabel = getContactStatusLabel(contact);
  const statusClass = contact.status || 'suggested';

  return (
    <li className={`contact-item contact-status-${statusClass} ${contact.isOnline ? 'is-online' : 'is-offline'}`}>
      <div className="contact-info">
        <button
          className="avatar-wrapper contact-profile-btn"
          onClick={() => onOpenProfile(contact.uid)}
          title="View Profile"
          type="button"
        >
          <img src={contact.avatar} className="contact-avatar" alt="" />
          <span className={`status-dot ${contact.isOnline ? 'online' : 'offline'}`} />
        </button>
        <span className="contact-copy">
          <span className="contact-name">{contact.displayName}</span>
          <span className="contact-meta">
            <span className={`contact-status-pill ${contact.isOnline ? 'online' : 'offline'}`}>{statusLabel}</span>
            {contact.shortId ? <span className="contact-short-id">#{contact.shortId}</span> : null}
          </span>
        </span>
        <span className="unread-indicator" id={`dot-${contact.uid}`} />
      </div>
      <div className="contact-actions">
        <ContactActions
          contact={contact}
          onAcceptRequest={onAcceptRequest}
          onOpenPrivateChat={onOpenPrivateChat}
          onOpenProfile={onOpenProfile}
          onRemoveFriend={onRemoveFriend}
          onSendRequest={onSendRequest}
        />
      </div>
    </li>
  );
}

function ContactSection({ section, ...handlers }) {
  return (
    <>
      <li className="section-title" style={section.subdued ? { opacity: 0.72 } : undefined}>
        <span>{section.title}</span>
        <span className="section-count">{section.items.length}</span>
      </li>
      {section.items.length ? section.items.map((contact) => (
        <ContactItem key={contact.uid} contact={contact} {...handlers} />
      )) : (
        <li className="contacts-empty">{section.empty || 'No users found.'}</li>
      )}
    </>
  );
}

export default function ContactsList({ sections, onAcceptRequest, onOpenPrivateChat, onOpenProfile, onRemoveFriend, onSendRequest }) {
  if (!sections.length) {
    return <li className="contacts-empty">No contacts yet. Search for people or join a room to discover them.</li>;
  }

  return sections.map((section) => (
    <ContactSection
      key={section.id}
      section={section}
      onAcceptRequest={onAcceptRequest}
      onOpenPrivateChat={onOpenPrivateChat}
      onOpenProfile={onOpenProfile}
      onRemoveFriend={onRemoveFriend}
      onSendRequest={onSendRequest}
    />
  ));
}
