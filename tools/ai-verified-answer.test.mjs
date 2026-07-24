import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const verified = require('../functions/ai-verified-answer.js');

const sources = [
  {
    id: 'S1',
    type: 'event',
    label: 'Launch review',
    excerpt: 'The Apollo launch review is Friday.',
  },
  {
    id: 'S2',
    type: 'document',
    label: 'Approved budget',
    excerpt: 'The approved launch budget is $5,000.',
  },
  {
    id: 'S3',
    type: 'message',
    label: 'Morgan',
    excerpt: 'Morgan will prepare the customer update after approval.',
  },
];

test('claim parsing handles Markdown, lists, sentences, and canonical citations', () => {
  const claims = verified.parseAnswerClaims(`
## Summary
- The Apollo launch review is Friday [S1](https://untrusted.invalid/source).
- The approved launch budget is $5,000 [S2]. Morgan will prepare the update [S3].

Can you confirm the attendee list?
Please review the linked plan.
\`\`\`
Do not treat this code block as a claim [S99].
\`\`\`
`);

  assert.deepEqual(claims, [
    {
      id: 'C1',
      text: 'The Apollo launch review is Friday.',
      citationIds: ['S1'],
    },
    {
      id: 'C2',
      text: 'The approved launch budget is $5,000.',
      citationIds: ['S2'],
    },
    {
      id: 'C3',
      text: 'Morgan will prepare the update.',
      citationIds: ['S3'],
    },
  ]);
});

test('source normalization is bounded, deduplicated, and access-neutral', () => {
  const normalized = verified.normalizeVerificationSources([
    {
      id: 's01',
      sourceType: 'MESSAGE<script>',
      title: 'Evidence',
      text: 'Launch detail.',
      privatePath: '/users/other/messages/1',
    },
    {
      id: 'S1',
      text: 'Duplicate.',
    },
    {
      id: 'arbitrary',
      text: 'Ignored.',
    },
  ]);

  assert.deepEqual(normalized, [{
    id: 'S1',
    sourceType: 'messagescript',
    label: 'Evidence',
    excerpt: 'Launch detail.',
  }]);
  assert.equal('privatePath' in normalized[0], false);
});

test('verification reports supported claims with deterministic coverage', () => {
  const report = verified.buildVerifiedAnswerReport({
    answer: [
      'The Apollo launch review is Friday [S1].',
      'The approved launch budget is $5,000 [S2].',
      'Morgan will prepare the customer update after approval [S3].',
    ].join(' '),
    sources,
  });

  assert.equal(report.status, 'verified');
  assert.equal(report.fullySupported, true);
  assert.deepEqual(report.totals, {
    total: 3,
    supported: 3,
    unsupported: 0,
    uncertain: 0,
  });
  assert.deepEqual(report.coverage, {
    supported: 3,
    total: 3,
    complete: true,
    ratio: 1,
    percent: 100,
  });
  assert.ok(report.claims.every((claim) => claim.reason === 'exact_citation_support'));
});

test('missing, unknown, and conflicting citations are unsupported', () => {
  const report = verified.verifyAnswerClaims([
    'The Apollo launch review is Tuesday [S1].',
    'The approved budget is $9,000 [S2].',
    'The attendee list is final.',
    'The launch owner is Ava [S99].',
  ].join(' '), sources);

  assert.equal(report.totals.supported, 0);
  assert.equal(report.totals.unsupported, 4);
  assert.deepEqual(
    report.claims.map((claim) => claim.reason),
    [
      'critical_fact_mismatch',
      'critical_fact_mismatch',
      'missing_citation',
      'unknown_citation',
    ],
  );
  assert.deepEqual(report.unknownCitationIds, ['S99']);
  assert.equal(report.coverage.percent, 0);
});

test('valid citations with weak textual entailment remain uncertain, not falsely verified', () => {
  const report = verified.verifyAnswerClaims(
    'The customer escalation policy has been comprehensively redesigned [S3].',
    sources,
  );
  assert.equal(report.totals.uncertain, 1);
  assert.equal(report.claims[0].status, 'uncertain');
  assert.equal(report.claims[0].reason, 'insufficient_textual_support');
  assert.ok(report.claims[0].score < 0.76);
});

test('negation disagreement is not accepted as citation support', () => {
  const report = verified.verifyAnswerClaims(
    'Morgan will not prepare the customer update after approval [S3].',
    sources,
  );
  assert.equal(report.claims[0].status, 'unsupported');
  assert.equal(report.claims[0].reason, 'negation_mismatch');
});

test('matching words in a reversed relationship remain uncertain', () => {
  const report = verified.verifyAnswerClaims(
    'Alice approved Bob launch budget Friday [S4].',
    [{ id: 'S4', text: 'Bob approved Alice launch budget Friday.' }],
  );
  assert.equal(report.claims[0].status, 'uncertain');
  assert.ok(report.claims[0].score > 0.75, 'high overlap still must not imply entailment');
});

test('questions and capability or recommendation prose produce an honest no-claims report', () => {
  const report = verified.buildVerifiedAnswerReport({
    answer: [
      'Can you share the launch date?',
      'I can help summarize the answer.',
      'You should review the source.',
    ].join('\n'),
    sources,
  });
  assert.equal(report.status, 'no_claims');
  assert.equal(report.totals.total, 0);
  assert.equal(report.coverage.ratio, null);
  assert.equal(report.coverage.percent, null);
  assert.equal(report.coverage.complete, true);
  assert.equal(report.fullySupported, false);
});

test('caller-supplied status fields cannot override deterministic classification', () => {
  const poisonedSources = [{
    id: 'S4',
    type: 'document',
    text: 'The office is closed Monday.',
    status: 'supported',
    score: 1,
  }];
  const report = verified.verifyAnswerClaims(
    'The office is closed Friday [S4].',
    poisonedSources,
  );
  assert.equal(report.claims[0].status, 'unsupported');
  assert.equal(report.claims[0].reason, 'critical_fact_mismatch');
});

test('leading-zero citations canonicalize consistently without creating duplicate sources', () => {
  const normalized = verified.normalizeVerificationSources([
    { id: 'S01', text: 'The review is Friday.' },
    { id: 'S1', text: 'Duplicate evidence.' },
  ]);
  const report = verified.verifyAnswerClaims(
    'The review is Friday [S01].',
    normalized,
  );
  assert.deepEqual(normalized.map(({ id }) => id), ['S1']);
  assert.deepEqual(report.claims[0].citationIds, ['S1']);
  assert.equal(report.claims[0].status, 'supported');
});

test('decimal facts stay intact while adjacent sentences split deterministically', () => {
  const claims = verified.parseAnswerClaims(
    'Latency is 3.5 seconds [S1]. Reliability is 99.9% [S2].',
  );
  assert.deepEqual(claims.map(({ text }) => text), [
    'Latency is 3.5 seconds.',
    'Reliability is 99.9%.',
  ]);
});

test('claim and character truncation can never report verified or 100% coverage', () => {
  const repeated = Array.from({ length: 64 }, (_unused, index) => (
    `Launch item ${index + 1} is Friday [S1].`
  ));
  const claimLimited = verified.buildVerifiedAnswerReport({
    answer: [...repeated, 'The launch review is Tuesday [S1].'].join(' '),
    sources,
  });
  assert.equal(claimLimited.status, 'review_needed');
  assert.equal(claimLimited.fullySupported, false);
  assert.equal(claimLimited.truncated.claims, true);
  assert.equal(claimLimited.coverage.complete, false);
  assert.equal(claimLimited.coverage.percent, null);

  const characterLimited = verified.buildVerifiedAnswerReport({
    answer: `The launch review is Friday [S1]. ${'x'.repeat(
      verified.VERIFIED_ANSWER_LIMITS.maxAnswerChars,
    )}`,
    sources,
  });
  assert.equal(characterLimited.status, 'review_needed');
  assert.equal(characterLimited.truncated.answer, true);
  assert.equal(characterLimited.coverage.complete, false);
  assert.equal(characterLimited.coverage.percent, null);

  const hiddenTail = verified.buildVerifiedAnswerReport({
    answer: `${'x'.repeat(verified.VERIFIED_ANSWER_LIMITS.maxAnswerChars)} Tuesday [S1].`,
    sources,
  });
  assert.equal(hiddenTail.status, 'review_needed');
  assert.equal(hiddenTail.truncated.answer, true);
});
