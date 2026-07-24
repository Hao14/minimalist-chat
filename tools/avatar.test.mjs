import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialsAvatarDataUrl,
  isLegacyRemoteAvatarUrl,
  normalizeStoredAvatarUrl,
  resolveAvatarSource,
} from '../src/lib/avatar.js';

function decodeAvatar(url) {
  assert.match(url, /^data:image\/svg\+xml;charset=UTF-8,/);
  return decodeURIComponent(url.split(',', 2)[1]);
}

test('creates a local initials avatar without sending the display name to a remote host', () => {
  const url = createInitialsAvatarDataUrl('Jamie Sample');
  const svg = decodeAvatar(url);

  assert.doesNotMatch(url, /^https?:/);
  assert.match(svg, />JS<\/text>/);
  assert.doesNotMatch(svg, /Jamie Sample/);
});

test('uses a safe fallback and escapes initials before inserting them into SVG', () => {
  assert.match(decodeAvatar(createInitialsAvatarDataUrl('')), />\?<\/text>/);
  assert.match(decodeAvatar(createInitialsAvatarDataUrl('A&B')), />A&amp;<\/text>/);
});

test('replaces retired remote and generated default avatars only at render time', () => {
  const legacy = 'https://ui-avatars.com/api/?name=Jamie%20Sample';
  const generated = createInitialsAvatarDataUrl('Jamie Sample');
  assert.equal(isLegacyRemoteAvatarUrl(legacy), true);
  assert.equal(normalizeStoredAvatarUrl(legacy), '');
  assert.equal(normalizeStoredAvatarUrl(generated), '');
  assert.equal(normalizeStoredAvatarUrl('https://cdn.example.com/avatar.png'), 'https://cdn.example.com/avatar.png');
  assert.match(resolveAvatarSource('Jamie Sample', legacy), /^data:image\/svg\+xml/);
});
