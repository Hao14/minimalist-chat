'use strict';

const { createHash } = require('node:crypto');

const AI_SEMANTIC_SEARCH_DEFAULTS = Object.freeze({
    maxCandidates: 96,
    maxCandidateChars: 1800,
    maxTotalCandidateChars: 72000,
    maxQueryChars: 720,
    maxResults: 12,
    minScore: 0.16,
    semanticWeight: 0.82,
    diversityPenalty: 0.12,
    maxPerDiversityKey: 2
});

const AI_SEMANTIC_SOURCE_CAPS = Object.freeze({
    message: 6,
    task: 4,
    document: 4,
    event: 4,
    memory: 3,
    default: 3
});

const LEXICAL_STOP_WORDS = new Set([
    'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'are', 'as', 'at',
    'be', 'been', 'before', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
    'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
    'its', 'just', 'me', 'more', 'most', 'my', 'no', 'not', 'of', 'on', 'or', 'our',
    'please', 'room', 'should', 'so', 'some', 'than', 'that', 'the', 'their', 'then',
    'there', 'these', 'they', 'this', 'those', 'to', 'up', 'was', 'we', 'were', 'what',
    'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your'
]);

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function compactSemanticText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clippedSemanticText(value, limit) {
    const text = compactSemanticText(value);
    if (text.length <= limit) return text;
    if (limit < 16) return text.slice(0, limit);
    const marker = ' … ';
    const available = limit - marker.length;
    const head = Math.ceil(available * 0.68);
    return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

function safeIdentifier(value, limit = 180) {
    return compactSemanticText(value).slice(0, limit);
}

function safeSourceType(value) {
    const normalized = String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    return normalized || 'unknown';
}

function textFingerprint(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 24);
}

/**
 * Normalizes a bounded set of already-authorized workspace candidates.
 *
 * This helper deliberately has no authorization or storage-path knowledge. The
 * caller must supply only records the current user is allowed to read.
 */
function normalizeAiSemanticCandidates(candidates, {
    maxCandidates = AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidates,
    maxCandidateChars = AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidateChars,
    maxTotalCandidateChars = AI_SEMANTIC_SEARCH_DEFAULTS.maxTotalCandidateChars
} = {}) {
    const candidateLimit = boundedInteger(maxCandidates, AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidates, 1, 256);
    const textLimit = boundedInteger(maxCandidateChars, AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidateChars, 80, 8000);
    const totalLimit = boundedInteger(maxTotalCandidateChars, AI_SEMANTIC_SEARCH_DEFAULTS.maxTotalCandidateChars, textLimit, 256000);
    const normalized = [];
    const seen = new Set();
    let usedChars = 0;

    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
        if (normalized.length >= candidateLimit || usedChars >= totalLimit) break;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const sourceType = safeSourceType(candidate.sourceType || candidate.type);
        const sourceId = safeIdentifier(candidate.sourceId || candidate.itemId || candidate.id);
        const id = safeIdentifier(candidate.id || `${sourceType}:${sourceId || index}`);
        if (!id || seen.has(id)) continue;
        const roomId = safeIdentifier(candidate.roomId, 160);
        const channelId = safeIdentifier(candidate.channelId, 160);
        const label = clippedSemanticText(candidate.label || candidate.title, 180);
        const available = Math.min(textLimit, totalLimit - usedChars);
        const text = clippedSemanticText(candidate.text, available);
        if (!text) continue;

        seen.add(id);
        usedChars += text.length;
        normalized.push({
            id,
            sourceType,
            sourceId: sourceId || id,
            roomId,
            channelId,
            label,
            text,
            timestamp: Math.max(0, Math.floor(Number(candidate.timestamp) || 0)),
            diversityKey: safeIdentifier(candidate.diversityKey || `${sourceType}:${roomId || channelId || sourceId || id}`, 240)
        });
    }
    return normalized;
}

function semanticTokens(value, maximum = 96) {
    const matches = compactSemanticText(value).toLocaleLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) || [];
    const result = [];
    for (const token of matches) {
        if (token.length < 2 || token.length > 48 || LEXICAL_STOP_WORDS.has(token)) continue;
        result.push(token);
        if (result.length >= maximum) break;
    }
    return result;
}

function lexicalScores(query, candidates) {
    const queryText = compactSemanticText(query).toLocaleLowerCase();
    const queryTerms = [...new Set(semanticTokens(queryText, 48))];
    if (!queryTerms.length) return candidates.map(() => 0);
    const candidateTokens = candidates.map((candidate) => semanticTokens(`${candidate.label} ${candidate.text}`));
    const documentFrequency = new Map(queryTerms.map((term) => [term, 0]));
    for (const tokens of candidateTokens) {
        const present = new Set(tokens);
        for (const term of queryTerms) {
            if (present.has(term)) documentFrequency.set(term, documentFrequency.get(term) + 1);
        }
    }
    const queryWeights = queryTerms.map((term) => (
        1 + Math.log((candidates.length + 1) / ((documentFrequency.get(term) || 0) + 1))
    ));
    const totalQueryWeight = queryWeights.reduce((sum, weight) => sum + weight, 0) || 1;

    return candidates.map((candidate, index) => {
        const tokens = candidateTokens[index];
        const counts = new Map();
        for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
        let matchedWeight = 0;
        let frequencyBoost = 0;
        for (let termIndex = 0; termIndex < queryTerms.length; termIndex += 1) {
            const count = counts.get(queryTerms[termIndex]) || 0;
            if (!count) continue;
            matchedWeight += queryWeights[termIndex];
            frequencyBoost += Math.min(1, Math.log2(count + 1) / 2);
        }
        const coverage = matchedWeight / totalQueryWeight;
        const density = Math.min(1, frequencyBoost / Math.max(1, Math.sqrt(tokens.length)));
        const haystack = `${candidate.label} ${candidate.text}`.toLocaleLowerCase();
        const exactPhrase = queryText.length >= 4 && haystack.includes(queryText) ? 1 : 0;
        return boundedNumber((coverage * 0.86) + (density * 0.08) + (exactPhrase * 0.06), 0, 0, 1);
    });
}

function normalizedVector(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 16384) return null;
    const vector = value.map(Number);
    if (vector.some((entry) => !Number.isFinite(entry))) return null;
    const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + (entry * entry), 0));
    if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
    return vector.map((entry) => entry / magnitude);
}

function cosineSimilarity(left, right) {
    const a = normalizedVector(left);
    const b = normalizedVector(right);
    if (!a || !b || a.length !== b.length) return 0;
    return boundedNumber(a.reduce((sum, value, index) => sum + (value * b[index]), 0), 0, -1, 1);
}

function validEmbeddingSet(value, expectedLength) {
    if (!Array.isArray(value) || value.length !== expectedLength) return null;
    const normalized = value.map(normalizedVector);
    if (normalized.some((vector) => !vector)) return null;
    const dimensions = normalized[0].length;
    if (normalized.some((vector) => vector.length !== dimensions)) return null;
    return normalized;
}

function resolvedSourceCaps(sourceCaps, maxResults) {
    const supplied = sourceCaps && typeof sourceCaps === 'object' && !Array.isArray(sourceCaps) ? sourceCaps : {};
    const caps = {};
    for (const [key, value] of Object.entries({ ...AI_SEMANTIC_SOURCE_CAPS, ...supplied })) {
        caps[safeSourceType(key)] = boundedInteger(value, maxResults, 1, maxResults);
    }
    return caps;
}

function selectDiverseSemanticResults(scored, {
    maxResults,
    sourceCaps,
    maxPerDiversityKey,
    diversityPenalty,
    semanticMode
}) {
    const selected = [];
    const sourceCounts = new Map();
    const diversityCounts = new Map();
    const fingerprints = new Set();
    const remaining = [...scored];

    while (remaining.length && selected.length < maxResults) {
        let bestIndex = -1;
        let bestRankScore = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < remaining.length; index += 1) {
            const row = remaining[index];
            const sourceCap = sourceCaps[row.candidate.sourceType] || sourceCaps.default || maxResults;
            if ((sourceCounts.get(row.candidate.sourceType) || 0) >= sourceCap) continue;
            if ((diversityCounts.get(row.candidate.diversityKey) || 0) >= maxPerDiversityKey) continue;
            if (fingerprints.has(row.fingerprint)) continue;
            const similarityToSelected = semanticMode && selected.length
                ? Math.max(...selected.map((chosen) => Math.max(0, cosineSimilarity(row.vector, chosen.vector))))
                : 0;
            const rankScore = row.score - (similarityToSelected * diversityPenalty);
            if (rankScore > bestRankScore
                || (rankScore === bestRankScore && row.candidate.timestamp > (remaining[bestIndex]?.candidate.timestamp || 0))
                || (rankScore === bestRankScore
                    && row.candidate.timestamp === (remaining[bestIndex]?.candidate.timestamp || 0)
                    && row.candidate.id.localeCompare(remaining[bestIndex]?.candidate.id || '') < 0)) {
                bestIndex = index;
                bestRankScore = rankScore;
            }
        }
        if (bestIndex < 0) break;
        const [chosen] = remaining.splice(bestIndex, 1);
        selected.push(chosen);
        sourceCounts.set(chosen.candidate.sourceType, (sourceCounts.get(chosen.candidate.sourceType) || 0) + 1);
        diversityCounts.set(chosen.candidate.diversityKey, (diversityCounts.get(chosen.candidate.diversityKey) || 0) + 1);
        fingerprints.add(chosen.fingerprint);
    }

    return selected.map(({ candidate, score, semanticScore, lexicalScore }) => ({
        candidate,
        score,
        semanticScore,
        lexicalScore
    }));
}

/**
 * Ranks pre-authorized workspace evidence. Embedding failures are intentionally
 * non-fatal: Winston still gets deterministic local lexical retrieval.
 *
 * Embedder contract: async (texts: string[]) => number[][]
 */
async function rankAiSemanticCandidates({
    query,
    candidates,
    embedder = null,
    maxResults = AI_SEMANTIC_SEARCH_DEFAULTS.maxResults,
    minScore = AI_SEMANTIC_SEARCH_DEFAULTS.minScore,
    sourceCaps = AI_SEMANTIC_SOURCE_CAPS,
    maxCandidates = AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidates,
    maxCandidateChars = AI_SEMANTIC_SEARCH_DEFAULTS.maxCandidateChars,
    maxTotalCandidateChars = AI_SEMANTIC_SEARCH_DEFAULTS.maxTotalCandidateChars,
    maxQueryChars = AI_SEMANTIC_SEARCH_DEFAULTS.maxQueryChars,
    semanticWeight = AI_SEMANTIC_SEARCH_DEFAULTS.semanticWeight,
    diversityPenalty = AI_SEMANTIC_SEARCH_DEFAULTS.diversityPenalty,
    maxPerDiversityKey = AI_SEMANTIC_SEARCH_DEFAULTS.maxPerDiversityKey
} = {}) {
    const startedAt = Date.now();
    const rawCandidateCount = Array.isArray(candidates) ? candidates.length : 0;
    const safeMaxResults = boundedInteger(maxResults, AI_SEMANTIC_SEARCH_DEFAULTS.maxResults, 1, 32);
    const safeQuery = clippedSemanticText(query, boundedInteger(
        maxQueryChars,
        AI_SEMANTIC_SEARCH_DEFAULTS.maxQueryChars,
        40,
        4000
    ));
    const normalizedCandidates = safeQuery
        ? normalizeAiSemanticCandidates(candidates, { maxCandidates, maxCandidateChars, maxTotalCandidateChars })
        : [];
    const lexical = lexicalScores(safeQuery, normalizedCandidates);
    let mode = 'lexical';
    let fallbackReason = typeof embedder === 'function' ? 'embedding-error' : 'embedder-unavailable';
    let vectors = null;

    if (safeQuery && normalizedCandidates.length && typeof embedder === 'function') {
        try {
            vectors = validEmbeddingSet(
                await embedder([safeQuery, ...normalizedCandidates.map((candidate) => `${candidate.label}\n${candidate.text}`)]),
                normalizedCandidates.length + 1
            );
            if (vectors) {
                mode = 'semantic';
                fallbackReason = '';
            } else {
                fallbackReason = 'malformed-embeddings';
            }
        } catch {
            fallbackReason = 'embedding-error';
        }
    }

    const safeSemanticWeight = boundedNumber(
        semanticWeight,
        AI_SEMANTIC_SEARCH_DEFAULTS.semanticWeight,
        0.5,
        1
    );
    const safeMinScore = boundedNumber(minScore, AI_SEMANTIC_SEARCH_DEFAULTS.minScore, 0, 1);
    const queryVector = mode === 'semantic' ? vectors[0] : null;
    const scored = normalizedCandidates.map((candidate, index) => {
        const semanticScore = queryVector ? Math.max(0, cosineSimilarity(queryVector, vectors[index + 1])) : 0;
        const lexicalScore = lexical[index];
        const score = mode === 'semantic'
            ? (semanticScore * safeSemanticWeight) + (lexicalScore * (1 - safeSemanticWeight))
            : lexicalScore;
        return {
            candidate,
            score,
            semanticScore,
            lexicalScore,
            vector: mode === 'semantic' ? vectors[index + 1] : null,
            fingerprint: textFingerprint(`${candidate.label}\n${candidate.text}`)
        };
    }).filter((row) => row.score >= safeMinScore);

    const results = selectDiverseSemanticResults(scored, {
        maxResults: safeMaxResults,
        sourceCaps: resolvedSourceCaps(sourceCaps, safeMaxResults),
        maxPerDiversityKey: boundedInteger(
            maxPerDiversityKey,
            AI_SEMANTIC_SEARCH_DEFAULTS.maxPerDiversityKey,
            1,
            safeMaxResults
        ),
        diversityPenalty: boundedNumber(
            diversityPenalty,
            AI_SEMANTIC_SEARCH_DEFAULTS.diversityPenalty,
            0,
            0.5
        ),
        semanticMode: mode === 'semantic'
    });

    return {
        mode,
        results,
        metrics: {
            mode,
            fallbackReason,
            inputCandidates: rawCandidateCount,
            normalizedCandidates: normalizedCandidates.length,
            embeddedCandidates: mode === 'semantic' ? normalizedCandidates.length : 0,
            eligibleCandidates: scored.length,
            returned: results.length,
            durationMs: Math.max(0, Date.now() - startedAt)
        }
    };
}

function validatedEmbeddingEndpoint(value) {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Embedding bridge URL must use HTTP or HTTPS.');
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
}

function validatedEmbeddingModel(value) {
    const model = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)) {
        throw new Error('A valid allowlisted Ollama embedding model is required.');
    }
    return model;
}

/**
 * Creates an embedder for the authenticated local Ollama bridge. It sends no
 * logs and retains no text or vectors after each invocation.
 */
function createOllamaEmbeddingClient({
    baseUrl,
    token,
    model = 'nomic-embed-text',
    fetchImpl = globalThis.fetch,
    timeoutMs = 20000,
    maxBatchSize = 32
} = {}) {
    const endpoint = validatedEmbeddingEndpoint(baseUrl);
    const bridgeToken = String(token || '').trim();
    const embeddingModel = validatedEmbeddingModel(model);
    const safeTimeout = boundedInteger(timeoutMs, 20000, 1000, 120000);
    const batchSize = boundedInteger(maxBatchSize, 32, 1, 64);
    if (!bridgeToken) throw new Error('An Ollama bridge token is required for embeddings.');
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for embeddings.');

    return async function ollamaEmbeddingClient(texts) {
        if (!Array.isArray(texts) || texts.length < 1 || texts.length > 257) {
            throw new Error('Embedding input must contain between 1 and 257 bounded texts.');
        }
        const boundedTexts = texts.map((text) => clippedSemanticText(text, 8000));
        if (boundedTexts.some((text) => !text)) throw new Error('Embedding input cannot contain empty text.');
        const embeddings = [];
        for (let offset = 0; offset < boundedTexts.length; offset += batchSize) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), safeTimeout);
            try {
                const response = await fetchImpl(`${endpoint}/api/embed`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${bridgeToken}`,
                        'Content-Type': 'application/json',
                        Accept: 'application/json'
                    },
                    body: JSON.stringify({
                        model: embeddingModel,
                        input: boundedTexts.slice(offset, offset + batchSize),
                        truncate: true
                    }),
                    signal: controller.signal
                });
                if (!response?.ok) throw new Error(`Local embedding bridge rejected the request (${Number(response?.status) || 502}).`);
                const payload = await response.json();
                if (!Array.isArray(payload?.embeddings)) throw new Error('Local embedding bridge returned malformed vectors.');
                embeddings.push(...payload.embeddings);
            } finally {
                clearTimeout(timer);
            }
        }
        const validated = validEmbeddingSet(embeddings, boundedTexts.length);
        if (!validated) throw new Error('Local embedding bridge returned malformed vectors.');
        return validated;
    };
}

module.exports = {
    AI_SEMANTIC_SEARCH_DEFAULTS,
    AI_SEMANTIC_SOURCE_CAPS,
    compactSemanticText,
    cosineSimilarity,
    createOllamaEmbeddingClient,
    normalizeAiSemanticCandidates,
    rankAiSemanticCandidates
};
