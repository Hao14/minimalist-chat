import { readFileSync } from 'node:fs';
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const projectId = 'chat-app-356c1';
const databaseUrl = `https://${projectId}-default-rtdb.firebaseio.com`;
const testEnv = await initializeTestEnvironment({
  projectId,
  database: { rules: readFileSync('database.rules.json', 'utf8') },
});

try {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.database(databaseUrl);
    await admin.ref('ai_agent_private/member-user/memories/memory_123456').set({
      text: 'private preference', scope: 'personal', createdAt: 1, updatedAt: 1,
    });
    await admin.ref(`ai_agent_private/member-user/actions/${'a'.repeat(64)}`).set({
      ownerUid: 'member-user', type: 'create_task', status: 'proposed', expiresAt: Date.now() + 60000,
      payload: { roomId: 'global', text: 'private proposed task' },
    });
  });

  const owner = testEnv.authenticatedContext('member-user').database(databaseUrl);
  const outsider = testEnv.authenticatedContext('outsider-user').database(databaseUrl);
  const anonymous = testEnv.unauthenticatedContext().database(databaseUrl);
  await assertFails(owner.ref('ai_agent_private/member-user').get());
  await assertFails(outsider.ref('ai_agent_private/member-user').get());
  await assertFails(anonymous.ref('ai_agent_private/member-user').get());
  await assertFails(owner.ref('ai_agent_private/member-user/memories/memory_123456').set({ text: 'changed' }));
  await assertFails(owner.ref(`ai_agent_private/member-user/actions/${'a'.repeat(64)}`).remove());
  console.log('PASS Winston memories and action proposals are server-only in RTDB');
} finally {
  await testEnv.cleanup();
}
