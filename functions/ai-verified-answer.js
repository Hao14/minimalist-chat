'use strict';

const VERIFIED_ANSWER_STATUSES = Object.freeze([
    'supported',
    'unsupported',
    'uncertain'
]);
const VERIFIED_ANSWER_LIMITS = Object.freeze({
    maxAnswerChars: 50_000,
    maxClaims: 64,
    maxClaimChars: 1200,
    maxSources: 64,
    maxSourceChars: 4000
});

const CLAIM_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
    'for', 'from', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i',
    'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'ours', 'she', 'that',
    'the', 'their', 'theirs', 'them', 'they', 'this', 'those', 'to', 'was',
    'we', 'were', 'will', 'with', 'you', 'your', 'yours'
]);
const WEEKDAY_OR_MONTH = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
const NUMBER_OR_DATE = /(?:[$€£]\s?\d[\d,.]*|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\s?(?:am|pm)?\b|\b\d+(?:[.,]\d+)*(?:%|st|nd|rd|th)?\b)/gi;
const NEGATION = /\b(?:no|not|never|neither|nor|without|cannot|can't|couldn't|didn't|doesn't|isn't|wasn't|won't)\b/i;

function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit) {
    const text = compact(value);
    return text.length <= limit ? text : text.slice(0, limit);
}

function normalizeCitationId(value) {
    const match = /^S(\d{1,3})$/i.exec(String(value || '').trim());
    const number = match ? Number(match[1]) : 0;
    return number >= 1 && number <= 999 ? `S${number}` : '';
}

function normalizeVerificationSources(values) {
    const output = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
        if (output.length >= VERIFIED_ANSWER_LIMITS.maxSources) break;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const id = normalizeCitationId(raw.id);
        if (!id || seen.has(id)) continue;
        const excerpt = clip(raw.excerpt || raw.text || raw.content, VERIFIED_ANSWER_LIMITS.maxSourceChars);
        if (!excerpt) continue;
        seen.add(id);
        output.push({
            id,
            sourceType: String(raw.sourceType || raw.type || 'unknown')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '')
                .slice(0, 40) || 'unknown',
            label: clip(raw.label || raw.title || id, 180),
            excerpt
        });
    }
    return output;
}

function stripCodeBlocks(value) {
    return String(value || '').replace(/```[\s\S]*?```/g, ' ');
}

function extractCitationIds(value) {
    const ids = [];
    const seen = new Set();
    for (const match of String(value || '').matchAll(/\[(S\d{1,3})\](?:\([^\r\n)]*\))?/gi)) {
        const id = normalizeCitationId(match[1]);
        if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

function stripCitationSyntax(value) {
    return String(value || '')
        .replace(/\[(S\d{1,3})\](?:\([^\r\n)]*\))?/gi, '')
        .replace(/\s+([,.;:!?])/g, '$1');
}

function claimCandidate(value) {
    const text = compact(value);
    if (text.length < 5 || text.endsWith('?')) return false;
    if (/^(?:summary|sources?|evidence|next steps?|notes?|answer)\s*:?\s*$/i.test(text)) return false;
    if (/^(?:please\s+)?(?:review|check|open|click|choose|select|consider|try|use|contact|ask|tell|let)\b/i.test(text)) {
        return false;
    }
    if (/^(?:i\s+(?:can|cannot|can't|couldn't|do not|don't|am unable)|you\s+(?:can|could|should|may|might))\b/i.test(text)) {
        return false;
    }
    return /[\p{L}\p{N}]/u.test(text);
}

function sentenceSegments(value) {
    const lines = stripCodeBlocks(value)
        .slice(0, VERIFIED_ANSWER_LIMITS.maxAnswerChars)
        .replace(/\[(S\d{1,3})\]\([^\r\n)]*\)/gi, '[$1]')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .split(/\r?\n/);
    const segments = [];
    for (const line of lines) {
        const cleaned = line
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
            .trim();
        if (!cleaned) continue;
        for (const match of cleaned.split(/(?<=[.!?])\s+/)) {
            const segment = compact(match);
            if (segment) segments.push(segment);
        }
    }
    return segments;
}

function parseAnswerClaimsDetailed(answer) {
    const rawAnswer = String(answer || '');
    const segments = sentenceSegments(rawAnswer);
    const claims = [];
    let claimsTruncated = false;
    for (const segment of segments) {
        const text = clip(stripCitationSyntax(segment), VERIFIED_ANSWER_LIMITS.maxClaimChars);
        if (!claimCandidate(text)) continue;
        if (claims.length >= VERIFIED_ANSWER_LIMITS.maxClaims) {
            claimsTruncated = true;
            break;
        }
        claims.push({
            id: `C${claims.length + 1}`,
            text,
            citationIds: extractCitationIds(segment)
        });
    }
    return {
        claims,
        truncated: {
            answer: rawAnswer.length > VERIFIED_ANSWER_LIMITS.maxAnswerChars,
            claims: claimsTruncated
        }
    };
}

function parseAnswerClaims(answer) {
    return parseAnswerClaimsDetailed(answer).claims;
}

function orderedClaimTokens(value) {
    const matches = compact(value).toLocaleLowerCase('en-US')
        .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) || [];
    return matches.filter((token) => (
        token.length > 1
        && token.length <= 48
        && !CLAIM_STOP_WORDS.has(token)
    ));
}

function claimTokens(value) {
    return [...new Set(orderedClaimTokens(value))];
}

function criticalAnchors(value) {
    const text = compact(value).toLocaleLowerCase('en-US');
    return [...new Set([
        ...(text.match(WEEKDAY_OR_MONTH) || []),
        ...(text.match(NUMBER_OR_DATE) || [])
    ].map((anchor) => compact(anchor).replace(/\s+/g, '')))];
}

function lexicalSupportScore(claim, evidence) {
    const tokens = claimTokens(claim);
    if (!tokens.length) return 0;
    const evidenceTokens = new Set(claimTokens(evidence));
    const tokenCoverage = tokens.filter((token) => evidenceTokens.has(token)).length / tokens.length;
    const claimOrder = orderedClaimTokens(claim);
    const evidenceOrder = orderedClaimTokens(evidence);
    if (claimOrder.length < 2) return tokenCoverage;
    const evidenceBigrams = new Set(evidenceOrder
        .slice(0, -1)
        .map((token, index) => `${token}\0${evidenceOrder[index + 1]}`));
    const claimBigrams = claimOrder
        .slice(0, -1)
        .map((token, index) => `${token}\0${claimOrder[index + 1]}`);
    const bigramCoverage = claimBigrams.filter((bigram) => evidenceBigrams.has(bigram)).length
        / claimBigrams.length;
    return (tokenCoverage * 0.7) + (bigramCoverage * 0.3);
}

function normalizedEvidenceText(value) {
    return compact(value)
        .toLocaleLowerCase('en-US')
        .replace(/[.!?]+$/g, '')
        .trim();
}

function classifyClaim(claim, sourceMap) {
    if (!claim.citationIds.length) {
        return {
            status: 'unsupported',
            reason: 'missing_citation',
            score: 0,
            evidenceIds: []
        };
    }
    const unknown = claim.citationIds.filter((id) => !sourceMap.has(id));
    if (unknown.length) {
        return {
            status: 'unsupported',
            reason: 'unknown_citation',
            score: 0,
            evidenceIds: claim.citationIds.filter((id) => sourceMap.has(id)),
            unknownCitationIds: unknown
        };
    }
    const evidenceIds = [...claim.citationIds];
    const evidence = evidenceIds
        .map((id) => `${sourceMap.get(id).label} ${sourceMap.get(id).excerpt}`)
        .join(' ');
    const anchors = criticalAnchors(claim.text);
    const evidenceAnchors = new Set(criticalAnchors(evidence));
    const missingAnchors = anchors.filter((anchor) => !evidenceAnchors.has(anchor));
    if (missingAnchors.length) {
        return {
            status: 'unsupported',
            reason: 'critical_fact_mismatch',
            score: 0,
            evidenceIds
        };
    }
    if (NEGATION.test(claim.text) !== NEGATION.test(evidence)) {
        return {
            status: 'unsupported',
            reason: 'negation_mismatch',
            score: 0,
            evidenceIds
        };
    }
    const score = lexicalSupportScore(claim.text, evidence);
    const exactClaim = normalizedEvidenceText(claim.text);
    const exactCitationSupport = evidenceIds.some((id) => {
        const source = sourceMap.get(id);
        return normalizedEvidenceText(source.excerpt).includes(exactClaim);
    });
    if (exactClaim && exactCitationSupport) {
        return {
            status: 'supported',
            reason: 'exact_citation_support',
            score,
            evidenceIds
        };
    }
    return {
        status: 'uncertain',
        reason: 'insufficient_textual_support',
        score,
        evidenceIds
    };
}

function verifyAnswerClaims(answer, sources) {
    const normalizedSources = normalizeVerificationSources(sources);
    const sourceMap = new Map(normalizedSources.map((source) => [source.id, source]));
    const parsed = parseAnswerClaimsDetailed(answer);
    const claims = parsed.claims.map((claim) => ({
        ...claim,
        ...classifyClaim(claim, sourceMap)
    }));
    const unknownCitationIds = [...new Set(claims.flatMap((claim) => (
        claim.unknownCitationIds || []
    )))];
    const totals = Object.fromEntries(VERIFIED_ANSWER_STATUSES.map((status) => [
        status,
        claims.filter((claim) => claim.status === status).length
    ]));
    const verificationComplete = !parsed.truncated.answer && !parsed.truncated.claims;
    const coverageRatio = verificationComplete && claims.length
        ? totals.supported / claims.length
        : null;
    return {
        claims,
        totals: {
            total: claims.length,
            ...totals
        },
        coverage: {
            supported: totals.supported,
            total: claims.length,
            complete: verificationComplete,
            ratio: coverageRatio,
            percent: coverageRatio == null ? null : Math.round(coverageRatio * 100)
        },
        fullySupported: verificationComplete
            && claims.length > 0
            && totals.supported === claims.length,
        truncated: parsed.truncated,
        unknownCitationIds
    };
}

function buildVerifiedAnswerReport({
    answer,
    sources
} = {}) {
    const report = verifyAnswerClaims(answer, sources);
    return {
        version: 1,
        status: !report.coverage.complete
            ? 'review_needed'
            : report.totals.total === 0
                ? 'no_claims'
            : report.fullySupported
                ? 'verified'
                : report.totals.unsupported
                    ? 'issues_found'
                    : 'review_needed',
        ...report
    };
}

module.exports = {
    VERIFIED_ANSWER_LIMITS,
    VERIFIED_ANSWER_STATUSES,
    buildVerifiedAnswerReport,
    extractCitationIds,
    normalizeVerificationSources,
    parseAnswerClaims,
    parseAnswerClaimsDetailed,
    verifyAnswerClaims
};
