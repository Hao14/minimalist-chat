import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiButton, UiSeparator } from '../../components/ui/UiButton.jsx';
import './composerMoreMenu.css';

const MENU_WIDTH = 276;
const MENU_GUTTER = 12;

function menuPosition(anchor) {
  const rect = anchor?.getBoundingClientRect?.();
  if (!rect) return null;

  const visualViewport = window.visualViewport;
  const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
  const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
  const viewportWidth = Math.max(0, visualViewport?.width || window.innerWidth);
  const viewportHeight = Math.max(0, visualViewport?.height || window.innerHeight);
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const width = Math.min(MENU_WIDTH, Math.max(180, viewportWidth - (MENU_GUTTER * 2)));
  const left = Math.min(
    Math.max(viewportLeft + MENU_GUTTER, rect.right - width),
    Math.max(viewportLeft + MENU_GUTTER, viewportRight - width - MENU_GUTTER),
  );
  const availableAbove = Math.max(0, rect.top - viewportTop - (MENU_GUTTER + 8));
  const availableBelow = Math.max(0, viewportBottom - rect.bottom - (MENU_GUTTER + 8));
  const placeAbove = availableAbove >= 180 || availableAbove >= availableBelow;
  const availableHeight = placeAbove ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    0,
    Math.min(430, availableHeight, viewportHeight - (MENU_GUTTER * 2)),
  );
  const top = placeAbove
    ? Math.max(viewportTop + MENU_GUTTER, rect.top - maxHeight - 8)
    : Math.min(rect.bottom + 8, viewportBottom - maxHeight - MENU_GUTTER);

  return {
    left,
    maxHeight,
    top,
    width,
  };
}

function menuItems({
  onCodeBlock,
  onCreatePoll,
  onCreateReminder,
  onInlineCode,
  onJumpToUnread,
  onSchedule,
  onToggleThreads,
  threadsOpen,
  unreadCount,
}) {
  return [
    {
      id: 'create',
      label: 'Create',
      items: [
        {
          description: 'Ask the room a question',
          icon: 'ph-chart-bar',
          id: 'poll',
          label: 'Poll',
          onSelect: onCreatePoll,
          title: 'Create a poll',
        },
        {
          description: 'Save a follow-up for later',
          icon: 'ph-alarm',
          id: 'reminder',
          label: 'Reminder',
          onSelect: onCreateReminder,
          title: 'Create a reminder',
        },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      items: [
        {
          description: 'Format the selection in a line',
          icon: 'ph-code',
          id: 'inline-code',
          label: 'Inline code',
          onSelect: onInlineCode,
          title: 'Format as inline code',
        },
        {
          description: 'Insert a fenced code block',
          icon: 'ph-brackets-curly',
          id: 'code-block',
          label: 'Code block',
          onSelect: onCodeBlock,
          title: 'Insert a code block',
        },
      ],
    },
    {
      id: 'organize',
      label: 'Send & navigate',
      items: [
        {
          description: 'Choose when this message sends',
          icon: 'ph-clock-countdown',
          id: 'schedule',
          label: 'Schedule send',
          onSelect: onSchedule,
          title: 'Schedule this message',
        },
        {
          checked: threadsOpen,
          description: threadsOpen ? 'Close the thread inbox' : 'Open the thread inbox',
          icon: 'ph-chat-centered-dots',
          id: 'threads',
          label: 'Threads',
          onSelect: onToggleThreads,
          title: threadsOpen ? 'Close threads' : 'Open threads',
        },
        {
          badge: unreadCount > 0 ? unreadCount : '',
          description: unreadCount > 0 ? `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}` : 'You are caught up',
          disabled: unreadCount < 1,
          icon: 'ph-envelope-simple-open',
          id: 'unread',
          label: unreadCount > 0 ? 'First unread' : 'No unread messages',
          onSelect: onJumpToUnread,
          title: unreadCount > 0 ? 'Jump to the first unread message' : 'No unread messages',
        },
      ],
    },
  ];
}

export default function ComposerMoreMenu({
  anchorRef,
  onClose,
  onCodeBlock,
  onCreatePoll,
  onCreateReminder,
  onInlineCode,
  onJumpToUnread,
  onSchedule,
  onToggleThreads,
  threadsOpen = false,
  unreadCount = 0,
}) {
  const menuRef = useRef(null);
  const [pendingAction, setPendingAction] = useState('');
  const [position, setPosition] = useState({
    left: 0,
    maxHeight: 0,
    top: 0,
    visibility: 'hidden',
    width: MENU_WIDTH,
  });
  const groups = menuItems({
    onCodeBlock,
    onCreatePoll,
    onCreateReminder,
    onInlineCode,
    onJumpToUnread,
    onSchedule,
    onToggleThreads,
    threadsOpen,
    unreadCount,
  });

  const updatePosition = useCallback(() => {
    setPosition(menuPosition(anchorRef?.current));
  }, [anchorRef]);

  useLayoutEffect(() => {
    setPosition(menuPosition(anchorRef?.current));
    const focusFrame = requestAnimationFrame(() => {
      const firstItem = menuRef.current?.querySelector('.composer-more-item:not(:disabled)');
      firstItem?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      onClose();
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [anchorRef, onClose, updatePosition]);

  const runAction = async (item) => {
    if (item.disabled || pendingAction) return;
    const focusStartedInMenu = menuRef.current?.contains(document.activeElement);
    setPendingAction(item.id);
    try {
      await item.onSelect?.();
      if (
        focusStartedInMenu
        && (
          document.activeElement === document.body
          || menuRef.current?.contains(document.activeElement)
        )
      ) {
        anchorRef?.current?.focus();
      }
      onClose();
    } catch (error) {
      window.showToast?.(error?.message || 'That message tool could not be opened.');
      setPendingAction('');
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      anchorRef?.current?.focus();
      onClose();
      return;
    }

    if (event.key === 'Tab') {
      onClose();
      return;
    }

    const items = [...(menuRef.current?.querySelectorAll('.composer-more-item:not(:disabled)') || [])];
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement));
    let nextIndex = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  if (!position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-labelledby="composer-more-trigger"
      className="composer-more-menu"
      id="composer-more-menu"
      onKeyDown={handleKeyDown}
      ref={menuRef}
      role="menu"
      style={position}
      tabIndex={0}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.id}>
          {groupIndex > 0 ? <UiSeparator className="composer-more-separator" /> : null}
          <div
            aria-labelledby={`composer-more-${group.id}-label`}
            className="composer-more-group"
            role="group"
          >
            <span className="composer-more-label" id={`composer-more-${group.id}-label`}>
              {group.label}
            </span>
            {group.items.map((item) => {
              const pending = pendingAction === item.id;
              const role = typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem';
              return (
                <UiButton
                  aria-busy={pending || undefined}
                  aria-checked={role === 'menuitemcheckbox' ? item.checked : undefined}
                  className={`composer-more-item ${item.checked ? 'selected' : ''}`}
                  disabled={item.disabled || Boolean(pendingAction)}
                  key={item.id}
                  onClick={() => runAction(item)}
                  role={role}
                  title={item.title}
                  variant="inherit"
                >
                  <span className="composer-more-item-icon">
                    <i
                      aria-hidden="true"
                      className={`ph-bold ${pending ? 'ph-spinner-gap composer-more-spinner' : item.icon}`}
                    />
                  </span>
                  <span className="composer-more-item-copy">
                    <strong>{pending ? 'Opening…' : item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  {item.badge ? <span className="composer-more-badge">{item.badge}</span> : null}
                  {item.checked ? <i className="ph-bold ph-check composer-more-check" aria-hidden="true" /> : null}
                </UiButton>
              );
            })}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
