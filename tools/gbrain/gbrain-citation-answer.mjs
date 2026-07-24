import {
  authorityMetadataForResult,
  normalizeAuthorityText,
  rankByAuthority,
} from './gbrain-authority-ranker.mjs';

const QUERY_STOP_WORDS = new Set([
  'about', 'and', 'are', 'can', 'did', 'does', 'for', 'from', 'have', 'how',
  'into', 'is', 'its', 'our', 'that', 'the', 'their', 'this', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you',
]);

const STRONG_NATIVE_EVIDENCE = new Set([
  'alias_hit',
  'exact_title_match',
  'high_vector_match',
]);

const OPPOSITE_VALUES = [
  ['active', 'archived'],
  ['allowed', 'forbidden'],
  ['enabled', 'disabled'],
  ['online', 'offline'],
  ['open', 'closed'],
  ['public', 'private'],
  ['true', 'false'],
  ['yes', 'no'],
];

function compactText(value, maximum = 600) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function candidateText(result) {
  return result.chunk_text
    ?? result.snippet
    ?? result.text
    ?? result.content
    ?? result.compiled_truth
    ?? '';
}

function tokenSet(value) {
  return new Set(normalizeAuthorityText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token)));
}

function queryCoverage(query, candidate) {
  const queryTokens = tokenSet(query);
  if (queryTokens.size === 0) return 0;
  const candidateTokens = tokenSet(candidate);
  let matched = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.size;
}

function evidenceStrength(result, metadata, snippet, query) {
  const signals = result.authority_signals ?? {};
  const warnings = [];
  if (result.stale === true) warnings.push('stale_result');
  if (result.content_flag) warnings.push(`content_flag:${result.content_flag.reason ?? 'flagged'}`);
  if (signals.archived || normalizeAuthorityText(metadata.status) === 'archived') {
    warnings.push('archived_source');
  }

  const coverage = queryCoverage(query, `${metadata.title} ${metadata.path} ${snippet}`);
  const nativeEvidence = String(result.evidence ?? '');
  const authorityMatch = Boolean(
    signals.exact_title
    || signals.alias_phrase
    || (signals.canonical && coverage >= 0.2)
    || ((signals.current || signals.verified) && coverage >= 0.25),
  );

  let strength = 'weak';
  let basis = 'weak_semantic_or_lexical_match';
  if (STRONG_NATIVE_EVIDENCE.has(nativeEvidence) || authorityMatch) {
    strength = 'strong';
    basis = nativeEvidence || 'authority_match';
  } else if (nativeEvidence === 'keyword_exact' || coverage >= 0.35) {
    strength = 'moderate';
    basis = nativeEvidence || 'query_coverage';
  } else if (coverage >= 0.2 && (signals.current || signals.verified || signals.canonical)) {
    strength = 'moderate';
    basis = 'authority_supported_query_coverage';
  }

  if (warnings.length > 0) {
    strength = 'weak';
    basis = 'quality_warning';
  }

  return {
    strength,
    basis,
    query_coverage: Number(coverage.toFixed(4)),
    warnings,
  };
}

function stripClaimMarkup(value) {
  return String(value ?? '')
    .replace(/[`*_~]/g, '')
    .replace(/^\s*[-+•]\s*/, '')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

function normalizeClaimSubject(value) {
  return normalizeAuthorityText(value).replace(/^(?:a|an|the)\s+/, '');
}

function scalarClaims(citation) {
  const claims = [];
  const fragments = String(citation.snippet ?? '')
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(stripClaimMarkup)
    .filter(Boolean);

  for (const fragment of fragments) {
    const match = /^(.{2,80}?)(?:\s+(?:is|are|was|were|will be)\s+|\s*[:=]\s*)(.{1,120})$/i.exec(fragment);
    if (!match) continue;
    const subject = normalizeClaimSubject(match[1]);
    const value = normalizeAuthorityText(match[2]);
    if (!subject || !value || subject === value) continue;
    claims.push({ subject, value, raw_value: match[2].trim(), citation: citation.citation });
  }
  return claims;
}

function hasOpposition(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  return OPPOSITE_VALUES.some(([a, b]) => (
    (leftTokens.has(a) && rightTokens.has(b))
    || (leftTokens.has(b) && rightTokens.has(a))
  ));
}

function dateValues(value) {
  return String(value).match(/\b(?:19|20)\d{2}[-/]\d{2}[-/]\d{2}\b/g) ?? [];
}

function conflictReason(subject, left, right) {
  if (hasOpposition(left, right)) return 'opposite_values';
  const leftDates = dateValues(left);
  const rightDates = dateValues(right);
  if (leftDates.length > 0 && rightDates.length > 0 && leftDates.join('|') !== rightDates.join('|')) {
    return 'different_dates';
  }
  const scalarSubject = /(?:^|\s)(?:branch|date|deadline|engine|mode|model|owner|port|provider|state|status|url|version)$/.test(subject);
  const shortValues = left.split(' ').length <= 4 && right.split(' ').length <= 4;
  if (scalarSubject && shortValues && left !== right) return 'different_scalar_values';
  return null;
}

export function detectCitationConflicts(citations) {
  const bySubject = new Map();
  for (const citation of citations.filter((item) => item.evidence_strength !== 'weak')) {
    for (const claim of scalarClaims(citation)) {
      const list = bySubject.get(claim.subject) ?? [];
      list.push(claim);
      bySubject.set(claim.subject, list);
    }
  }

  const conflicts = [];
  for (const [subject, claims] of bySubject) {
    let found = null;
    for (let leftIndex = 0; leftIndex < claims.length && !found; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
        const left = claims[leftIndex];
        const right = claims[rightIndex];
        if (left.citation === right.citation || left.value === right.value) continue;
        const reason = conflictReason(subject, left.raw_value, right.raw_value);
        if (!reason) continue;
        found = {
          subject,
          reason,
          evidence: [
            { citation: left.citation, value: left.raw_value },
            { citation: right.citation, value: right.raw_value },
          ],
        };
        break;
      }
    }
    if (found) conflicts.push(found);
  }
  return conflicts;
}

function normalizeResults(results, sourceId) {
  return results.map((result) => ({
    ...result,
    source_id: result.source_id || sourceId,
  }));
}

function deterministicAnswer({ citations, conflicts, evidenceStrength, abstained }) {
  if (citations.length === 0) {
    return "I don't have any local GBrain evidence for this question.";
  }
  if (conflicts.length > 0) {
    const refs = [...new Set(conflicts.flatMap((conflict) => conflict.evidence.map((item) => item.citation)))];
    return `I found conflicting local evidence and cannot give a single reliable answer. Compare ${refs.join(' and ')}.`;
  }
  if (abstained || evidenceStrength === 'low' || evidenceStrength === 'insufficient') {
    return "I don't have enough reliable local evidence to answer this question.";
  }
  return `Best-supported local evidence: ${citations[0].snippet} ${citations[0].citation}`;
}

export function buildCitationAnswer({
  query,
  results,
  catalog = new Map(),
  sourceId = 'default',
  maxCitations = 5,
} = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required.');
  if (!Array.isArray(results)) throw new TypeError('results must be an array.');
  if (!Number.isInteger(maxCitations) || maxCitations < 1 || maxCitations > 20) {
    throw new Error('maxCitations must be an integer from 1 to 20.');
  }

  const normalized = normalizeResults(results, sourceId);
  const alreadyRanked = normalized.every((result) => Number.isInteger(result.authority_rank));
  const ranked = alreadyRanked ? normalized : rankByAuthority(query, normalized, { catalog });
  const citations = ranked.slice(0, maxCitations).map((result, index) => {
    const metadata = authorityMetadataForResult(result, catalog);
    const snippet = compactText(candidateText(result));
    const assessment = evidenceStrength(result, metadata, snippet, query);
    return {
      citation: `[${index + 1}]`,
      rank: index + 1,
      source_id: result.source_id,
      slug: result.slug,
      title: metadata.title,
      path: metadata.absolute_path || metadata.path,
      relative_path: metadata.path,
      snippet,
      evidence_strength: assessment.strength,
      evidence_basis: assessment.basis,
      query_coverage: assessment.query_coverage,
      warnings: assessment.warnings,
      retrieval_score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
      authority_score: Number.isFinite(Number(result.authority_score)) ? Number(result.authority_score) : null,
      authority_signals: result.authority_signals ?? null,
    };
  });

  const conflicts = detectCitationConflicts(citations);
  const topStrength = citations[0]?.evidence_strength;
  let overallStrength = 'insufficient';
  if (topStrength === 'strong') overallStrength = 'high';
  else if (topStrength === 'moderate') overallStrength = 'medium';
  else if (topStrength === 'weak') overallStrength = 'low';
  if (conflicts.length > 0) overallStrength = 'low';

  const abstained = citations.length === 0 || overallStrength === 'low' || overallStrength === 'insufficient';
  const answerText = deterministicAnswer({
    citations,
    conflicts,
    evidenceStrength: overallStrength,
    abstained,
  });

  return {
    schema_version: 1,
    query,
    source_id: sourceId,
    answer: {
      text: answerText,
      mode: 'deterministic-evidence',
      abstained,
    },
    evidence_strength: overallStrength,
    conflicts,
    citations,
  };
}

export function everySynthesisClaimIsCited(text, citationCount) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) return false;
  const claims = text
    .split(/\r?\n/u)
    .flatMap((line) => line
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s*)/u, '')
      .replace(/([.!?])\s*((?:\[\d+\]\s*)+)/gu, '$2$1 ')
      .match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [])
    .map((claim) => claim.trim())
    .filter((claim) => /[\p{L}\p{N}]/u.test(claim.replace(/\[\d+\]/gu, '')));
  if (claims.length === 0) return false;
  return claims.every((claim) => {
    const matches = [...claim.matchAll(/\[(\d+)\]/gu)];
    return matches.length > 0 && matches.every((match) => {
      const value = Number.parseInt(match[1], 10);
      return value >= 1 && value <= citationCount;
    });
  });
}

export async function maybeSynthesizeWithOllama(report, {
  enabled = false,
  model = process.env.GBRAIN_OLLAMA_CHAT_MODEL || process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b',
  endpoint = 'http://127.0.0.1:11434/api/chat',
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  if (!enabled) {
    return { ...report, synthesis: { enabled: false, status: 'not_requested' } };
  }
  if (report.answer?.abstained) {
    return { ...report, synthesis: { enabled: true, status: 'skipped_for_abstention', model } };
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { ...report, synthesis: { enabled: true, status: 'unavailable', reason: 'invalid_endpoint', model } };
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '11434') {
    return { ...report, synthesis: { enabled: true, status: 'unavailable', reason: 'loopback_endpoint_required', model } };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...report, synthesis: { enabled: true, status: 'unavailable', reason: 'fetch_unavailable', model } };
  }

  const evidence = report.citations
    .map((citation) => `${citation.citation} ${citation.path}\n${citation.snippet}`)
    .join('\n\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Answer only from the supplied local evidence. Cite every factual sentence with [n]. Do not invent paths, facts, or citations.',
          },
          {
            role: 'user',
            content: `Question: ${report.query}\n\nLocal evidence:\n${evidence}`,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`ollama_http_${response.status}`);
    const payload = await response.json();
    const rawText = typeof payload?.message?.content === 'string' ? payload.message.content.trim() : '';
    if (!everySynthesisClaimIsCited(rawText, report.citations.length)) {
      return {
        ...report,
        synthesis: { enabled: true, status: 'rejected', reason: 'uncited_invalid_or_oversized_claims', model },
      };
    }
    const text = rawText.replace(/[ \t]+/gu, ' ').replace(/\s*\r?\n\s*/gu, '\n').trim();
    return {
      ...report,
      answer: { ...report.answer, text, mode: 'ollama-cited-synthesis' },
      synthesis: { enabled: true, status: 'completed', model, endpoint: url.origin },
    };
  } catch (error) {
    return {
      ...report,
      synthesis: {
        enabled: true,
        status: 'unavailable',
        reason: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error),
        model,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
