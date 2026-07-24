import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRankSnapshot,
  getKudosMilestone,
  getKudosSuggestions,
  reputationBreakdown,
  splitRankedRows,
} from '../src/features/community/communityPresentation.js';

const skills = {
  leadership: { label: 'Leadership' },
  support: { label: 'Support' },
};

test('reputation keeps the existing messages + kudos + badges + XP formula', () => {
  assert.deepEqual(reputationBreakdown({
    badges: { welcome: 1, liked: 2 },
    kudos: 3,
    stats: { messages: 12 },
    xp: { leadership: 40, support: 25 },
  }), {
    badges: 2,
    badgePoints: 20,
    kudos: 3,
    kudosPoints: 15,
    messages: 12,
    messagePoints: 12,
    skillXp: 65,
    total: 112,
  });
});

test('rank snapshot always returns the signed-in member without inventing public scores', () => {
  const snapshot = buildRankSnapshot({
    currentUid: 'self',
    metric: 'overall',
    profileRows: [
      {
        uid: 'other',
        name: 'Other member',
        privateProfile: {},
      },
      {
        uid: 'self',
        name: 'Current member',
        handle: 'ME-01',
        privateProfile: {
          kudos: 2,
          stats: { messages: 5 },
          xp: { leadership: 125, support: 10 },
        },
      },
    ],
    skills,
  });

  assert.equal(snapshot.currentMember.uid, 'self');
  assert.equal(snapshot.currentMember.score, 150);
  assert.equal(snapshot.currentMember.lvl, 1);
  assert.equal(snapshot.currentMember.progress, 35);
  assert.deepEqual(snapshot.rows.map((row) => row.uid), ['self']);
  assert.equal(snapshot.unit, 'points');
});

test('skill ranks use selected skill XP for score, level, and progress', () => {
  const snapshot = buildRankSnapshot({
    currentUid: 'self',
    metric: 'leadership',
    profileRows: [{
      uid: 'self',
      name: 'Current member',
      privateProfile: { xp: { leadership: 245, support: 90 } },
    }],
    skills,
  });

  assert.equal(snapshot.currentMember.score, 245);
  assert.equal(snapshot.currentMember.lvl, 2);
  assert.equal(snapshot.currentMember.progress, 45);
  assert.equal(snapshot.unit, 'Leadership XP');
});

test('leaderboard presentation separates the podium from remaining rows', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ uid: `user-${index + 1}` }));
  const { leaders, remaining } = splitRankedRows(rows);

  assert.deepEqual(leaders.map((row) => row.uid), ['user-1', 'user-2', 'user-3']);
  assert.deepEqual(remaining.map((row) => row.uid), ['user-4', 'user-5', 'user-6']);
});

test('kudos suggestions exclude self, deduplicate, prioritize, search, and stay deterministic', () => {
  const members = [
    { uid: 'self', name: 'Me' },
    { uid: 'c', name: 'Charlie', handle: 'charlie' },
    { uid: 'a', name: 'Alex', handle: 'alpha' },
    { uid: 'b', name: 'Bailey', handle: 'bravo' },
    { uid: 'a', name: 'Alex duplicate' },
  ];
  const suggestions = getKudosSuggestions({
    currentUid: 'self',
    members,
    preferredUid: 'c',
  });

  assert.deepEqual(suggestions.map((member) => member.uid), ['c', 'a', 'b']);
  assert.deepEqual(getKudosSuggestions({ currentUid: 'self', members, query: 'brav' }).map((member) => member.uid), ['b']);
});

test('kudos milestone advances from Liked to Popular and caps cleanly', () => {
  assert.deepEqual(getKudosMilestone(3), {
    count: 3,
    label: 'Liked badge',
    progress: 60,
    reached: false,
    remaining: 2,
    target: 5,
  });
  assert.equal(getKudosMilestone(5).target, 25);
  assert.equal(getKudosMilestone(25).reached, true);
  assert.equal(getKudosMilestone(40).progress, 100);
});
