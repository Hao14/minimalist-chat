import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PersonalAIAgentLauncher } from './AI.jsx';

let personalAgentRoot = null;

export function mountPersonalAgent(props) {
  const host = document.getElementById('personal-ai-agent-root');
  if (!host) return;
  if (!personalAgentRoot) {
    host.replaceChildren();
    personalAgentRoot = createRoot(host);
  }
  personalAgentRoot.render(createElement(PersonalAIAgentLauncher, props));
}
