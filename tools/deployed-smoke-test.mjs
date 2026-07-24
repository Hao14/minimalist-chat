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
  aiJobId: '',
  aiCleanupBlocked: false,
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

async function manageFriendship(action, targetUid, token = state.idToken) {
  return postJson(`${FUNCTION_ORIGIN}/manageFriendship`, { action, targetUid }, {
    Authorization: `Bearer ${token}`,
  });
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
  const result = await parseResponse(response);
  if (!result.ok) {
    throw new Error(`DELETE ${pathname} failed (${result.status}): ${JSON.stringify(result.json || result.text)}`);
  }
  return result;
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

async function waitForAiCompletion(initial, timeoutMs = 150000) {
  let current = initial;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!current?.ok) {
      throw new Error(`AI completion failed (${current?.status || 'no status'}): ${JSON.stringify(current?.json || current?.text || current)}`);
    }
    const payload = current.json || {};
    const payloadJobId = String(payload.jobId || '').trim();
    if (/^[a-f0-9]{64}$/.test(payloadJobId)) state.aiJobId = payloadJobId;
    if (typeof payload.reply === 'string' && payload.reply.trim()) return current;
    if (payload.status === 'failed' || payload.status === 'cancelled') {
      throw new Error(`AI completion ${payload.status}: ${payload.error || payload.code || 'unknown error'}`);
    }
    const jobId = String(payload.jobId || state.aiJobId || '').trim();
    if (!jobId || (!payload.queued && !['queued', 'running'].includes(payload.status))) {
      throw new Error(`AI completion returned neither a reply nor a queue job: ${JSON.stringify(payload)}`);
    }
    state.aiJobId = jobId;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
      action: 'queue-status',
      jobId,
    }, {
      Authorization: `Bearer ${state.idToken}`,
    });
  }
  throw new Error(`AI completion did not finish within ${timeoutMs}ms.`);
}

async function cleanupAiJob() {
  if (!state.aiJobId || !state.idToken) return;
  // Preserve the account and AI state unless a terminal canonical job is
  // positively observed. This avoids corrupting a worker that wins a
  // queued-to-running race during cleanup.
  state.aiCleanupBlocked = true;
  let status = await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
    action: 'queue-status',
    jobId: state.aiJobId,
  }, {
    Authorization: `Bearer ${state.idToken}`,
  });
  if (!status.ok && status.status === 404) {
    state.aiCleanupBlocked = false;
    return;
  }
  if (!status.ok) {
    throw new Error(`AI job status failed (${status.status}): ${JSON.stringify(status.json || status.text)}`);
  }
  if (status.json?.status === 'queued') {
    const cancelled = await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
      action: 'cancel-job',
      jobId: state.aiJobId,
    }, {
      Authorization: `Bearer ${state.idToken}`,
    });
    if (!cancelled.ok) {
      status = await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
        action: 'queue-status',
        jobId: state.aiJobId,
      }, {
        Authorization: `Bearer ${state.idToken}`,
      });
      if (!status.ok) {
        throw new Error(`AI job cancellation/status recovery failed (${status.status}): ${JSON.stringify(status.json || status.text)}`);
      }
    } else {
      status = cancelled;
    }
  }
  if (status.json?.status === 'running') {
    throw new Error('AI job is still running; left intact so its worker can settle capacity safely.');
  }
  if (!['completed', 'failed', 'cancelled'].includes(status.json?.status)) {
    throw new Error(`AI job has an unsafe cleanup state: ${status.json?.status || 'unknown'}.`);
  }
  state.aiCleanupBlocked = false;
  removeWithFirebaseCli(`/ai_runtime/text_request_queue_v1/jobs/${state.aiJobId}`);
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
  await safeCleanup('settle AI smoke job', cleanupAiJob);
  if (state.idToken) {
    await safeCleanup('delete global smoke message', () => deleteJson(`messages/${globalMessageId}`));
    await safeCleanup('delete global typing smoke row', () => deleteJson(`typing/global/general/${state.uid}`));
    await safeCleanup('delete room typing smoke row', () => deleteJson(`typing/${roomId}/general/${state.uid}`));
    await safeCleanup('delete room smoke message tree', () => deleteJson(`rooms_data/${roomId}`));
    await safeCleanup('delete room smoke metadata', () => deleteJson(`rooms_meta/${roomId}`));
    await safeCleanup('delete user room index', () => deleteJson(`user_rooms/${state.uid}/${roomId}`));
    await safeCleanup('delete user directory row', () => deleteJson(`user_directory/${state.uid}`));
    if (!state.aiCleanupBlocked) {
      await safeCleanup('delete user profile row', () => deleteJson(`users/${state.uid}`));
    }
    if (state.friendUid) {
      await safeCleanup('remove friendship through trusted endpoint', async () => {
        const result = await manageFriendship('remove', state.friendUid);
        if (!result.ok) throw new Error(JSON.stringify(result.json || result.text));
      });
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
  if (state.uid && !state.aiCleanupBlocked) {
    removeWithFirebaseCli(`/ai_usage/${state.uid}`);
    removeWithFirebaseCli(`/ai_audit/${state.uid}`);
    removeWithFirebaseCli(`/ai_queue_status/${state.uid}`);
  }
  if (state.idToken && !state.aiCleanupBlocked) {
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

    assertOk('write own user profile', await putJson(`users/${state.uid}`, {
      name: 'Codex Smoke',
      email,
      shortId: 'SMOKE',
      createdAt: Date.now(),
    }));
    results.push({ step: 'own user profile write', ok: true });

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
        routingPolicy: 'balanced',
        wake: true,
      }, {
        Authorization: `Bearer ${state.idToken}`,
      }), (value) => value.ok
        && value.status === 200
        && value.json?.ok === true
        && ['ollama-bridge', 'multi-provider-router', 'groq-fallback'].includes(value.json?.provider)
        && value.json?.modelProfile === modelProfile
        && value.json?.profiles?.some?.((profile) => (
          profile.id === modelProfile
          && (value.json?.provider !== 'ollama-bridge' || profile.installed === true)
        ))
        && (value.json?.provider !== 'multi-provider-router'
          || (
            Array.isArray(value.json?.routing?.tiers)
            && value.json.routing.tiers.length > 0
            && (!value.json.degraded
              || value.json.degradedProviders?.includes?.('ollama-bridge'))
            && (!value.json.degraded || Boolean(
              value.json.routing?.models?.cloudflare
              || value.json.routing?.models?.groq
            ))
          )));
      results.push({
        step: `ai gateway ${modelProfile} status`,
        ok: true,
        provider: aiStatus.json.provider,
        model: aiStatus.json.model,
        degraded: aiStatus.json.degraded === true,
        degradedProviders: aiStatus.json.degradedProviders || [],
      });
    }

    const aiCompletion = await waitForAiCompletion(await postJson(`${FUNCTION_ORIGIN}/aiGateway`, {
      mode: 'room',
      roomId,
      channelId: 'general',
      messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
      modelProfile: 'fast',
      routingPolicy: 'balanced',
      verificationMode: 'off',
      requestId: `${runId}-ai`,
    }, {
      Authorization: `Bearer ${state.idToken}`,
    }));
    assertOk('ai gateway minimal completion', aiCompletion, (value) => (
      value.ok
      && typeof value.json?.reply === 'string'
      && /^[^A-Za-z0-9]{0,8}READY[^A-Za-z0-9]{0,8}$/i.test(value.json.reply.trim())
      && value.json?.modelProfile === 'fast'
      && ['ollama-bridge', 'cloudflare-workers-ai', 'groq', 'multi-provider-router', 'groq-fallback']
        .includes(value.json?.provider)
      && typeof value.json?.model === 'string'
      && value.json.model.trim().length > 0
    ));
    results.push({
      step: 'ai gateway minimal completion',
      ok: true,
      provider: aiCompletion.json.provider,
      model: aiCompletion.json.model,
      jobId: aiCompletion.json.jobId || state.aiJobId || '',
    });

    assertPermissionDenied(
      'raw friendship projection writes are denied',
      await putJson(`friends/${state.uid}/${state.friendUid}`, 'accepted'),
    );
    const friendRequest = assertOk(
      'trusted friendship endpoint sends request',
      await manageFriendship('send', state.friendUid),
      (value) => value.status === 200 && value.json?.friendship?.status === 'pending_sent',
    );
    results.push({ step: 'trusted friendship request endpoint', ok: friendRequest.ok });
    assertOk(
      'friendship request caller projection',
      await getJson(`friends/${state.uid}/${state.friendUid}`),
      (value) => value.ok && value.json === 'pending_sent',
    );
    assertOk(
      'friendship request recipient projection',
      await getJson(`friends/${state.friendUid}/${state.uid}`, state.friendIdToken),
      (value) => value.ok && value.json === 'pending_received',
    );
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
    const acceptedFriendship = assertOk(
      'trusted friendship endpoint accepts request',
      await manageFriendship('accept', state.uid, state.friendIdToken),
      (value) => value.status === 200 && value.json?.friendship?.status === 'accepted',
    );
    results.push({ step: 'trusted friendship accept endpoint', ok: acceptedFriendship.ok });
    assertOk(
      'friendship acceptance caller projection',
      await getJson(`friends/${state.uid}/${state.friendUid}`),
      (value) => value.ok && value.json === 'accepted',
    );
    assertOk(
      'friendship acceptance recipient projection',
      await getJson(`friends/${state.friendUid}/${state.uid}`, state.friendIdToken),
      (value) => value.ok && value.json === 'accepted',
    );

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
