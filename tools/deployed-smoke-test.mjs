import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROJECT_ID = process.env.FIREBASE_PROJECT || 'chat-app-356c1';
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://chat-app-356c1-default-rtdb.firebaseio.com';
const API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDAnwh1kYnomfGIMM71J9tCY3tuOV0ejnE';
const REGION = process.env.FIREBASE_FUNCTION_REGION || 'us-central1';
const FUNCTION_ORIGIN = process.env.FIREBASE_FUNCTION_ORIGIN || `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
const APP_CHECK_TOKEN = String(process.env.FIREBASE_APP_CHECK_TOKEN || '').trim();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebaseNode22 = path.join(repoRoot, 'tools', 'firebase-node22.ps1');

const runId = `codex-smoke-${Date.now()}`;
const email = `${runId}@example.invalid`;
const friendEmail = `${runId}-friend@example.invalid`;
const password = `Smoke-${Date.now()}-Aa1!`;
const globalMessageId = runId;
const roomId = `${runId}-room`;
const roomMessageId = `${runId}-room-message`;
const issueHourBucket = String(Math.floor(Date.now() / (60 * 60 * 1000)));

const state = {
  idToken: '',
  friendIdToken: '',
  uid: '',
  friendUid: '',
  issueId: '',
  cleanupWarnings: [],
};

function authUrl(method) {
  return `https://identitytoolkit.googleapis.com/v1/${method}?key=${API_KEY}`;
}

function dbUrl(pathname, token = state.idToken) {
  const cleanPath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(`${DATABASE_URL.replace(/\/$/, '')}/${cleanPath}.json`);
  if (token) url.searchParams.set('auth', token);
  return url.toString();
}

async function postJson(url, body, headers = {}) {
  const appCheckHeaders = APP_CHECK_TOKEN ? { 'X-Firebase-AppCheck': APP_CHECK_TOKEN } : {};
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...appCheckHeaders, ...headers },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function putJson(pathname, body) {
  const response = await fetch(dbUrl(pathname), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function putJsonWithToken(pathname, body, token) {
  const response = await fetch(dbUrl(pathname, token), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function getJson(pathname, token = state.idToken) {
  const response = await fetch(dbUrl(pathname, token));
  return parseResponse(response);
}

async function deleteJson(pathname) {
  const response = await fetch(dbUrl(pathname), { method: 'DELETE' });
  return parseResponse(response);
}

async function parseResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
    text: text.slice(0, 700),
  };
}

function assertOk(step, result, predicate = (value) => value.ok) {
  if (!predicate(result)) {
    throw new Error(`${step} failed (${result?.status || 'no status'}): ${JSON.stringify(result?.json || result?.text || result)}`);
  }
  return result;
}

function assertPermissionDenied(step, result) {
  return assertOk(step, result, (value) => !value.ok && [401, 403].includes(value.status));
}

async function safeCleanup(label, task) {
  try {
    await task();
  } catch (error) {
    state.cleanupWarnings.push(`${label}: ${error.message || String(error)}`);
  }
}

function removeWithFirebaseCli(dbPath) {
  if (!existsSync(firebaseNode22)) {
    state.cleanupWarnings.push(`Missing ${firebaseNode22}; could not remove ${dbPath}`);
    return;
  }

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    firebaseNode22,
    'database:remove',
    dbPath,
    '--project',
    PROJECT_ID,
    '--force',
    '--disable-triggers',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    state.cleanupWarnings.push(`firebase database:remove ${dbPath} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

async function cleanup() {
  if (state.idToken) {
    await safeCleanup('delete global smoke message', () => deleteJson(`messages/${globalMessageId}`));
    await safeCleanup('delete global typing smoke row', () => deleteJson(`typing/global/general/${state.uid}`));
    await safeCleanup('delete room typing smoke row', () => deleteJson(`typing/${roomId}/general/${state.uid}`));
    await safeCleanup('delete room smoke message tree', () => deleteJson(`rooms_data/${roomId}`));
    await safeCleanup('delete room smoke metadata', () => deleteJson(`rooms_meta/${roomId}`));
    await safeCleanup('delete user room index', () => deleteJson(`user_rooms/${state.uid}/${roomId}`));
    await safeCleanup('delete user directory row', () => deleteJson(`user_directory/${state.uid}`));
    if (state.friendUid) {
      await safeCleanup('delete friend edge from primary user', () => deleteJson(`friends/${state.uid}/${state.friendUid}`));
      await safeCleanup('delete friend edge from secondary user', () => deleteJson(`friends/${state.friendUid}/${state.uid}`));
    }
  }

  if (state.friendIdToken && state.friendUid) {
    await safeCleanup('delete secondary user room index', async () => {
      const response = await fetch(dbUrl(`user_rooms/${state.friendUid}/${roomId}`, state.friendIdToken), { method: 'DELETE' });
      const parsed = await parseResponse(response);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.json || parsed.text));
    });
    await safeCleanup('delete secondary user directory row', async () => {
      const response = await fetch(dbUrl(`user_directory/${state.friendUid}`, state.friendIdToken), { method: 'DELETE' });
      const parsed = await parseResponse(response);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.json || parsed.text));
    });
  }

  if (state.friendUid && state.uid) {
    removeWithFirebaseCli(`/notifications/${state.friendUid}/friend_${state.uid}`);
  }
  if (state.issueId) {
    removeWithFirebaseCli(`/support_issue_queue/${state.issueId}`);
  }
  if (state.uid) {
    removeWithFirebaseCli(`/support_issue_rate/${state.uid}/${issueHourBucket}`);
  }

  if (state.idToken) {
    const deleted = await postJson(authUrl('accounts:delete'), { idToken: state.idToken });
    if (!deleted.ok) state.cleanupWarnings.push(`auth delete failed: ${JSON.stringify(deleted.json || deleted.text)}`);
  }
  if (state.friendIdToken) {
    const deleted = await postJson(authUrl('accounts:delete'), { idToken: state.friendIdToken });
    if (!deleted.ok) state.cleanupWarnings.push(`secondary auth delete failed: ${JSON.stringify(deleted.json || deleted.text)}`);
  }
}

async function main() {
  const results = [];

  try {
    const signup = assertOk('create disposable auth user', await postJson(authUrl('accounts:signUp'), {
      email,
      password,
      returnSecureToken: true,
    }));
    state.idToken = signup.json.idToken;
    state.uid = signup.json.localId;
    results.push({ step: 'auth signup', ok: true, uid: state.uid });

    const friendSignup = assertOk('create secondary disposable auth user', await postJson(authUrl('accounts:signUp'), {
      email: friendEmail,
      password,
      returnSecureToken: true,
    }));
    state.friendIdToken = friendSignup.json.idToken;
    state.friendUid = friendSignup.json.localId;
    results.push({ step: 'secondary auth signup', ok: true, uid: state.friendUid });

    assertOk('write user directory', await putJson(`user_directory/${state.uid}`, {
      displayName: 'Codex Smoke',
      photoUrl: '',
      shortId: 'SMOKE',
      username: 'codex-smoke',
      pronouns: 'they/them',
      bio: 'Authenticated deployed smoke-test profile.',
      status: 'Available',
      flair: 'QA',
      themeColor: '#FFD700',
      updatedAt: Date.now(),
    }));
    results.push({ step: 'user directory write', ok: true });
    assertOk('write secondary user directory', await putJsonWithToken(`user_directory/${state.friendUid}`, {
      displayName: 'Codex Smoke Friend',
      photoUrl: '',
      shortId: 'SMOKEF',
      username: 'codex-smoke-friend',
      pronouns: '',
      bio: 'Secondary authenticated smoke-test profile.',
      status: 'Available',
      flair: 'QA',
      themeColor: '#FFD700',
      updatedAt: Date.now(),
    }, state.friendIdToken));
    results.push({ step: 'secondary user directory write', ok: true });
    assertPermissionDenied('cross-user directory write', await putJson(`user_directory/${state.friendUid}`, {
      displayName: 'Cross-user overwrite',
      photoUrl: '',
      shortId: 'DENIED',
      username: 'denied',
      pronouns: '',
      bio: '',
      status: '',
      flair: '',
      themeColor: '#FFD700',
      updatedAt: Date.now(),
    }));
    results.push({ step: 'cross-user directory write denied', ok: true });

    assertOk('write global chat message', await putJson(`messages/${globalMessageId}`, {
      uid: state.uid,
      name: 'Codex Smoke',
      text: 'Codex deployed smoke test: global chat write.',
      timestamp: Date.now(),
    }));
    results.push({ step: 'global chat write', ok: true, path: `/messages/${globalMessageId}` });
    assertOk('write global channel typing', await putJson(`typing/global/general/${state.uid}`, 'Codex Smoke'));
    results.push({ step: 'global channel typing write', ok: true, path: `/typing/global/general/${state.uid}` });

    assertOk('create private room', await putJson(`rooms_meta/${roomId}`, {
      name: 'Codex Smoke Room',
      shortId: 'SMOKE',
      creatorId: state.uid,
      private: true,
      public: false,
      createdAt: Date.now(),
      members: {
        [state.uid]: 'Codex Smoke',
      },
      channels: {
        general: {
          name: 'general',
          createdAt: Date.now(),
          by: state.uid,
        },
      },
    }));
    results.push({ step: 'private room create', ok: true, path: `/rooms_meta/${roomId}` });

    const userRoomIndexRow = {
      name: 'Codex Smoke Room',
      shortId: 'SMOKE',
      lastMessage: 'Private room created',
      creatorId: state.uid,
      updatedAt: Date.now(),
    };
    assertOk('write own user room index', await putJson(`user_rooms/${state.uid}/${roomId}`, userRoomIndexRow));
    results.push({ step: 'own user room index write', ok: true, path: `/user_rooms/${state.uid}/${roomId}` });
    assertOk(
      'read own user room index',
      await getJson(`user_rooms/${state.uid}/${roomId}`),
      (value) => value.ok
        && value.json?.name === userRoomIndexRow.name
        && value.json?.shortId === userRoomIndexRow.shortId
        && value.json?.creatorId === userRoomIndexRow.creatorId,
    );
    results.push({ step: 'own user room index read', ok: true, path: `/user_rooms/${state.uid}/${roomId}` });
    assertPermissionDenied(
      'read another user room index',
      await getJson(`user_rooms/${state.friendUid}/${roomId}`),
    );
    results.push({ step: 'cross-user room index read denied', ok: true });
    assertPermissionDenied(
      'write another user room index',
      await putJson(`user_rooms/${state.friendUid}/${roomId}`, userRoomIndexRow),
    );
    results.push({ step: 'cross-user room index write denied', ok: true });

    assertOk('write private room message', await putJson(`rooms_data/${roomId}/messages/${roomMessageId}`, {
      uid: state.uid,
      name: 'Codex Smoke',
      text: 'Codex deployed smoke test: private room write.',
      timestamp: Date.now(),
    }));
    results.push({ step: 'private room message write', ok: true, path: `/rooms_data/${roomId}/messages/${roomMessageId}` });
    assertOk('write private room channel typing', await putJson(`typing/${roomId}/general/${state.uid}`, 'Codex Smoke'));
    results.push({ step: 'private room channel typing write', ok: true, path: `/typing/${roomId}/general/${state.uid}` });

    for (const modelProfile of ['fast', 'smart']) {
      const aiStatus = assertOk(`ai gateway ${modelProfile} status`, await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
        action: 'status',
        modelProfile,
      }, {
        Authorization: `Bearer ${state.idToken}`,
      }), (value) => value.status === 200
        && value.json?.provider === 'ollama-bridge'
        && value.json?.modelProfile === modelProfile
        && value.json?.profiles?.find?.((profile) => profile.id === modelProfile)?.installed === true);
      results.push({ step: `ai gateway ${modelProfile} status`, ok: true, provider: aiStatus.json.provider, model: aiStatus.json.model });
    }

    assertOk('create friend edge primary', await putJson(`friends/${state.uid}/${state.friendUid}`, 'pending_sent'));
    assertOk('create friend edge secondary', await putJson(`friends/${state.friendUid}/${state.uid}`, 'pending_received'));
    const notification = assertOk('trusted notification endpoint', await postJson(`${FUNCTION_ORIGIN}/createNotification`, {
      targetUid: state.friendUid,
      type: 'friend',
      text: 'Codex Smoke sent you a friend request.',
      groupId: state.uid,
      from: 'Codex Smoke',
    }, {
      Authorization: `Bearer ${state.idToken}`,
    }));
    results.push({ step: 'trusted notification endpoint', ok: notification.ok });

    const issue = assertOk('submit issue draft', await postJson(`${FUNCTION_ORIGIN}/submitIssueDraft`, {
      title: 'Codex deployed smoke issue',
      summary: 'Automated deployed smoke test for the authenticated issue queue.',
      steps: 'Create disposable Auth user, call submitIssueDraft, then clean queue rows.',
      expected: 'The function queues a sanitized issue draft.',
      actual: 'The function returned an issue id.',
      roomId: 'global',
      url: 'https://chat-app-356c1.web.app/chat',
      clientMeta: { source: 'tools/deployed-smoke-test.mjs', runId },
    }, {
      Authorization: `Bearer ${state.idToken}`,
    }), (value) => value.status === 200 && value.json?.issueId);
    state.issueId = issue.json.issueId;
    results.push({ step: 'issue draft queue', ok: true, issueId: state.issueId });

    console.log(JSON.stringify({
      ok: true,
      project: PROJECT_ID,
      databaseUrl: DATABASE_URL,
      email,
      friendEmail,
      uid: state.uid,
      friendUid: state.friendUid,
      results,
    }, null, 2));
  } finally {
    await cleanup();
    if (state.cleanupWarnings.length) {
      console.warn(JSON.stringify({ cleanupWarnings: state.cleanupWarnings }, null, 2));
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
