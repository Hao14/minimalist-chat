import StoryEnvironment from './StoryEnvironment.jsx';
import '../src/react-shell.css';

/** @type {import('@storybook/react-vite').Preview} */
const preview = {
  tags: ['autodocs'],
  initialGlobals: {
    reducedMotion: 'no-preference',
    theme: 'light',
  },
  globalTypes: {
    theme: {
      description: 'Application theme',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'codex', title: 'Codex' },
        ],
      },
    },
    reducedMotion: {
      description: 'Motion preference',
      toolbar: {
        icon: 'accessibility',
        items: [
          { value: 'no-preference', title: 'Motion' },
          { value: 'reduce', title: 'Reduced motion' },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => (
      <StoryEnvironment context={context}>
        <Story />
      </StoryEnvironment>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'error',
    },
  },
};

export default preview;
