import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [leaderboard, recognition, social, shell, styles, codexStyles] = await Promise.all([
  readFile(new URL('../src/features/community/Leaderboard.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/community/RecognitionPanel.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/community/social.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/updates/UpdatesCenterShell.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/community/communityUpdates.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/community/communityUpdatesCodex.css', import.meta.url), 'utf8'),
]);

test('Rank uses named metric controls and never repeats podium rows in the remainder', () => {
  assert.match(leaderboard, /<span>\{item\.label\}<\/span>/);
  assert.match(leaderboard, /aria-pressed=\{metric === item\.key\}/);
  assert.match(leaderboard, /splitRankedRows\(rows\)/);
  assert.match(leaderboard, /remaining\.map/);
  assert.doesNotMatch(leaderboard, /rows\.map\(\(row, index\)/);
});

test('Kudos is an actual searchable send flow instead of inert award cards', () => {
  assert.match(recognition, /getKudosSuggestions/);
  assert.match(recognition, /await onGiveKudos\?\.\(member\.uid\)/);
  assert.match(recognition, /placeholder="Search people"/);
  assert.match(recognition, /Kudos received/);
  assert.match(recognition, /aria-busy=\{state === 'sending'\}/);
  assert.match(recognition, /aria-live="polite"/);
  assert.match(recognition, /const eligibleCount = new Set/);
  assert.doesNotMatch(recognition, /AWARD_CARDS|\/award give/);
});

test('Codex Rank and Kudos styling is lazy, dark, and isolated from every other theme surface', () => {
  const scope = 'body.codex-mode:not(.marketing):not(.auth-screen) #updates-panel.updates-center';
  const scopedLines = codexStyles
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('#updates-panel.updates-center'));

  assert.match(social, /import '\.\/communityUpdatesCodex\.css';/);
  assert.ok(scopedLines.length > 40);
  assert.ok(scopedLines.every((line) => line.startsWith(scope)));
  assert.match(codexStyles, /:is\(#leaderboard-list, #recognition-list\)[\s\S]*?color-scheme:\s*dark/);
  assert.match(codexStyles, /--updates-accent:\s*var\(--codex-accent-fill/);
  assert.match(codexStyles, /--updates-bg:\s*var\(--codex-bg/);
  assert.match(codexStyles, /--updates-ink:\s*var\(--codex-text/);
  assert.match(codexStyles, /--updates-muted:\s*var\(--codex-muted/);
  assert.match(codexStyles, /--updates-faint:/);
  assert.match(codexStyles, /--updates-line:\s*var\(--codex-border-strong/);
  assert.match(codexStyles, /--updates-soft-line:\s*var\(--codex-border/);
  assert.match(codexStyles, /--updates-wash:/);
  assert.match(codexStyles, /--updates-danger:\s*var\(--codex-danger/);
  assert.doesNotMatch(codexStyles, /body\.(?:dark-mode|gray-mode|modern-mode)|:root/);
  assert.doesNotMatch(codexStyles, /#(?:notifications-list|quests-list|updates-list)|\.updates-center-header|\.update-tabs|\.update-tab/);
  assert.doesNotMatch(styles, /codex-mode|--codex-/);
});

test('Kudos persists the sender index, proof, and count as one atomic write', () => {
  assert.match(social, /kudosGiven\/\$\{targetUid\}/);
  assert.match(social, /await update\(ref\(db\), \{/);
  assert.match(social, /kudos`\]: increment\(1\)/);
  assert.match(social, /sentUids: Object\.keys/);
});

test('Rank and Kudos roots survive host replacement and expose busy state', () => {
  assert.match(social, /const leaderboardRoot = createHostAwareRoot\(\)/);
  assert.match(social, /const recognitionRoot = createHostAwareRoot\(\)/);
  assert.match(social, /leaderboardRoot\.render\(listEl/);
  assert.match(social, /recognitionRoot\.render\(listEl/);
  assert.match(social, /setAttribute\('aria-busy'/);
});

test('Both tabs have immediate loading content and feature-owned responsive styling', () => {
  assert.match(shell, /Preparing your rank/);
  assert.match(shell, /Preparing Kudos/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container \(max-width: 380px\)/);
  assert.match(styles, /\.rank-v2-metric[\s\S]*?min-height: 42px/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.rank-v2-metric[\s\S]*?min-height: 44px/);
  assert.match(styles, /\.kudos-v2-give[\s\S]*?min-height: 42px/);
});
