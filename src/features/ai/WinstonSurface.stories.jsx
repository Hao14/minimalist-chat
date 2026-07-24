import { expect, userEvent, waitFor } from 'storybook/test';
import { UiButton } from '../../components/ui/UiButton.jsx';
import './aiAgentControls.css';
import './personalAgent.css';
import './WinstonSurface.stories.css';

function WinstonSurface() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#0d1117' }}>
      <section
        id="personal-ai-agent-panel"
        className="open pa-story-winston"
        aria-label="Winston preview"
        style={{
          position: 'relative',
          width: 'min(430px, 100%)',
          height: 'min(700px, calc(100vh - 48px))',
        }}
      >
        <header className="pa-agent-header">
          <div className="pa-agent-avatar" aria-hidden="true">W</div>
          <div className="pa-agent-identity"><strong>Winston</strong><span>Ready</span></div>
        </header>
        <div className="pa-agent-workspace">
          <div className="pa-agent-thread">
            <article
              className="pa-msg pa-msg-assistant"
              style={{ contentVisibility: 'visible', containIntrinsicSize: 'auto' }}
            >
              <div className="pa-bubble">
                <p>Here are the next steps based on the room conversation.</p>
                <section className="ai-action-cards" aria-label="Suggested actions">
                  <article className="ai-action-card is-proposed">
                    <span className="ai-action-icon"><i className="ph-bold ph-list-checks" aria-hidden="true" /></span>
                    <div className="ai-action-copy">
                      <span className="ai-action-kicker">Task suggestion</span>
                      <strong>Prepare the launch plan</strong>
                      <p>Assign the plan owner and confirm the delivery date.</p>
                      <div className="ai-action-buttons">
                        <UiButton variant="inherit"><i className="ph-bold ph-check" aria-hidden="true" /> Confirm</UiButton>
                        <UiButton variant="inherit">Cancel</UiButton>
                      </div>
                    </div>
                  </article>
                </section>
                <details className="pa-story-sources">
                  <summary><i className="ph-bold ph-stack" aria-hidden="true" /> Sources &amp; details <i className="ph-bold ph-caret-down" aria-hidden="true" /></summary>
                  <p>2 room messages · Access checked</p>
                </details>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: 'AI/Winston premium surface',
  component: WinstonSurface,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const Default = {
  globals: {
    theme: 'dark',
  },
  play: async ({ canvas }) => {
    const action = canvas.getByText('Prepare the launch plan').closest('.ai-action-card');
    const sources = canvas.getByText('Sources & details').closest('summary');

    await waitFor(() => expect(action).toBeVisible());
    await expect(getComputedStyle(action, '::before').animationName).toBe('pa-winston-action-shine');
    await userEvent.click(sources);
    await expect(canvas.getByText('2 room messages · Access checked')).toBeVisible();
    await userEvent.click(sources);
  },
};

export const Mobile = {
  globals: {
    theme: 'dark',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Winston preview' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Confirm/ })).toBeVisible();
  },
};

export const ReducedMotion = {
  globals: {
    reducedMotion: 'reduce',
    theme: 'dark',
  },
  play: async ({ canvas }) => {
    const action = canvas.getByText('Prepare the launch plan').closest('.ai-action-card');
    await expect(getComputedStyle(action, '::before').animationName).toBe('none');
  },
};
