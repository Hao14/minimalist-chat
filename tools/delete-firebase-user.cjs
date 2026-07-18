'use strict';

const auth = require('firebase-tools/lib/auth');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  return values;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    process.stdout.write('delete-firebase-user parser ready\n');
    return;
  }
  if (process.argv.includes('--check-auth')) {
    const account = auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) fail('Firebase CLI is not signed in.');
    await auth.getAccessToken(account.tokens.refresh_token, []);
    process.stdout.write('Firebase administrator credential ready\n');
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const uid = String(args['--uid'] || '');
  const project = String(args['--project'] || '');
  const confirmation = String(args['--confirm-uid'] || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) fail('Invalid Firebase UID.');
  if (!/^[a-z0-9-]{4,64}$/.test(project)) fail('Invalid Firebase project ID.');
  if (confirmation !== uid) fail('Deletion confirmation does not match the target UID.');

  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) fail('Firebase CLI is not signed in.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, targetProjectId: project }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    fail(payload?.error?.message || `Identity Toolkit returned HTTP ${response.status}.`);
  }
  process.stdout.write(`Firebase Auth account ${uid} deleted.\n`);
}

main().catch((error) => fail(error?.message || 'Firebase Auth deletion failed.'));
