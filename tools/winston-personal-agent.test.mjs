import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const aiSource = readFileSync(new URL('../src/features/ai/AI.jsx', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/features/ai/localAiClient.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const loaderSource = readFileSync(new URL('../src/features/shell/roomFeatureLoaders.js', import.meta.url), 'utf8');
const personalAgentCss = readFileSync(new URL('../src/features/ai/personalAgent.css', import.meta.url), 'utf8');
const chatPageSource = readFileSync(new URL('../src/pages/ChatPage.jsx', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../public/base.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../public/mobile.css', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('Winston is the fixed personal-agent identity on the client and server', () => {
  assert.match(aiSource, /const WINSTON_NAME = 'Winston'/);
  assert.match(aiSource, /name: WINSTON_NAME/);
  assert.match(aiSource, /winston-gorilla-v1\.webp/);
  assert.doesNotMatch(aiSource, /Agent name\s*\n\s*<input/);

  const sanitizer = sourceBetween(serverSource, 'function sanitizePersonalAiProfile', 'function personalProfileContext');
  assert.match(sanitizer, /name: PERSONAL_AGENT_NAME/);
  assert.doesNotMatch(sanitizer, /profile\.name/);
  assert.match(clientSource, /`Agent name: \$\{PERSONAL_AGENT_NAME\}`/);
});

test('the locked flow waits for Settings before selecting Billing', () => {
  const handler = sourceBetween(aiSource, 'const openProPlan = async', '// Pro upsell.');
  const closeAt = handler.indexOf('closePersonalAgent');
  const settingsAt = handler.indexOf('await window.openSettings');
  const billingAt = handler.indexOf("window.switchTab?.('pane-billing', 'tab-btn-billing')");
  assert.ok(closeAt >= 0 && settingsAt > closeAt && billingAt > settingsAt);
});

test('the Winston drawer manages modal state and keyboard focus', () => {
  assert.match(loaderSource, /setAttribute\('aria-modal', 'false'\)/);
  assert.match(loaderSource, /personalAgentLastFocus/);
  assert.match(loaderSource, /returnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(loaderSource, /focusPersonalAgentPanel\(panel\)/);
});

test('gateway disclosure, setup scrolling, and cross-panel cleanup stay truthful', () => {
  assert.match(aiSource, /gateway\s*\? `Protected gateway/);
  assert.match(aiSource, /On-device companion · Local setup/);
  assert.match(personalAgentCss, /\.pa-agent-workspace\.is-settings-open\s*\{[^}]*overflow-y: auto/s);
  const openVault = sourceBetween(loaderSource, 'window.openVault = async function openVault', "['#open-vault-btn', '#open-vault-btn-mobile']");
  assert.match(openVault, /window\.closePersonalAgent\?\.\(\{ restoreFocus: false \}\)/);
});

test('conversation turns expose speaker identity to assistive technology', () => {
  assert.match(aiSource, /className="pa-sr-only">Winston: /);
  assert.match(aiSource, /message\.role === 'assistant' \? 'Winston: ' : 'You: '/);
});

test('navigation keeps the standard AI icon while Winston owns the profile portrait', () => {
  const desktopTrigger = sourceBetween(chatPageSource, 'id: "open-personal-agent-btn",', 'id: "open-vault-btn",');
  const mobileTrigger = sourceBetween(chatPageSource, 'id: "open-personal-agent-btn-mobile",', 'id: "open-contacts-btn-mobile",');

  assert.match(desktopTrigger, /className: "ph-bold ph-sparkle"/);
  assert.match(mobileTrigger, /className: "ph-bold ph-sparkle"/);
  assert.doesNotMatch(desktopTrigger, /winston-gorilla-v1|winston-nav-avatar|h\("img"/);
  assert.doesNotMatch(mobileTrigger, /winston-gorilla-v1|winston-nav-avatar|h\("img"/);
  assert.doesNotMatch(baseCss, /\.winston-nav-avatar/);
  assert.doesNotMatch(mobileCss, /\.winston-nav-avatar/);
  assert.match(aiSource, /function WinstonAvatar/);
  assert.match(aiSource, /src=\{WINSTON_AVATAR_SRC\}/);
});
