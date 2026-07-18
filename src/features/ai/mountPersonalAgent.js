import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { PersonalAIAgentLauncher } from './AI.jsx';

const personalAgentRoot = createHostAwareRoot();

export function mountPersonalAgent(props) {
  const host = document.getElementById('personal-ai-agent-root');
  if (!host) return;
  personalAgentRoot.render(host, createElement(PersonalAIAgentLauncher, {
    ...props,
    key: `${props.roomId || 'global'}:${props.channelId || 'general'}`,
  }));
}

export function unmountPersonalAgent() {
  personalAgentRoot.unmount();
}
