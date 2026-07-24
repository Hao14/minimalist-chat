import { useCallback, useMemo } from 'react';
import { expect, waitFor, within } from 'storybook/test';
import MessageTimeline from './MessageTimeline.jsx';

function VirtualTimelineStory({ messageCount = 600 }) {
  const messages = useMemo(() => Array.from({ length: messageCount }, (_, index) => ({
    id: `story-message-${index}`,
    senderId: index % 3 === 0 ? 'winston' : `person-${index % 5}`,
    senderName: index % 3 === 0 ? 'Winston' : `Person ${index % 5}`,
    text: index % 11 === 0
      ? `A longer message ${index} that wraps across several lines to exercise variable-height row measurement in a busy room.`
      : `Message ${index}`,
    timestamp: Date.UTC(2026, 6, 23, 12, 0, index),
    ...(index % 37 === 0 ? { attachedFile: { name: `brief-${index}.pdf` } } : {}),
    ...(index % 53 === 0 ? { attachedImage: '/icon-192.png' } : {}),
  })), [messageCount]);
  const renderMessage = useCallback((message, index) => (
    <li
      className="chat-message"
      id={`msg-${message.id}`}
      key={message.id}
      style={{
        minHeight: message.attachedImage ? 220 : message.attachedFile ? 124 : 76,
        padding: '12px 16px',
        borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
      }}
    >
      <strong>{message.senderName}</strong>
      <p style={{ margin: '4px 0 0' }}>{message.text}</p>
      {message.attachedImage ? (
        <img alt="" height="96" src={message.attachedImage} width="96" />
      ) : null}
      {message.attachedFile ? <small>{message.attachedFile.name}</small> : null}
      <span className="appearance-sr-only">Position {index + 1}</span>
    </li>
  ), []);

  return (
    <div id="chat-wrapper" style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>
      <ul
        aria-label="Story conversation"
        id="messages"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 13,
          height: 640,
          margin: 0,
          overflowY: 'auto',
          padding: 0,
        }}
        tabIndex={0}
      >
        <MessageTimeline
          deliveries={[]}
          firstUnreadMessageId="story-message-420"
          matchesMessage={() => true}
          messages={messages}
          onCancelDelivery={() => {}}
          onRetryDelivery={() => {}}
          pinnedMessageId=""
          renderMessage={renderMessage}
          scopeKey="storybook:long-room"
        />
      </ul>
    </div>
  );
}

/** @type {import('@storybook/react-vite').Meta<typeof VirtualTimelineStory>} */
const meta = {
  title: 'Chat/Virtual Message Timeline',
  component: VirtualTimelineStory,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const SixHundredMessages = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole('list', { name: 'Story conversation' });

    await waitFor(() => {
      const mountedMessages = list.querySelectorAll(':scope > li.chat-message').length;
      expect(mountedMessages).toBeGreaterThanOrEqual(38);
      expect(mountedMessages).toBeLessThanOrEqual(68);
      expect(list.querySelectorAll(':scope > li.message-timeline-spacer').length).toBeGreaterThan(0);
    });

    list.scrollTop = Math.round(list.scrollHeight * 0.55);
    list.dispatchEvent(new Event('scroll', { bubbles: true }));

    await waitFor(() => {
      const mountedMessages = [...list.querySelectorAll(':scope > li.chat-message')];
      expect(mountedMessages.length).toBeLessThanOrEqual(68);
      expect(mountedMessages.some((item) => (
        Number(item.id.replace('msg-story-message-', '')) > 200
      ))).toBe(true);
    });
  },
};

export const MobileLongRoom = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: SixHundredMessages.play,
};
