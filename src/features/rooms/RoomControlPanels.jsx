import { Fragment } from 'react';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';

export function RoomPicturePreview({ url, initials }) {
  if (url) return <img src={url} alt="" width="76" height="76" decoding="async" />;
  return <span>{initials || 'R'}</span>;
}

export function RoomInvitePanel({
  title,
  inviteLink,
  targets,
  loading,
  error,
  forwardingUid,
  sentUids,
  onClose,
  onCopy,
  onRefresh,
  onForward,
}) {
  return (
    <section className="room-invite-card" role="dialog" aria-modal="true" aria-labelledby="room-invite-title">
      <button className="room-invite-close" type="button" aria-label="Close invite panel" onClick={onClose}>
        <i className="ph-bold ph-x" />
      </button>
      <p className="room-invite-kicker">Room invite</p>
      <h2 id="room-invite-title">{title || 'Invite to Room'}</h2>
      <p className="room-invite-subtitle">Share a browser link or forward it through PM.</p>
      <label className="room-invite-label" htmlFor="room-invite-link">Join link</label>
      <div className="room-invite-link-row">
        <input id="room-invite-link" type="text" readOnly value={inviteLink || ''} />
        <button type="button" onClick={onCopy} disabled={!inviteLink}>Copy link</button>
      </div>
      <div className="room-invite-forward-head">
        <span>Forward through PM</span>
        <button type="button" onClick={onRefresh} disabled={loading}>Refresh</button>
      </div>
      <div id="room-invite-targets" className="room-invite-targets">
        {loading ? <div className="room-invite-empty">Loading contacts…</div> : null}
        {!loading && error ? <div className="room-invite-empty">{error}</div> : null}
        {!loading && !error && !targets.length ? (
          <div className="room-invite-empty">No eligible contacts yet. Add friends first, or copy the link above.</div>
        ) : null}
        {!loading && !error ? targets.map((target) => {
          const isForwarding = forwardingUid === target.uid;
          const isSent = sentUids?.has?.(target.uid);
          return (
            <button
              className="room-invite-target"
              key={target.uid}
              type="button"
              disabled={isForwarding || isSent}
              onClick={() => onForward(target)}
            >
              <span className="room-invite-avatar">
                {normalizeStoredAvatarUrl(target.photoUrl) ? (
                  <img src={normalizeStoredAvatarUrl(target.photoUrl)} alt="" width="42" height="42" loading="lazy" decoding="async" />
                ) : target.initials}
              </span>
              <span className="room-invite-target-copy">
                <strong>{target.name}</strong>
                <small>{isForwarding ? 'Sending…' : isSent ? 'Sent' : 'Send invite in PM'}</small>
              </span>
              <i className="ph-bold ph-paper-plane-tilt" />
            </button>
          );
        }) : null}
      </div>
    </section>
  );
}

export function RoomMembersList({ members, canKick, currentUserId, onKick }) {
  if (!members.length) return <li className="rs-empty-row">No members found.</li>;

  return members.map((member) => (
    <li className="rs-list-row" key={member.uid}>
      <span className="rs-member-name"><i className="ph-bold ph-user" /> {member.name}</span>
      {canKick && member.uid !== currentUserId ? (
        <button
          className="mini-btn danger rs-inline-action"
          type="button"
          onClick={() => onKick(member)}
        >
          Kick
        </button>
      ) : null}
    </li>
  ));
}

export function RoomChannelsList({ channels, canManageChannels, onDelete }) {
  return (
    <Fragment>
      <li className="rs-list-row">
        <span># general</span>
        <em>Original room chat</em>
      </li>
      {channels.map((channel) => (
        <li className="rs-list-row" key={channel.id}>
          <span># {channel.name || channel.id}</span>
          {canManageChannels ? (
            <button
              className="mini-btn danger rs-inline-action"
              type="button"
              onClick={() => onDelete(channel.id)}
            >
              Delete
            </button>
          ) : (
            <em>Locked</em>
          )}
        </li>
      ))}
    </Fragment>
  );
}

export function RoomAuditLog({ logs }) {
  if (!logs.length) return <li className="rs-empty-row">No logs found.</li>;

  return logs.map((log) => (
    <li className="rs-log-row" key={`${log.timestamp}-${log.text}`}>
      <span>[{log.dateLabel}]</span>
      <strong>{log.text}</strong>
    </li>
  ));
}
