import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { SettingsRow } from './SettingsRow.jsx';
import { UiButton, UiIconButton, UiSeparator } from './UiButton.jsx';

function PrimitiveGallery() {
  const [roomAiVisible, setRoomAiVisible] = useState(true);

  return (
    <main
      style={{
        width: 'min(720px, calc(100vw - 32px))',
        margin: '32px auto',
        display: 'grid',
        gap: 24,
        color: 'var(--text-color, #111)',
      }}
    >
      <section aria-labelledby="button-title" style={{ display: 'grid', gap: 12 }}>
        <h2 id="button-title" style={{ fontSize: 18, margin: 0 }}>Compact actions</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <UiButton>Primary</UiButton>
          <UiButton variant="secondary">Secondary</UiButton>
          <UiButton variant="outline">Outline</UiButton>
          <UiButton variant="ghost">Ghost</UiButton>
          <UiButton variant="danger">Delete</UiButton>
          <UiIconButton label="More actions" variant="outline">
            <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
          </UiIconButton>
        </div>
      </section>

      <UiSeparator />

      <section aria-labelledby="row-title" style={{ display: 'grid', gap: 8 }}>
        <h2 id="row-title" style={{ fontSize: 18, margin: 0 }}>Open setting rows</h2>
        <div style={{ border: '1px solid var(--ui-border)', borderRadius: 12, overflow: 'hidden' }}>
          <SettingsRow
            as="button"
            description="System"
            leading={<i className="ph-bold ph-moon-stars" aria-hidden="true" />}
            title="Theme"
            trailing={<i className="ph-bold ph-caret-right" aria-hidden="true" />}
          />
          <SettingsRow
            aria-checked={roomAiVisible}
            as="button"
            description={roomAiVisible ? 'Shown on this device' : 'Hidden on this device'}
            leading={<i className="ph-bold ph-sparkle" aria-hidden="true" />}
            onClick={() => setRoomAiVisible((visible) => !visible)}
            role="switch"
            title="Room AI"
            trailing={<strong>{roomAiVisible ? 'On' : 'Off'}</strong>}
          />
        </div>
      </section>
    </main>
  );
}

const meta = {
  title: 'Design system/Compact primitives',
  component: PrimitiveGallery,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const Light = {
  play: async ({ canvas }) => {
    const switchRow = canvas.getByRole('switch', { name: /Room AI/i });
    const more = canvas.getByRole('button', { name: 'More actions' });

    await expect(switchRow).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(switchRow);
    await expect(switchRow).toHaveAttribute('aria-checked', 'false');
    await expect(more).toHaveAttribute('data-ui-tooltip', 'More actions');
  },
};

export const Dark = {
  globals: {
    theme: 'dark',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Compact actions' })).toBeVisible();
  },
};

export const Mobile = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'More actions' })).toBeVisible();
    await expect(canvas.getByRole('switch', { name: /Room AI/i })).toBeVisible();
  },
};

export const ReducedMotion = {
  globals: {
    reducedMotion: 'reduce',
  },
  play: async ({ canvas }) => {
    const primary = canvas.getByRole('button', { name: 'Primary' });
    await expect(Number.parseFloat(getComputedStyle(primary).transitionDuration)).toBeLessThanOrEqual(
      0.001,
    );
  },
};
