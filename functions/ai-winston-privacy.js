'use strict';

const crypto = require('crypto');

const WINSTON_SERVER_PRIVACY_VERSION = 1;
const SEVERITY_SCORE = Object.freeze({
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
});
const CATEGORY_POLICY = Object.freeze({
    credentials: Object.freeze({ severity: 'critical', reason: 'credential_secret' }),
    private_key: Object.freeze({ severity: 'critical', reason: 'private_key' }),
    payment_card: Object.freeze({ severity: 'critical', reason: 'payment_card' }),
    financial: Object.freeze({ severity: 'high', reason: 'financial_account' }),
    government_id: Object.freeze({ severity: 'high', reason: 'government_id' }),
    health: Object.freeze({ severity: 'high', reason: 'health_data' }),
    biometric: Object.freeze({ severity: 'high', reason: 'biometric_data' }),
    private_document: Object.freeze({ severity: 'high', reason: 'private_document' }),
    precise_location: Object.freeze({ severity: 'high', reason: 'precise_location' }),
    contact: Object.freeze({ severity: 'low', reason: 'contact_data' })
});
const CATEGORY_ORDER = Object.freeze(Object.keys(CATEGORY_POLICY));
const PROVIDERS = Object.freeze(['local', 'cloudflare', 'groq']);
const PROVIDER_ORDER = Object.freeze({ local: 0, cloudflare: 1, groq: 2 });
const PROVIDER_DEFAULTS = Object.freeze({
    local: Object.freeze({
        available: true,
        healthy: true,
        latencyMs: 900,
        errorRate: 0,
        queueDepth: 0,
        queueCapacity: 10,
        supports: Object.freeze(['text', 'image', 'document'])
    }),
    cloudflare: Object.freeze({
        available: true,
        healthy: true,
        latencyMs: 1100,
        errorRate: 0,
        queueDepth: 0,
        queueCapacity: 40,
        supports: Object.freeze(['text', 'image', 'document'])
    }),
    groq: Object.freeze({
        available: true,
        healthy: true,
        latencyMs: 700,
        errorRate: 0,
        queueDepth: 0,
        queueCapacity: 40,
        supports: Object.freeze(['text', 'audio', 'document'])
    })
});
const COMPLEX_INTENT = /\b(?:analy[sz]e|compare|investigate|strategy|strategic|plan|reason|trade-?offs?|comprehensive|synthesi[sz]e|architecture|debug|diagnose|prove|evaluate|research)\b/i;
const CODE_SIGNAL = /(?:```|(?:^|\n)\s*(?:function|class|interface|const|let|var|def|SELECT|CREATE TABLE)\b|(?:TypeError|ReferenceError|stack trace))/i;
const RULES = Object.freeze([
    Object.freeze({
        category: 'private_key',
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi
    }),
    Object.freeze({
        category: 'credentials',
        pattern: /\b(?:bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi
    }),
    Object.freeze({
        category: 'credentials',
        pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gi
    }),
    Object.freeze({
        category: 'credentials',
        pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/gi
    }),
    Object.freeze({
        category: 'credentials',
        pattern: /\b(?:password|passcode|api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|secret[_\s-]?key)\s*(?:is|=|:)\s*["']?[^\s"',;]{4,}["']?/gi
    }),
    Object.freeze({
        category: 'credentials',
        pattern: /\b(?:seed|recovery|mnemonic)\s+phrase\s*(?:is|=|:)\s*(?:[a-z]{3,}\s+){7,23}[a-z]{3,}\b/gi
    }),
    Object.freeze({
        category: 'financial',
        pattern: /\b(?:bank|checking|savings|brokerage)\s+account(?:\s+(?:number|no\.?))?\s*(?:is|=|:|#)\s*[A-Za-z0-9 -]{5,34}\b/gi
    }),
    Object.freeze({
        category: 'financial',
        pattern: /\b(?:routing|sort|iban|swift|bic)\s*(?:number|code|no\.?)?\s*(?:is|=|:|#)\s*[A-Z0-9 -]{6,34}\b/gi
    }),
    Object.freeze({
        category: 'financial',
        pattern: /\b(?:cvv|cvc|security code)\s*(?:is|=|:|#)\s*\d{3,4}\b/gi
    }),
    Object.freeze({
        category: 'government_id',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g
    }),
    Object.freeze({
        category: 'government_id',
        pattern: /\b(?:ssn|social security|tax id|passport|driver'?s?\s+licen[cs]e)\s*(?:number|no\.?)?\s*(?:is|=|:|#)\s*[A-Z0-9 -]{5,20}\b/gi
    }),
    Object.freeze({
        category: 'health',
        pattern: /\b(?:medical record|patient id|diagnos(?:is|ed with)|prescription|my medication|treatment plan|lab result|blood test|therapy notes?)\b(?:\s*(?:is|=|:)\s*)?[^.\r\n]{0,180}/gi
    }),
    Object.freeze({
        category: 'biometric',
        pattern: /\b(?:fingerprint|faceprint|voiceprint|retina|iris)\s+(?:scan|template|signature|data)\b[^.\r\n]{0,120}/gi
    }),
    Object.freeze({
        category: 'private_document',
        pattern: /\b(?:confidential|strictly private|private document|internal only|attorney-client privileged|under nda)\b[^.\r\n]{0,220}/gi
    }),
    Object.freeze({
        category: 'precise_location',
        pattern: /\b(?:my|home|residential|billing|shipping)\s+address\s*(?:is|=|:)\s*\d{1,7}\s+[A-Za-z0-9.' -]{2,80}\b/gi
    }),
    Object.freeze({
        category: 'contact',
        pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi
    }),
    Object.freeze({
        category: 'contact',
        pattern: /(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
    })
]);

function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
}

function clip(value, limit) {
    return String(value || '').slice(0, limit);
}

function sanitizedMessageText(value) {
    if (typeof value === 'string') return value.slice(0, 120000);
    const source = value && typeof value === 'object' ? value : {};
    const messages = Array.isArray(value)
        ? value
        : Array.isArray(source.messages)
            ? source.messages
            : [];
    return messages
        .slice(-36)
        .map((message) => (
            typeof message === 'string'
                ? clip(message, 12000)
                : clip(message?.content || message?.text, 12000)
        ))
        .filter(Boolean)
        .join('\n')
        .slice(-120000);
}

function normalizeAttachmentKind(value) {
    const candidate = String(
        typeof value === 'string'
            ? value
            : value?.kind || value?.type || value?.mimeType || ''
    ).trim().toLowerCase();
    if (candidate === 'text' || candidate.startsWith('text/')) return 'text';
    if (candidate.startsWith('image/') || ['image', 'photo', 'vision'].includes(candidate)) return 'image';
    if (candidate.startsWith('audio/') || ['audio', 'voice', 'recording'].includes(candidate)) return 'audio';
    if (candidate.startsWith('video/') || candidate === 'video') return 'video';
    if (
        candidate.includes('spreadsheet')
        || candidate.includes('excel')
        || candidate.includes('csv')
        || ['xlsx', 'xls', 'csv', 'sheet'].includes(candidate)
    ) return 'spreadsheet';
    if (
        candidate.includes('pdf')
        || candidate.includes('word')
        || candidate.includes('document')
        || ['doc', 'docx', 'txt', 'file'].includes(candidate)
    ) return 'document';
    return candidate ? 'other' : '';
}

function inputAttachments(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const attachments = Array.isArray(source.attachments)
        ? source.attachments
        : source.attachment
            ? [source.attachment]
            : [];
    return attachments.slice(0, 8);
}

function attachmentKinds(value) {
    return [...new Set(inputAttachments(value).map(normalizeAttachmentKind).filter(Boolean))];
}

function luhnValid(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    let alternate = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        let digit = Number(digits[index]);
        if (alternate) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        alternate = !alternate;
    }
    return sum % 10 === 0;
}

function metadataCategoryCounts(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const context = source.context && typeof source.context === 'object' ? source.context : {};
    const counts = {};
    const add = (category) => {
        if (CATEGORY_POLICY[category]) counts[category] = (counts[category] || 0) + 1;
    };
    const declaredClasses = [
        ...(Array.isArray(context.dataClasses) ? context.dataClasses : []),
        ...(Array.isArray(source.dataClasses) ? source.dataClasses : [])
    ].map((entry) => String(entry || '').trim().toLowerCase());
    for (const dataClass of declaredClasses) {
        if (['credential', 'credentials', 'secret', 'authentication'].includes(dataClass)) add('credentials');
        else if (['financial', 'banking', 'payment'].includes(dataClass)) add('financial');
        else if (['health', 'medical', 'phi'].includes(dataClass)) add('health');
        else if (['government_id', 'identity', 'pii'].includes(dataClass)) add('government_id');
        else if (['biometric', 'biometrics'].includes(dataClass)) add('biometric');
        else if (['private_document', 'confidential', 'privileged'].includes(dataClass)) add('private_document');
        else if (['precise_location', 'home_address'].includes(dataClass)) add('precise_location');
        else if (['contact', 'email', 'phone'].includes(dataClass)) add('contact');
    }
    if (context.containsPrivateDocuments === true || context.privateDocument === true) add('private_document');
    if (context.containsHealthData === true) add('health');
    if (context.containsFinancialData === true) add('financial');
    if (context.containsCredentials === true) add('credentials');
    for (const attachment of inputAttachments(source)) {
        const sensitivity = String(attachment?.sensitivity || attachment?.classification || '')
            .trim()
            .toLowerCase();
        const name = clip(attachment?.name, 160);
        if (['confidential', 'private', 'restricted', 'secret'].includes(sensitivity)) {
            add(sensitivity === 'secret' ? 'credentials' : 'private_document');
        }
        if (/\b(?:medical|patient|health|diagnosis|lab result)\b/i.test(name)) add('health');
        if (/\b(?:bank|financial|tax return|credit card)\b/i.test(name)) add('financial');
        if (/\b(?:confidential|private|restricted|privileged)\b/i.test(name)) add('private_document');
    }
    return counts;
}

function highestSeverity(categories) {
    return categories.reduce((highest, category) => (
        SEVERITY_SCORE[category.severity] > SEVERITY_SCORE[highest]
            ? category.severity
            : highest
    ), 'none');
}

function detectTextCategoryCounts(text) {
    const counts = {};
    for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        const matches = text.match(rule.pattern);
        if (matches?.length) counts[rule.category] = (counts[rule.category] || 0) + matches.length;
    }
    const cardPattern = /(?:^|[^\d])(\d(?:[\s-]?\d){12,18})(?!\d)/g;
    let cardMatch = cardPattern.exec(text);
    while (cardMatch) {
        if (luhnValid(cardMatch[1])) {
            counts.payment_card = (counts.payment_card || 0) + 1;
        }
        cardMatch = cardPattern.exec(text);
    }
    return counts;
}

function classifyWinstonSensitivity(value) {
    const textCounts = detectTextCategoryCounts(sanitizedMessageText(value));
    const metadataCounts = metadataCategoryCounts(value);
    const categories = CATEGORY_ORDER.flatMap((id) => {
        const matches = (textCounts[id] || 0) + (metadataCounts[id] || 0);
        if (!matches) return [];
        return [{
            id,
            severity: CATEGORY_POLICY[id].severity,
            matches,
            action: SEVERITY_SCORE[CATEGORY_POLICY[id].severity] >= SEVERITY_SCORE.high
                ? 'local_only'
                : 'redact_for_cloud'
        }];
    });
    const severity = highestSeverity(categories);
    const localOnly = SEVERITY_SCORE[severity] >= SEVERITY_SCORE.high;
    return Object.freeze({
        version: WINSTON_SERVER_PRIVACY_VERSION,
        sensitive: categories.length > 0,
        severity,
        severityScore: SEVERITY_SCORE[severity],
        localOnly,
        cloudAllowed: !localOnly,
        policy: localOnly ? 'local_only' : categories.length ? 'redact_for_cloud' : 'standard',
        matchCount: categories.reduce((sum, category) => sum + category.matches, 0),
        categories: Object.freeze(categories.map((category) => Object.freeze(category))),
        reasonCodes: Object.freeze(categories.map(({ id }) => CATEGORY_POLICY[id].reason))
    });
}

function scoreComplexity(value) {
    const text = sanitizedMessageText(value);
    const kinds = attachmentKinds(value);
    const reasons = [];
    let score = 0;
    if (text.length >= 2500) {
        score += 3;
        reasons.push('very_long_prompt');
    } else if (text.length >= 900) {
        score += 2;
        reasons.push('long_prompt');
    } else if (text.length >= 350) {
        score += 1;
        reasons.push('medium_prompt');
    }
    if (COMPLEX_INTENT.test(text)) {
        score += 3;
        reasons.push('complex_intent');
    }
    if (CODE_SIGNAL.test(text)) {
        score += 2;
        reasons.push('code_or_debugging');
    }
    const questionCount = (text.match(/\?/g) || []).length;
    const listCount = (text.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/g) || []).length;
    if (questionCount >= 2 || listCount >= 2) {
        score += 2;
        reasons.push('multi_part');
    }
    if (kinds.some((kind) => ['document', 'spreadsheet', 'video'].includes(kind))) {
        score += 2;
        reasons.push('complex_attachment');
    } else if (kinds.length) {
        score += 1;
        reasons.push('attachment');
    }
    return {
        score: Math.max(0, Math.min(10, score)),
        kinds,
        reasons
    };
}

function feedbackRate(value) {
    if (typeof value === 'number') return boundedNumber(value, 0.5, 0, 1);
    const helpful = boundedNumber(value?.helpful, 0, 0, 1000000);
    const total = boundedNumber(value?.total, 0, 0, 1000000);
    return total > 0 ? helpful / total : 0.5;
}

function resolveAdaptiveWinstonModelProfile(value, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { messages: Array.isArray(value) ? value : [{ role: 'user', content: value }] };
    const settings = options && typeof options === 'object' ? options : {};
    const requested = String(
        settings.requestedProfile
        || source.requestedProfile
        || source.modelProfile
        || 'auto'
    ).trim().toLowerCase();
    const complexity = scoreComplexity(source);
    if (requested === 'fast' || requested === 'smart') {
        return Object.freeze({
            requestedProfile: requested,
            modelProfile: requested,
            automatic: false,
            reason: 'user_selected',
            complexityScore: complexity.score
        });
    }
    const feedback = settings.feedback || source.feedback || {};
    const fastRate = feedbackRate(feedback?.profiles?.fast);
    const smartRate = feedbackRate(feedback?.profiles?.smart);
    let modelProfile = complexity.score >= 4 ? 'smart' : 'fast';
    let reason = complexity.reasons[0] || 'short_request';
    if (complexity.score === 3 && smartRate - fastRate >= 0.25) {
        modelProfile = 'smart';
        reason = 'feedback_prefers_smart';
    } else if (complexity.score === 4 && fastRate - smartRate >= 0.35) {
        modelProfile = 'fast';
        reason = 'feedback_prefers_fast';
    }
    return Object.freeze({
        requestedProfile: 'auto',
        modelProfile,
        automatic: true,
        reason,
        complexityScore: complexity.score
    });
}

function queueState(queue, provider, health, defaults) {
    const source = queue?.[provider];
    if (typeof source === 'number') {
        return {
            depth: boundedNumber(source, defaults.queueDepth, 0, 100000),
            capacity: boundedNumber(health.queueCapacity, defaults.queueCapacity, 1, 100000)
        };
    }
    return {
        depth: boundedNumber(
            source?.depth ?? source?.queued ?? health.queueDepth,
            defaults.queueDepth,
            0,
            100000
        ),
        capacity: boundedNumber(
            source?.capacity ?? health.queueCapacity,
            defaults.queueCapacity,
            1,
            100000
        )
    };
}

function providerState(provider, providerHealth, queue) {
    const defaults = PROVIDER_DEFAULTS[provider];
    const health = providerHealth?.[provider] || {};
    const providerQueue = queueState(queue, provider, health, defaults);
    const supports = Array.isArray(health.supports)
        ? [...new Set(health.supports.map(normalizeAttachmentKind).filter(Boolean))]
        : [...defaults.supports];
    return {
        provider,
        available: health.available !== false,
        healthy: health.healthy !== false,
        latencyMs: boundedNumber(health.latencyMs, defaults.latencyMs, 0, 120000),
        errorRate: boundedNumber(health.errorRate, defaults.errorRate, 0, 1),
        queueDepth: providerQueue.depth,
        queueCapacity: providerQueue.capacity,
        supports
    };
}

function providerScore(state, { complexity, feedback, localMetrics, classification }) {
    const base = { local: 72, cloudflare: 66, groq: 64 }[state.provider];
    const queueRatio = Math.min(2, state.queueDepth / state.queueCapacity);
    let score = base;
    score -= Math.min(42, queueRatio * 32);
    score -= Math.min(24, state.errorRate * 60);
    score -= Math.min(18, state.latencyMs / 1500);
    score += (feedbackRate(feedback?.providers?.[state.provider]) - 0.5) * 24;
    if (state.provider === 'local') {
        const ttftMs = boundedNumber(localMetrics?.ttftMs, 1500, 0, 120000);
        const tokensPerSecond = boundedNumber(localMetrics?.tokensPerSecond, 10, 0, 1000);
        score += ttftMs <= 1200 ? 7 : ttftMs >= 6000 ? -16 : 0;
        score += tokensPerSecond >= 15 ? 8 : tokensPerSecond < 4 ? -14 : 0;
        if (classification.sensitive) score += 14;
    }
    if (state.provider === 'groq' && complexity.kinds.includes('audio')) score += 18;
    if (state.provider !== 'local' && classification.sensitive) score -= 8;
    return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

function requiredCapabilities(kinds) {
    return [...new Set(['text', ...kinds.map((kind) => (
        kind === 'spreadsheet' ? 'document' : kind
    ))])];
}

function resolveServerWinstonRoute(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { messages: [{ role: 'user', content: value }] };
    const classification = classifyWinstonSensitivity(source);
    const complexity = scoreComplexity(source);
    const profile = resolveAdaptiveWinstonModelProfile(source);
    const localOnly = String(source.routingPolicy || '').trim().toLowerCase() === 'local-only'
        || classification.localOnly;
    const capabilities = requiredCapabilities(complexity.kinds);
    const excluded = [];
    const candidates = PROVIDERS.flatMap((provider) => {
        const state = providerState(provider, source.providerHealth, source.queue);
        if (localOnly && provider !== 'local') {
            excluded.push({ provider, reason: 'local_only' });
            return [];
        }
        if (!state.available || !state.healthy) {
            excluded.push({ provider, reason: state.available ? 'unhealthy' : 'unavailable' });
            return [];
        }
        if (!capabilities.every((capability) => state.supports.includes(capability))) {
            excluded.push({ provider, reason: 'unsupported_attachment' });
            return [];
        }
        if (state.queueDepth >= state.queueCapacity * 2) {
            excluded.push({ provider, reason: 'queue_saturated' });
            return [];
        }
        return [{
            provider,
            score: providerScore(state, {
                complexity,
                feedback: source.feedback || {},
                localMetrics: source.localMetrics || {},
                classification
            }),
            queueDepth: state.queueDepth,
            queueCapacity: state.queueCapacity
        }];
    }).sort((left, right) => (
        right.score - left.score
        || PROVIDER_ORDER[left.provider] - PROVIDER_ORDER[right.provider]
    ));
    const selected = candidates[0] || null;
    const reasons = [
        localOnly ? 'local_only' : 'adaptive_route',
        profile.reason,
        ...(selected?.queueDepth >= selected?.queueCapacity ? ['queue_pressure'] : []),
        ...(selected?.provider === 'groq' && complexity.kinds.includes('audio')
            ? ['audio_specialist']
            : []),
        ...(!selected ? ['no_healthy_capable_provider'] : [])
    ];
    return Object.freeze({
        version: WINSTON_SERVER_PRIVACY_VERSION,
        requestedProfile: profile.requestedProfile,
        modelProfile: profile.modelProfile,
        automaticProfile: profile.automatic,
        provider: selected?.provider || null,
        fallbackProviders: Object.freeze(candidates.slice(1, 3).map(({ provider }) => provider)),
        routeBlocked: !selected,
        localOnly,
        sensitivity: classification.severity,
        sensitivityCategories: Object.freeze(classification.categories.map(({ id }) => id)),
        complexityScore: complexity.score,
        attachmentKinds: Object.freeze(complexity.kinds),
        reasons: Object.freeze([...new Set(reasons)].slice(0, 8)),
        providerScores: Object.freeze(Object.fromEntries(
            candidates.map(({ provider, score }) => [provider, score])
        )),
        excludedProviders: Object.freeze(excluded.slice(0, 3).map((entry) => Object.freeze(entry)))
    });
}

function safeReasonCodes(value) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map((reason) => String(reason || '').trim().toLowerCase())
        .filter((reason) => /^[a-z0-9_-]{2,64}$/.test(reason)))]
        .slice(0, 12);
}

function buildWinstonRouteReceipt({
    requestId = '',
    classification,
    routeDecision,
    createdAt = 0
} = {}) {
    const safeClassification = classification?.version === WINSTON_SERVER_PRIVACY_VERSION
        ? classification
        : classifyWinstonSensitivity('');
    const provider = routeDecision?.routeBlocked
        ? 'blocked'
        : PROVIDERS.includes(routeDecision?.provider)
            ? routeDecision.provider
            : 'unknown';
    const profile = ['fast', 'smart'].includes(routeDecision?.modelProfile)
        ? routeDecision.modelProfile
        : 'fast';
    const cleanRequestId = clip(requestId, 500);
    return Object.freeze({
        version: WINSTON_SERVER_PRIVACY_VERSION,
        requestHash: cleanRequestId
            ? crypto.createHash('sha256').update(cleanRequestId).digest('hex')
            : '',
        createdAt: Math.max(0, Math.floor(Number(createdAt) || 0)),
        provider,
        modelProfile: profile,
        localOnly: safeClassification.localOnly === true,
        sensitivity: SEVERITY_SCORE[safeClassification.severity] === undefined
            ? 'none'
            : safeClassification.severity,
        categories: Object.freeze(
            (Array.isArray(safeClassification.categories) ? safeClassification.categories : [])
                .map(({ id }) => String(id || '').trim().toLowerCase())
                .filter((id) => CATEGORY_POLICY[id])
        ),
        routeBlocked: routeDecision?.routeBlocked === true,
        reasonCodes: Object.freeze(safeReasonCodes([
            ...(Array.isArray(routeDecision?.reasons) ? routeDecision.reasons : []),
            ...(Array.isArray(safeClassification.reasonCodes) ? safeClassification.reasonCodes : [])
        ]))
    });
}

module.exports = {
    WINSTON_SERVER_PRIVACY_VERSION,
    buildWinstonRouteReceipt,
    classifyWinstonSensitivity,
    resolveAdaptiveWinstonModelProfile,
    resolveServerWinstonRoute
};
