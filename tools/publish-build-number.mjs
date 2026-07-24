import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

export const MAX_PUBLISH_BUILD_NUMBER_LENGTH = 64;

function normalizeBuildPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9_-]+/, '')
    .slice(0, MAX_PUBLISH_BUILD_NUMBER_LENGTH);
}

export function resolvePublishSourceRevision({
  environment = process.env,
  cwd = process.cwd(),
  execFile = execFileSync,
} = {}) {
  const providerRevision = [
    environment.GITHUB_SHA,
    environment.CI_COMMIT_SHA,
    environment.BUILD_SOURCEVERSION,
    environment.CF_PAGES_COMMIT_SHA,
  ].map(normalizeBuildPart).find(Boolean);
  if (providerRevision) return providerRevision.slice(0, 12);

  try {
    return normalizeBuildPart(execFile(
      'git',
      ['rev-parse', '--short=12', 'HEAD'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ));
  } catch {
    return 'source';
  }
}

export function createPublishBuildNumber({
  sourceRevision = '',
  now = new Date(),
  nonce = randomBytes(4).toString('hex'),
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('Publish build time must be a valid Date.');
  }

  const timestamp = now.toISOString().replace(/[-:.]/g, '');
  const uniqueNonce = normalizeBuildPart(nonce).slice(0, 8);
  if (!uniqueNonce) throw new TypeError('Publish build nonce is required.');

  // Keep the unique publish portion first so release-label truncation can never
  // erase the part that distinguishes two publishes of identical source.
  const uniquePrefix = `p${timestamp}-${uniqueNonce}`;
  const source = normalizeBuildPart(sourceRevision).slice(0, 8);
  const sourceSuffix = source ? `-${source}` : '';
  return `${uniquePrefix}${sourceSuffix}`.slice(0, MAX_PUBLISH_BUILD_NUMBER_LENGTH);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  const sourceRevision = process.argv[2] || resolvePublishSourceRevision();
  process.stdout.write(`${createPublishBuildNumber({ sourceRevision })}\n`);
}
