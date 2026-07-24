import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

export const BUILD_SOURCE_PATHS = Object.freeze([
  'src',
  'public',
  'functions',
  'legacy',
  'tools',
  'package.json',
  'package-lock.json',
  'firebase.json',
  'database.rules.json',
  'vite.config.js',
  'index.html',
  'server.js',
]);

export function normalizeReleaseValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9_-]+/, '')
    .slice(0, 64);
}

export function resolveGitRevision({
  environment = process.env,
  cwd = process.cwd(),
  execFile = execFileSync,
} = {}) {
  const providerRevision = [
    environment.GITHUB_SHA,
    environment.CI_COMMIT_SHA,
    environment.BUILD_SOURCEVERSION,
    environment.CF_PAGES_COMMIT_SHA,
  ].map(normalizeReleaseValue).find(Boolean);
  if (providerRevision) return providerRevision.slice(0, 8);

  try {
    return normalizeReleaseValue(execFile(
      'git',
      ['rev-parse', '--short=8', 'HEAD'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ));
  } catch {
    return '';
  }
}

export function resolveSourceBuildNumber({
  environment = process.env,
  cwd = process.cwd(),
  execFile = execFileSync,
  fileExists = existsSync,
  readFile = readFileSync,
} = {}) {
  const revision = resolveGitRevision({ environment, cwd, execFile });
  if (!revision) return '';

  try {
    const status = execFile(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...BUILD_SOURCE_PATHS],
      {
        cwd,
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    if (!status.length) return revision;

    const files = execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...BUILD_SOURCE_PATHS],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
      .split('\0')
      .filter(Boolean)
      .sort();
    const fingerprint = createHash('sha256');
    fingerprint.update(status);
    for (const relativePath of files) {
      const absolutePath = path.resolve(cwd, relativePath);
      fingerprint.update(relativePath);
      fingerprint.update('\0');
      fingerprint.update(fileExists(absolutePath) ? readFile(absolutePath) : 'deleted');
      fingerprint.update('\0');
    }
    return `${revision}-dirty-${fingerprint.digest('hex').slice(0, 12)}`;
  } catch {
    return revision;
  }
}

export function resolveRumReleaseId({
  environment = process.env,
  appVersion,
  sourceBuildNumber,
  cwd = process.cwd(),
} = {}) {
  const suppliedRelease = [
    environment.MINIMALIST_RUM_RELEASE_ID,
    environment.VITE_APP_RUM_RELEASE_ID,
  ].map(normalizeReleaseValue).find(Boolean);
  if (suppliedRelease) return suppliedRelease;

  const source = normalizeReleaseValue(sourceBuildNumber)
    || resolveSourceBuildNumber({ environment, cwd })
    || 'source';
  const version = (normalizeReleaseValue(appVersion) || '0.0.0').slice(0, 24);
  const sourceToken = source.length <= 39
    ? source
    : `${source.slice(0, 26)}-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
  return `${version}-${sourceToken}`.slice(0, 64);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  process.stdout.write(`${resolveSourceBuildNumber() || 'source'}\n`);
}
