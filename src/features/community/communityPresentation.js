const XP_PER_LEVEL = 100;

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function totalCommunityXp(user = {}) {
  return Object.values(user.xp || {}).reduce((sum, value) => sum + numeric(value), 0);
}

export function communityLevel(user = {}) {
  return Math.floor(totalCommunityXp(user) / XP_PER_LEVEL);
}

export function reputationBreakdown(user = {}) {
  const messages = numeric(user.stats?.messages);
  const kudos = numeric(user.kudos);
  const badges = Object.keys(user.badges || {}).length;
  const skillXp = totalCommunityXp(user);

  return {
    badges,
    badgePoints: badges * 10,
    kudos,
    kudosPoints: kudos * 5,
    messages,
    messagePoints: messages,
    skillXp,
    total: messages + (kudos * 5) + (badges * 10) + skillXp,
  };
}

export function buildRankSnapshot({
  currentUid = '',
  limit = 25,
  metric = 'overall',
  profileRows = [],
  skills = {},
} = {}) {
  const activeSkill = skills[metric] || null;
  const rankedRows = [];
  let currentMember = null;
  let currentBreakdown = reputationBreakdown();

  for (const profile of profileRows) {
    const privateProfile = profile.privateProfile || {};
    const breakdown = reputationBreakdown(privateProfile);
    const score = activeSkill ? numeric(privateProfile.xp?.[metric]) : breakdown.total;
    const levelXp = activeSkill ? score : breakdown.skillXp;
    const row = {
      handle: profile.handle || '',
      isCurrentUser: profile.uid === currentUid,
      lvl: Math.floor(levelXp / XP_PER_LEVEL),
      name: profile.name || 'Anonymous',
      photo: profile.photo || '',
      progress: levelXp % XP_PER_LEVEL,
      score,
      uid: profile.uid,
    };

    if (row.isCurrentUser) {
      currentMember = row;
      currentBreakdown = breakdown;
    }
    if (score > 0) rankedRows.push(row);
  }

  rankedRows.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  const rows = rankedRows.slice(0, Math.max(1, limit)).map((row, index) => ({
    ...row,
    position: index + 1,
  }));

  if (currentMember) {
    const rankedCurrent = rows.find((row) => row.uid === currentMember.uid);
    currentMember = rankedCurrent || currentMember;
  }

  return {
    breakdown: currentBreakdown,
    currentMember,
    rows,
    unit: activeSkill ? `${activeSkill.label} XP` : 'points',
  };
}

export function splitRankedRows(rows = [], podiumSize = 3) {
  const safeSize = Math.max(0, Number(podiumSize) || 0);
  return {
    leaders: rows.slice(0, safeSize),
    remaining: rows.slice(safeSize),
  };
}

export function getKudosSuggestions({
  currentUid = '',
  limit = 6,
  members = [],
  preferredUid = '',
  query = '',
} = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  const preferred = [];
  const remaining = [];
  const seen = new Set();

  for (const member of members) {
    const uid = String(member?.uid || '');
    if (!uid || uid === currentUid || seen.has(uid)) continue;

    const name = String(member.name || 'Anonymous');
    const handle = String(member.handle || '');
    const searchable = `${name} ${handle}`.toLocaleLowerCase();
    if (needle && !searchable.includes(needle)) continue;

    seen.add(uid);
    const publicMember = {
      handle,
      name,
      photo: member.photo || '',
      uid,
    };
    if (uid === preferredUid) preferred.push(publicMember);
    else remaining.push(publicMember);
  }

  remaining.sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
  return [...preferred, ...remaining].slice(0, Math.max(1, Number(limit) || 1));
}

export function getKudosMilestone(value = 0) {
  const count = Math.max(0, numeric(value));
  const target = count < 5 ? 5 : 25;
  const reached = count >= 25;

  return {
    count,
    label: reached ? 'Popular milestone reached' : count < 5 ? 'Liked badge' : 'Popular badge',
    progress: reached ? 100 : Math.min(100, Math.round((count / target) * 100)),
    reached,
    remaining: reached ? 0 : Math.max(0, target - count),
    target,
  };
}
