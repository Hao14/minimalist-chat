import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { UiButton, UiIconButton } from '../../components/ui/UiButton.jsx';
import { AiModelSegmentedControl } from './AiModelSegmentedControl.jsx';
import { AI_MODEL_PROFILES } from './modelProfiles.js';
import './room-ai.css';

const suggestions = [
  {
    icon: 'ph-note',
    label: 'Summarize what changed',
    hint: 'Decisions, blockers, and updates',
  },
  {
    icon: 'ph-list-checks',
    label: 'Turn this into next steps',
    hint: 'Owners, work, and dates',
  },
];

function RoomAiSurface({
  busy = false,
  initialModel = 'fast',
  onNewChat = fn(),
  sourcesOpen = false,
  status = 'ready',
  surfaceWidth = '100%',
}) {
  const [model, setModel] = useState(initialModel);
  const statusLabel = status === 'ready' ? 'Ready' : status === 'loading' ? 'Warming up' : 'Needs attention';

  return (
    <div
      id="room-view-ai"
      style={{
        width: surfaceWidth,
        maxWidth: '100%',
        height: 'min(760px, 100vh)',
        marginInline: 'auto',
        display: 'flex',
      }}
    >
      <div className="room-ai-shell" style={{ width: '100%', height: '100%' }}>
        <main className="room-ai-main">
        <header className="room-ai-header" aria-label="Room AI toolbar">
          <div className="room-ai-title-mark" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
          <div className="room-ai-title-copy"><h1>Room AI</h1><span>Product launch</span></div>
          <div className="room-ai-toolbar-actions">
            <div className={`room-ai-status room-ai-status-${status}`} role="status" aria-label={`Room AI status: ${statusLabel}`}>
              <span className="room-ai-status-dot" aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>
            <AiModelSegmentedControl
              disabled={busy}
              onChange={setModel}
              profiles={AI_MODEL_PROFILES}
              value={model}
            />
            <UiButton
              aria-label="New chat"
              className="room-ai-new-chat"
              disabled={busy}
              onClick={onNewChat}
              tooltip="Start a new Room AI conversation"
              variant="inherit"
            >
              <i className="ph-bold ph-plus" aria-hidden="true" />
              <span>New chat</span>
            </UiButton>
            <details className="room-ai-overflow">
              <summary aria-label="More Room AI actions" title="More actions">
                <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
              </summary>
              <div className="room-ai-overflow-menu" role="group" aria-label="More Room AI actions">
                <span className="room-ai-overflow-label">Room AI</span>
                <UiButton variant="inherit"><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /><span>Refresh status</span></UiButton>
                <UiButton variant="inherit"><i className="ph-bold ph-database" aria-hidden="true" /><span>Sources &amp; details</span></UiButton>
              </div>
            </details>
          </div>
        </header>

        <div id="ai-thread" className="room-ai-canvas" aria-live="polite">
          <div className="room-ai-welcome">
            <div className="room-ai-orbit" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
            <h2>How can I help your team today?</h2>
            <p>Turn the conversation into a clear answer, decision, or next step.</p>
            <div className="room-ai-quick-grid">
              {suggestions.map((suggestion) => (
                <UiButton disabled={busy} key={suggestion.label} variant="inherit">
                  <i className={`ph-bold ${suggestion.icon}`} aria-hidden="true" />
                  <span><strong>{suggestion.label}</strong><small>{suggestion.hint}</small></span>
                  <i className="ph-bold ph-arrow-right room-ai-action-arrow" aria-hidden="true" />
                </UiButton>
              ))}
            </div>
          </div>
        </div>

        <div className="room-ai-composer-zone">
          <details className="room-ai-sources" open={sourcesOpen}>
            <summary>
              <span className="room-ai-sources-icon" aria-hidden="true"><i className="ph-bold ph-database" /></span>
              <span className="room-ai-sources-copy"><strong>Sources &amp; details</strong><small>Room context · Access checked</small></span>
              <i className="ph-bold ph-caret-down room-ai-sources-caret" aria-hidden="true" />
            </summary>
            <div className="room-ai-sources-panel"><p className="room-ai-rail-intro">Room access is checked before context is read.</p></div>
          </details>
          <form className="room-ai-composer" aria-label="Ask Room AI" onSubmit={(event) => event.preventDefault()}>
            <textarea aria-label="Message Room AI" placeholder="Ask anything about Product launch…" rows="1" />
            <UiIconButton label="Send to Room AI" tooltip="Send" type="submit" disabled={busy}>
              <i className="ph-bold ph-paper-plane-tilt" aria-hidden="true" />
            </UiIconButton>
          </form>
        </div>
        </main>
      </div>
    </div>
  );
}

const meta = {
  title: 'AI/Room AI surface',
  component: RoomAiSurface,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const ReadyDesktop = {
  play: async ({ canvas }) => {
    const suggestionsFound = canvas.getAllByRole('button', {
      name: /Summarize what changed|Turn this into next steps/,
    });
    const smart = canvas.getByRole('button', { name: 'Smart' });

    await expect(suggestionsFound).toHaveLength(2);
    await expect(canvas.getByRole('button', { name: 'Fast' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(smart);
    await expect(smart).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Fast' }));
  },
};

export const Mobile = {
  args: {
    surfaceWidth: 390,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const host = canvasElement.querySelector('#room-view-ai');
    const fast = canvas.getByRole('button', { name: 'Fast' });
    const newChat = canvas.getByRole('button', { name: 'New chat' });

    await expect(canvas.getByLabelText('Room AI toolbar')).toBeVisible();
    await expect(newChat).toBeVisible();
    await expect(newChat.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(fast.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    await expect(canvas.getAllByLabelText('More Room AI actions')[0]).toBeVisible();
  },
};

export const Replying = {
  args: {
    busy: true,
    status: 'loading',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: /Warming up/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Fast' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Send to Room AI' })).toBeDisabled();
  },
};

export const SourcesExpanded = {
  args: {
    sourcesOpen: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Room access is checked before context is read.')).toBeVisible();
  },
};

export const ReducedMotion = {
  globals: {
    reducedMotion: 'reduce',
  },
  play: async ({ canvas }) => {
    const arrow = canvas.getAllByText('Turn this into next steps')[0]
      .closest('button')
      .querySelector('.room-ai-action-arrow');
    await expect(Number.parseFloat(getComputedStyle(arrow).transitionDuration)).toBeLessThanOrEqual(
      0.001,
    );
  },
};
