/**
 * Poll integration contract
 * -------------------------
 * - Store each participant's selection at `poll/votes/{uid}`.
 * - The stored value remains a string for RTDB compatibility. Single-choice
 *   polls use `o1`; multiple-choice polls use a `|`-separated value (`o1|o3`).
 * - Use createPollPayload() for new messages, nextPollVoteValue() before a
 *   vote write, isPollClosed() for both explicit and scheduled closure, and
 *   aggregatePollResults() for rendering.
 * - `anonymous` controls display semantics only. RTDB still keys votes by uid,
 *   so it must not be described as cryptographically anonymous.
 */

export const POLL_LIMITS = Object.freeze({
  maxOptionLength: 80,
  maxOptions: 10,
  maxQuestionLength: 180,
  minOptions: 2,
});

const VOTE_SEPARATOR = '|';

function cleanOptions(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/);
  const seen = new Set();
  const options = [];
  source.forEach((entry) => {
    const text = String(typeof entry === 'object' ? entry?.text : entry || '').trim();
    const fingerprint = text.toLocaleLowerCase();
    if (!text || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    options.push(text);
  });
  return options;
}

function normalizeClosesAt(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function validatePollDraft(draft = {}, { now = Date.now() } = {}) {
  const errors = {};
  const question = String(draft.question || '').trim();
  const options = cleanOptions(draft.options ?? draft.optionsText);
  const closesAt = normalizeClosesAt(draft.closesAt);

  if (!question) errors.question = 'Add a poll question.';
  else if (question.length > POLL_LIMITS.maxQuestionLength) {
    errors.question = `Keep the question under ${POLL_LIMITS.maxQuestionLength} characters.`;
  }
  if (options.length < POLL_LIMITS.minOptions) {
    errors.options = `Add at least ${POLL_LIMITS.minOptions} different options.`;
  } else if (options.length > POLL_LIMITS.maxOptions) {
    errors.options = `Use no more than ${POLL_LIMITS.maxOptions} options.`;
  } else if (options.some((option) => option.length > POLL_LIMITS.maxOptionLength)) {
    errors.options = `Keep each option under ${POLL_LIMITS.maxOptionLength} characters.`;
  }
  if (draft.closesAt && !closesAt) errors.closesAt = 'Choose a valid closing time.';
  else if (closesAt && closesAt <= now) errors.closesAt = 'Closing time must be in the future.';

  return {
    errors,
    normalized: {
      anonymous: draft.anonymous === true,
      closesAt,
      multipleChoice: draft.multipleChoice === true,
      options,
      question,
    },
    ok: Object.keys(errors).length === 0,
  };
}

export function createPollPayload(draft = {}, { now = Date.now() } = {}) {
  const validation = validatePollDraft(draft, { now });
  if (!validation.ok) {
    const error = new Error(Object.values(validation.errors)[0]);
    error.validationErrors = validation.errors;
    throw error;
  }
  const normalized = validation.normalized;
  return {
    anonymous: normalized.anonymous,
    createdAt: now,
    multipleChoice: normalized.multipleChoice,
    options: normalized.options.map((text, index) => ({ id: `o${index}`, text })),
    question: normalized.question,
    ...(normalized.closesAt ? { closesAt: normalized.closesAt } : {}),
  };
}

export function isPollClosed(poll = {}, now = Date.now()) {
  const closesAt = normalizeClosesAt(poll.closesAt);
  return poll.closed === true || Boolean(closesAt && closesAt <= now);
}

export function decodePollVote(value) {
  let optionIds = [];
  if (typeof value === 'string') optionIds = value.split(VOTE_SEPARATOR);
  else if (Array.isArray(value)) optionIds = value;
  else if (value && typeof value === 'object') {
    optionIds = Object.entries(value).filter(([, selected]) => selected === true).map(([id]) => id);
  }
  return [...new Set(optionIds.map((id) => String(id || '').trim()).filter(Boolean))];
}

export function encodePollVote(optionIds) {
  const encoded = [...new Set((optionIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
    .sort()
    .join(VOTE_SEPARATOR);
  return encoded || null;
}

export function nextPollVoteValue(poll = {}, currentValue, optionId, { now = Date.now() } = {}) {
  if (isPollClosed(poll, now)) throw new Error('This poll is closed.');
  const validIds = new Set((poll.options || []).map((option) => String(option?.id || '')));
  const nextId = String(optionId || '');
  if (!validIds.has(nextId)) throw new Error('That poll option is unavailable.');
  if (poll.multipleChoice !== true) return nextId;

  const selected = new Set(decodePollVote(currentValue).filter((id) => validIds.has(id)));
  if (selected.has(nextId)) selected.delete(nextId);
  else selected.add(nextId);
  return encodePollVote([...selected]);
}

export function aggregatePollResults(poll = {}, { now = Date.now(), viewerUid = '' } = {}) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const validIds = new Set(options.map((option) => String(option?.id || '')));
  const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  const counts = new Map(options.map((option) => [String(option.id), 0]));
  const voters = new Map(options.map((option) => [String(option.id), []]));
  let participantCount = 0;
  let selectionCount = 0;

  Object.entries(votes).forEach(([uid, value]) => {
    const selected = decodePollVote(value).filter((id) => validIds.has(id));
    if (!selected.length) return;
    participantCount += 1;
    selected.forEach((id) => {
      counts.set(id, (counts.get(id) || 0) + 1);
      voters.get(id)?.push(uid);
      selectionCount += 1;
    });
  });

  const highScore = Math.max(0, ...counts.values());
  const anonymous = poll.anonymous === true;
  return {
    anonymous,
    closed: isPollClosed(poll, now),
    multipleChoice: poll.multipleChoice === true,
    participantCount,
    selectionCount,
    viewerOptionIds: decodePollVote(votes[viewerUid]).filter((id) => validIds.has(id)),
    options: options.map((option) => {
      const id = String(option.id);
      const count = counts.get(id) || 0;
      return {
        ...option,
        count,
        percentage: participantCount ? Math.round((count / participantCount) * 100) : 0,
        winner: highScore > 0 && count === highScore,
        ...(anonymous ? {} : { voterIds: voters.get(id) || [] }),
      };
    }),
  };
}
