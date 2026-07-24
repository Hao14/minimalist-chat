import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('mobile private-message history remains a full-height vertical list through the app breakpoint', async () => {
  const css = await readSource('public/features.css');
  const visibilityRuleIndex = css.indexOf('#pm-popup .pm-shell.show-inbox .pm-sidebar');
  const visibilityBreakpoint = css.lastIndexOf('@media (max-width: 768px) {', visibilityRuleIndex);
  const sessionResetIndex = css.indexOf('#pm-popup .pm-session-list {\n        min-height: 0;');
  const responsivePmStart = css.lastIndexOf('@media (max-width: 768px) {', sessionResetIndex);
  const responsivePmEnd = css.indexOf('@media ', responsivePmStart + 1);
  const responsivePmCss = css.slice(responsivePmStart, responsivePmEnd === -1 ? css.length : responsivePmEnd);

  assert.notEqual(visibilityRuleIndex, -1);
  assert.notEqual(visibilityBreakpoint, -1);
  assert.notEqual(sessionResetIndex, -1);
  assert.notEqual(responsivePmStart, -1);
  assert.match(responsivePmCss, /#pm-popup \.pm-sidebar[\s\S]*?height: 100%;[\s\S]*?max-height: none !important;/);
  assert.match(responsivePmCss, /#pm-popup \.pm-session-list[\s\S]*?flex-direction: column !important;[\s\S]*?overflow-y: auto !important;/);
});

test('opening a private-message target restores inbox sessions and leaves inbox mode', async () => {
  const source = await readSource('src/features/private-messages/PrivateMessages.jsx');

  assert.match(source, /applyPmInboxSessions\(window\.latestPmInbox \|\| \{\}\)/);
  assert.match(source, /setMobileInboxOpen\(!event\.detail\?\.targetUid\)/);
  assert.match(source, /const sameSession = targetUid === activeTargetUid;[\s\S]*?if \(!sameSession\) \{[\s\S]*?setMessages\(\[\]\)/);
  assert.match(source, /window\.closeFloatingUI\?\.\(\{ keep: 'pm-popup', restoreFocus: false \}\)/);
});

test('read private-message contacts remain discoverable as recent conversations', async () => {
  const source = await readSource('src/features/contacts/contactsService.js');

  assert.match(source, /else if \(contact\.lastPm\) \{[\s\S]*?recentPm\.push/);
  assert.match(source, /pushSection\(sections, 'recent-pm', 'Recent Messages', recentPm\)/);
});

test('private voice calling checks accepted friendship before microphone access', async () => {
  const source = await readSource('src/features/private-messages/PrivateMessages.jsx');
  const acceptStart = source.indexOf('async function acceptPmCall(call, { openDock = true } = {})');
  const acceptFriendshipCheck = source.indexOf('await hasAcceptedPmFriendship(user.uid, call.callerUid)', acceptStart);
  const acceptMicrophoneRequest = source.indexOf('stream = await requestPmAudio()', acceptStart);
  const callStart = source.indexOf('const startVoiceCall = useCallback(async () =>');
  const friendshipCheck = source.indexOf('await hasAcceptedPmFriendship(myUid, activeSession.targetUid)', callStart);
  const microphoneRequest = source.indexOf('stream = await requestPmAudio()', callStart);

  assert.ok(acceptStart >= 0 && acceptFriendshipCheck > acceptStart);
  assert.ok(acceptMicrophoneRequest > acceptFriendshipCheck, 'incoming calls must recheck friendship before microphone access');
  assert.ok(callStart >= 0, 'voice-call startup must exist');
  assert.ok(friendshipCheck > callStart, 'voice-call startup must recheck friendship');
  assert.ok(microphoneRequest > friendshipCheck, 'friendship must be checked before requesting microphone access');
  assert.match(source, /friends\/\$\{userUid\}\/\$\{targetUid\}/);
  assert.match(source, /friendships\.values\?\.\[call\.callerUid\] !== 'accepted'[\s\S]*?declinePmCall\(call\)/);
  assert.match(source, /friendships\.values\?\.\[call\.callerUid\] === 'accepted'/);
  assert.match(source, /disabled=\{!activeSession \|\| callStarting \|\| \(!callLive && !friendCallAllowed\)\}/);
  assert.match(source, /Voice calls are available only between accepted friends\./);
});

test('private-call derived state is declared before effects consume it', async () => {
  const source = await readSource('src/features/private-messages/PrivateMessages.jsx');
  const componentStart = source.indexOf('function PrivateMessagesDock(');
  const componentEnd = source.indexOf('\nexport ', componentStart);
  assert.ok(componentStart >= 0, 'private-message dock component must exist');
  const component = source.slice(componentStart, componentEnd > componentStart ? componentEnd : undefined);
  const callLiveDeclaration = component.indexOf('const callLive = Boolean(');
  const firstCallLiveEffectUse = component.indexOf('if (!callPath || (!dockOpen && !callLive && !callStarting))');
  const friendAllowedDeclaration = component.indexOf('const friendCallAllowed = Boolean(');
  const callLiveUsesFriendship = component.indexOf('const joinedCall = Boolean(friendCallAllowed');

  assert.ok(callLiveDeclaration >= 0 && firstCallLiveEffectUse > callLiveDeclaration,
    'callLive must be initialized before an effect dependency or body reads it');
  assert.ok(friendAllowedDeclaration >= 0 && callLiveUsesFriendship > friendAllowedDeclaration,
    'friendCallAllowed must be initialized before joined-call state reads it');
});

test('incoming call listeners cover accepted friends even before a first inbox message', async () => {
  const source = await readSource('src/features/private-messages/PrivateMessages.jsx');
  const managerStart = source.indexOf('function IncomingCallManager()');
  const managerEnd = source.indexOf('\nfunction ensurePmCallPortal', managerStart);
  assert.ok(managerStart >= 0 && managerEnd > managerStart, 'incoming-call manager must exist');
  const manager = source.slice(managerStart, managerEnd);

  assert.match(manager, /const recentSenders = useMemo/);
  assert.match(
    manager,
    /const callPeerUids = useMemo\(\(\) => \[\.\.\.new Set\(\[[\s\S]*?\.\.\.recentSenders,[\s\S]*?\.\.\.Object\.entries\(friendships\.values \|\| \{\}\)[\s\S]*?status === 'accepted'/,
    'listener candidates must be the union of recent senders and accepted friends',
  );
  assert.match(manager, /callPeerUids\.map\(\(peerUid\) => \{[\s\S]*?pm_calls\/\$\{roomId\}/);
  assert.match(manager, /\[callPeerKey, uid\]/);
});

test('Winston call handoff validates thread, expiry, friendship, and consumes one intent', async () => {
  const source = await readSource('src/features/private-messages/PrivateMessages.jsx');
  const handoffStart = source.indexOf('async function startPrivateCallWithFriend(value = {})');
  const handoffEnd = source.indexOf('\nfunction openPrivateMessagesDock', handoffStart);
  assert.ok(handoffStart >= 0 && handoffEnd > handoffStart, 'Winston call handoff must exist');
  const handoff = source.slice(handoffStart, handoffEnd);

  assert.match(handoff, /threadId !== expectedThread/);
  assert.match(handoff, /callIntentExpiresAt <= Date\.now\(\)/);
  assert.match(handoff, /callIntentExpiresAt > Date\.now\(\) \+ \(5 \* 60 \* 1000\)/);
  assert.match(handoff, /await hasAcceptedPmFriendship\(userUid, targetUid\)/);
  assert.match(handoff, /pendingPmVoiceCallIntent = \{ targetUid, threadId, callIntentExpiresAt \}/);
  assert.match(source, /window\.startPrivateCallWithFriend = startPrivateCallWithFriend/);

  const consumeStart = source.indexOf('const intent = pendingPmVoiceCallIntent;');
  const clearIntent = source.indexOf('pendingPmVoiceCallIntent = null;', consumeStart);
  const scheduleCall = source.indexOf('window.setTimeout(() => void startVoiceCall(), 0);', consumeStart);
  assert.ok(consumeStart >= 0 && clearIntent > consumeStart && scheduleCall > clearIntent,
    'the confirmed intent must be consumed before asynchronous call startup');
});

test('the shell exposes one shared floating-surface arbiter', async () => {
  const source = await readSource('src/features/shell/chatShellControls.js');
  const assignments = source.match(/window\.closeFloatingUI = closeFloatingUI;/g) || [];

  assert.equal(assignments.length, 1);
});
