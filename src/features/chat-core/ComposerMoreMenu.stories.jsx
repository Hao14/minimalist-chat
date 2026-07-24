import { useRef, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import ComposerMoreMenu from './ComposerMoreMenu.jsx';

function ComposerMoreMenuStory({
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  return (
    <div id="chat-wrapper">
      <div
        id="room-view-chat"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          alignItems: 'end',
          padding: 24,
          background: 'var(--bg-color, #fff)',
        }}
      >
        <form id="chat-form" onSubmit={(event) => event.preventDefault()}>
          <div className="composer-toolbar">
            <div className="composer-tool-group" aria-label="Message tools">
              <button
                aria-controls="composer-more-menu"
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label="More message tools"
                className={`composer-icon-btn ${open ? 'active' : ''}`}
                id="composer-more-trigger"
                onClick={() => setOpen((current) => !current)}
                ref={triggerRef}
                title="More message tools"
                type="button"
              >
                <i className="ph-bold ph-dots-three-outline-vertical" aria-hidden="true" />
              </button>
              {open ? (
                <ComposerMoreMenu
                  anchorRef={triggerRef}
                  onClose={() => setOpen(false)}
                  onCodeBlock={onCodeBlock}
                  onCreatePoll={onCreatePoll}
                  onCreateReminder={onCreateReminder}
                  onInlineCode={onInlineCode}
                  onJumpToUnread={onJumpToUnread}
                  onSchedule={onSchedule}
                  onToggleThreads={onToggleThreads}
                  threadsOpen={threadsOpen}
                  unreadCount={unreadCount}
                />
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** @type {import('@storybook/react-vite').Meta<typeof ComposerMoreMenuStory>} */
const meta = {
  title: 'Chat/Composer More Menu',
  component: ComposerMoreMenuStory,
  args: {
    onCodeBlock: fn(),
    onCreatePoll: fn(),
    onCreateReminder: fn(),
    onInlineCode: fn(),
    onJumpToUnread: fn(),
    onSchedule: fn(),
    onToggleThreads: fn(),
    threadsOpen: false,
    unreadCount: 3,
  },
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const Closed = {
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole('button', { name: 'More message tools' });
    const page = within(canvasElement.ownerDocument.body);

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(getComputedStyle(trigger).minHeight).toBe('40px');
    await expect(page.queryByRole('menu', { name: 'More message tools' })).not.toBeInTheDocument();
  },
};

export const KeyboardAccessible = {
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole('button', { name: 'More message tools' });
    const page = within(canvasElement.ownerDocument.body);

    await userEvent.click(trigger);
    const menu = await page.findByRole('menu', { name: 'More message tools' });
    const poll = within(menu).getByRole('menuitem', { name: /Poll/ });
    const reminder = within(menu).getByRole('menuitem', { name: /Reminder/ });

    await waitFor(() => expect(poll).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await expect(reminder).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(page.queryByRole('menu', { name: 'More message tools' })).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    const reopenedMenu = await page.findByRole('menu', { name: 'More message tools' });
    await userEvent.click(within(reopenedMenu).getByRole('menuitemcheckbox', { name: /Threads/ }));
    await expect(page.queryByRole('menu', { name: 'More message tools' })).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

export const Mobile = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole('button', { name: 'More message tools' });
    await expect(getComputedStyle(trigger).minHeight).toBe('44px');
    await userEvent.click(trigger);
    const menu = await within(canvasElement.ownerDocument.body).findByRole('menu', { name: 'More message tools' });
    await expect(menu).toBeVisible();
    await expect(within(menu).getByText('Send & navigate')).toBeVisible();
  },
};

export const LoadingAndDisabled = {
  args: {
    onCreatePoll: fn(() => new Promise(() => {})),
    unreadCount: 0,
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More message tools' }));
    const menu = await within(canvasElement.ownerDocument.body).findByRole('menu', { name: 'More message tools' });
    const unread = within(menu).getByRole('menuitem', { name: /No unread messages/ });
    const poll = within(menu).getByRole('menuitem', { name: /Poll/ });

    await expect(unread).toBeDisabled();
    await userEvent.click(poll);
    await expect(poll).toHaveAttribute('aria-busy', 'true');
    await expect(within(poll).getByText('Opening…')).toBeVisible();
  },
};

export const ReducedMotion = {
  parameters: {
    prefersReducedMotion: 'reduce',
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More message tools' }));
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('menu', { name: 'More message tools' }),
    ).toBeVisible();
  },
};
