export const WINSTON_SENSITIVITY_VERSION = 1;
export const WINSTON_REDACTION_POLICY_VERSION = 1;

const SEVERITY_SCORE = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

const CATEGORY_POLICY = Object.freeze({
  credentials: Object.freeze({
    severity: 'critical',
    placeholder: '[REDACTED CREDENTIAL]',
    localOnly: true,
    reason: 'credential_secret',
  }),
  private_key: Object.freeze({
    severity: 'critical',
    placeholder: '[REDACTED PRIVATE KEY]',
    localOnly: true,
    reason: 'private_key',
  }),
  payment_card: Object.freeze({
    severity: 'critical',
    placeholder: '[REDACTED PAYMENT CARD]',
    localOnly: true,
    reason: 'payment_card',
  }),
  financial: Object.freeze({
    severity: 'high',
    placeholder: '[REDACTED FINANCIAL DATA]',
    localOnly: true,
    reason: 'financial_account',
  }),
  government_id: Object.freeze({
    severity: 'high',
    placeholder: '[REDACTED GOVERNMENT ID]',
    localOnly: true,
    reason: 'government_id',
  }),
  health: Object.freeze({
    severity: 'high',
    placeholder: '[REDACTED HEALTH DATA]',
    localOnly: true,
    reason: 'health_data',
  }),
  biometric: Object.freeze({
    severity: 'high',
    placeholder: '[REDACTED BIOMETRIC DATA]',
    localOnly: true,
    reason: 'biometric_data',
  }),
  private_document: Object.freeze({
    severity: 'medium',
    placeholder: '[REDACTED PRIVATE CONTENT]',
    localOnly: true,
    reason: 'private_document',
  }),
  precise_location: Object.freeze({
    severity: 'medium',
    placeholder: '[REDACTED ADDRESS]',
    localOnly: true,
    reason: 'precise_location',
  }),
  contact: Object.freeze({
    severity: 'low',
    placeholder: '[REDACTED CONTACT]',
    localOnly: false,
    reason: 'contact_data',
  }),
});

const CATEGORY_ORDER = Object.freeze(Object.keys(CATEGORY_POLICY));
const CLOUD_PROVIDER_IDS = new Set(['cloud', 'cloudflare', 'groq', 'remote']);

const SIMPLE_RULES = Object.freeze([
  Object.freeze({
    category: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
  }),
  Object.freeze({
    category: 'credentials',
    pattern: /\b(?:bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  }),
  Object.freeze({
    category: 'credentials',
    pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gi,
  }),
  Object.freeze({
    category: 'credentials',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/gi,
  }),
  Object.freeze({
    category: 'credentials',
    pattern: /\b(?:password|passcode|api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|secret[_\s-]?key)\s*(?:is|=|:)\s*["']?[^\s"',;]{4,}["']?/gi,
  }),
  Object.freeze({
    category: 'credentials',
    pattern: /\b(?:seed|recovery|mnemonic)\s+phrase\s*(?:is|=|:)\s*(?:[a-z]{3,}\s+){7,23}[a-z]{3,}\b/gi,
  }),
  Object.freeze({
    category: 'financial',
    pattern: /\b(?:bank|checking|savings|brokerage)\s+account(?:\s+(?:number|no\.?))?\s*(?:is|=|:|#)\s*[A-Za-z0-9 -]{5,34}\b/gi,
  }),
  Object.freeze({
    category: 'financial',
    pattern: /\b(?:routing|sort|iban|swift|bic)\s*(?:number|code|no\.?)?\s*(?:is|=|:|#)\s*[A-Z0-9 -]{6,34}\b/gi,
  }),
  Object.freeze({
    category: 'financial',
    pattern: /\b(?:cvv|cvc|security code)\s*(?:is|=|:|#)\s*\d{3,4}\b/gi,
  }),
  Object.freeze({
    category: 'government_id',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  }),
  Object.freeze({
    category: 'government_id',
    pattern: /\b(?:ssn|social security|tax id|passport|driver'?s?\s+licen[cs]e)\s*(?:number|no\.?)?\s*(?:is|=|:|#)\s*[A-Z0-9 -]{5,20}\b/gi,
  }),
  Object.freeze({
    category: 'health',
    pattern: /\b(?:medical record|patient id|diagnos(?:is|ed with)|prescription|my medication|treatment plan|lab result|blood test|therapy notes?)\b(?:\s*(?:is|=|:)\s*)?[^.\r\n]{0,180}/gi,
  }),
  Object.freeze({
    category: 'biometric',
    pattern: /\b(?:fingerprint|faceprint|voiceprint|retina|iris)\s+(?:scan|template|signature|data)\b[^.\r\n]{0,120}/gi,
  }),
  Object.freeze({
    category: 'private_document',
    pattern: /\b(?:confidential|strictly private|private document|internal only|attorney-client privileged|under nda)\b[^.\r\n]{0,220}/gi,
  }),
  Object.freeze({
    category: 'precise_location',
    pattern: /\b(?:my|home|residential|billing|shipping)\s+address\s*(?:is|=|:)\s*\d{1,7}\s+[A-Za-z0-9.' -]{2,80}\b/gi,
  }),
  Object.freeze({
    category: 'contact',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi,
  }),
  Object.freeze({
    category: 'contact',
    pattern: /(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    trimLeadingNonDigit: true,
  }),
]);

function boundedText(value, limit = 200_000) {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else if (value === null || value === undefined) {
    text = '';
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.slice(0, Math.max(0, Math.min(1_000_000, Number(limit) || 0)));
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

function addFinding(findings, category, start, end) {
  const policy = CATEGORY_POLICY[category];
  if (!policy || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return;
  findings.push({
    category,
    severity: policy.severity,
    localOnly: policy.localOnly,
    placeholder: policy.placeholder,
    start,
    end,
  });
}

function detectFindings(value) {
  const text = boundedText(value);
  const findings = [];

  for (const rule of SIMPLE_RULES) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(text);
    while (match) {
      let start = match.index;
      let matched = match[0];
      if (rule.trimLeadingNonDigit) {
        const offset = matched.search(/\d/);
        if (offset > 0) {
          start += offset;
          matched = matched.slice(offset);
        }
      }
      addFinding(findings, rule.category, start, start + matched.length);
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
      match = rule.pattern.exec(text);
    }
  }

  const cardPattern = /(?:^|[^\d])(\d(?:[\s-]?\d){12,18})(?!\d)/g;
  let cardMatch = cardPattern.exec(text);
  while (cardMatch) {
    if (luhnValid(cardMatch[1])) {
      const offset = cardMatch[0].indexOf(cardMatch[1]);
      addFinding(
        findings,
        'payment_card',
        cardMatch.index + offset,
        cardMatch.index + offset + cardMatch[1].length,
      );
    }
    cardMatch = cardPattern.exec(text);
  }

  return { text, findings };
}

function categorySummary(findings) {
  return CATEGORY_ORDER.flatMap((category) => {
    const matches = findings.filter((finding) => finding.category === category);
    if (!matches.length) return [];
    const policy = CATEGORY_POLICY[category];
    return [{
      id: category,
      severity: policy.severity,
      matches: matches.length,
      action: policy.localOnly ? 'local_only' : 'redact_for_cloud',
    }];
  });
}

function highestSeverity(categories) {
  return categories.reduce(
    (highest, category) => (
      SEVERITY_SCORE[category.severity] > SEVERITY_SCORE[highest]
        ? category.severity
        : highest
    ),
    'none',
  );
}

function mergeRedactionRanges(findings) {
  return [...findings]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((ranges, finding) => {
      const previous = ranges.at(-1);
      if (!previous || finding.start > previous.end) {
        ranges.push({ ...finding });
        return ranges;
      }
      previous.end = Math.max(previous.end, finding.end);
      if (SEVERITY_SCORE[finding.severity] > SEVERITY_SCORE[previous.severity]) {
        previous.category = finding.category;
        previous.severity = finding.severity;
        previous.placeholder = finding.placeholder;
        previous.localOnly = finding.localOnly;
      } else if (finding.localOnly) {
        previous.localOnly = true;
      }
      return ranges;
    }, []);
}

export function classifyWinstonSensitivity(value) {
  const { findings } = detectFindings(value);
  const categories = categorySummary(findings);
  const severity = highestSeverity(categories);
  const localOnly = categories.some((category) => category.action === 'local_only');
  return Object.freeze({
    version: WINSTON_SENSITIVITY_VERSION,
    sensitive: categories.length > 0,
    severity,
    severityScore: SEVERITY_SCORE[severity],
    localOnly,
    cloudAllowed: !localOnly,
    policy: localOnly ? 'local_only' : categories.length ? 'redact_for_cloud' : 'standard',
    matchCount: findings.length,
    categories: Object.freeze(categories.map((category) => Object.freeze(category))),
    reasonCodes: Object.freeze(categories.map(({ id }) => CATEGORY_POLICY[id].reason)),
  });
}

export function redactWinstonSensitiveText(value) {
  const { text, findings } = detectFindings(value);
  const ranges = mergeRedactionRanges(findings);
  if (!ranges.length) {
    return {
      text,
      changed: false,
      redactionCount: 0,
      categories: [],
    };
  }
  let cursor = 0;
  let redacted = '';
  for (const range of ranges) {
    redacted += text.slice(cursor, range.start);
    redacted += range.placeholder;
    cursor = range.end;
  }
  redacted += text.slice(cursor);
  return {
    text: redacted,
    changed: true,
    redactionCount: ranges.length,
    categories: categorySummary(findings).map(({ id }) => id),
  };
}

export function prepareWinstonPromptForRoute(value, {
  provider = 'local',
  allowRedactedSensitive = false,
} = {}) {
  const text = boundedText(value);
  const classification = classifyWinstonSensitivity(text);
  const cloudRoute = CLOUD_PROVIDER_IDS.has(String(provider || '').trim().toLowerCase());

  if (!cloudRoute) {
    return {
      allowed: true,
      text,
      classification,
      redacted: false,
      redactionCount: 0,
      policy: 'local_unmodified',
    };
  }

  const redaction = redactWinstonSensitiveText(text);
  if (classification.localOnly && !allowRedactedSensitive) {
    return {
      allowed: false,
      text: '',
      classification,
      redacted: redaction.changed,
      redactionCount: redaction.redactionCount,
      policy: 'blocked_local_only',
    };
  }

  return {
    allowed: true,
    text: redaction.text,
    classification,
    redacted: redaction.changed,
    redactionCount: redaction.redactionCount,
    policy: redaction.changed ? 'redacted_for_cloud' : 'standard',
  };
}

function safeReceiptId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(id) ? id : '';
}

function safeRouteId(value) {
  const route = String(value || '').trim().toLowerCase();
  return ['local', 'cloudflare', 'groq', 'blocked', 'unknown'].includes(route)
    ? route
    : 'unknown';
}

function safeProfile(value) {
  const profile = String(value || '').trim().toLowerCase();
  return ['fast', 'smart'].includes(profile) ? profile : 'fast';
}

export function buildWinstonRouteReceipt({
  requestId = '',
  classification,
  routeDecision,
  routePreparation,
  createdAt = Date.now(),
} = {}) {
  const safeClassification = classification?.version === WINSTON_SENSITIVITY_VERSION
    ? classification
    : classifyWinstonSensitivity('');
  const provider = routeDecision?.routeBlocked
    ? 'blocked'
    : safeRouteId(routeDecision?.provider);
  const reasonCodes = [...new Set([
    ...(Array.isArray(routeDecision?.reasons) ? routeDecision.reasons : []),
    ...safeClassification.reasonCodes,
  ].map((reason) => String(reason || '').trim().toLowerCase())
    .filter((reason) => /^[a-z0-9_-]{2,64}$/.test(reason)))]
    .slice(0, 12);

  return Object.freeze({
    version: 1,
    requestId: safeReceiptId(requestId),
    createdAt: Math.max(0, Math.floor(Number(createdAt) || 0)),
    provider,
    modelProfile: safeProfile(routeDecision?.modelProfile),
    localOnly: safeClassification.localOnly,
    sensitivity: safeClassification.severity,
    categories: Object.freeze(safeClassification.categories.map(({ id }) => id)),
    promptIncluded: routePreparation?.allowed === true,
    redacted: routePreparation?.redacted === true,
    redactionCount: Math.max(0, Math.min(10_000, Math.floor(Number(routePreparation?.redactionCount) || 0))),
    policy: ['local_unmodified', 'blocked_local_only', 'redacted_for_cloud', 'standard']
      .includes(routePreparation?.policy)
      ? routePreparation.policy
      : safeClassification.localOnly ? 'blocked_local_only' : 'standard',
    reasonCodes: Object.freeze(reasonCodes),
  });
}
