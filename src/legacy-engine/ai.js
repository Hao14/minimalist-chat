import { mountAI } from '../features/ai/mountAI.js';
import { mountPersonalAgent } from '../features/ai/mountPersonalAgent.js';

window.loadRoomAI = function loadRoomAI() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountAI({
    roomId: window.activeRoomId,
    aiChatEndpoint: window.AI_CHAT_ENDPOINT || '',
  });
};

window.openPersonalAgent = function openPersonalAgent() {
  if (!window.currentUser) return;
  document.getElementById('contacts-panel')?.classList.remove('open');
  document.getElementById('updates-panel')?.classList.remove('open');
  const panel = document.getElementById('personal-ai-agent-panel');
  if (!panel) return;
  panel.classList.add('open');
  mountPersonalAgent({
    roomId: window.activeRoomId || 'global',
    personalAiAgentEndpoint: window.PERSONAL_AI_AGENT_ENDPOINT || '',
  });
};
