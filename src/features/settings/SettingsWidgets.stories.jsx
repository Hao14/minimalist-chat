import { expect, userEvent } from 'storybook/test';
import {
  ProfileCompleteness,
  SettingsShellPreview,
} from './SettingsWidgets.jsx';
import './settingsShell.css';

const meta = {
  title: 'Settings/Modern shell',
  component: SettingsShellPreview,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const DesktopLight = {
  args: {
    initialTab: 'Appearance',
    mobile: false,
    plan: 'Free',
    state: 'ready',
    theme: 'light',
  },
  play: async ({ canvas }) => {
    const activeTab = canvas.getByRole('tab', { name: 'Appearance' });
    const roomAiSwitch = canvas.getByRole('switch', { name: /Room AI/i });

    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await expect(getComputedStyle(activeTab).minHeight).toBe('40px');
    await expect(roomAiSwitch).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(roomAiSwitch);
    await expect(roomAiSwitch).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(roomAiSwitch);
    await expect(roomAiSwitch).toHaveAttribute('aria-checked', 'true');
    await userEvent.tab();
  },
};

export const MobileDark = {
  args: {
    initialTab: 'Account',
    mobile: true,
    plan: 'Free',
    state: 'ready',
    theme: 'dark',
  },
  play: async ({ canvas }) => {
    const accountTab = canvas.getByRole('tab', { name: 'Account' });
    await expect(getComputedStyle(accountTab).minHeight).toBe('44px');
  },
};

export const Pro = {
  args: {
    initialTab: 'Appearance',
    plan: 'Pro',
    state: 'ready',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Pro')).toBeVisible();
  },
};

export const Loading = {
  args: {
    initialTab: 'Notifications',
    state: 'loading',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading settings');
  },
};

export const Error = {
  args: {
    initialTab: 'Billing',
    state: 'error',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Settings could not be loaded');
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

export const Empty = {
  args: {
    initialTab: 'Performance',
    state: 'empty',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No custom preferences yet')).toBeVisible();
  },
};

export const ReducedMotion = {
  args: {
    initialTab: 'Appearance',
    reducedMotion: true,
    state: 'ready',
  },
  play: async ({ canvas }) => {
    const activeTab = canvas.getByRole('tab', { name: 'Appearance' });
    await expect(getComputedStyle(activeTab).transitionDuration).toBe('0s');
  },
};

export const ProfileInProgress = {
  render: () => (
    <div className="profile-completeness" style={{ maxWidth: 360, margin: 24 }}>
      <ProfileCompleteness
        percent={60}
        done={3}
        total={5}
        missing={['bio', 'profile photo']}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    const progressBar = canvas.getByRole('progressbar', {
      name: 'Profile completeness',
    });
    await expect(progressBar).toHaveAttribute('aria-valuenow', '60');
  },
};

export const ProfileComplete = {
  render: () => (
    <div className="profile-completeness" style={{ maxWidth: 360, margin: 24 }}>
      <ProfileCompleteness
        percent={100}
        done={5}
        total={5}
        missing={[]}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('All set!')).toBeVisible();
  },
};
