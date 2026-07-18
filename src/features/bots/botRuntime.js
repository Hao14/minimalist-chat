export const MAX_STOCK_WATCH_SYMBOLS = 12;
export const MAX_AUTOMOD_BLOCKED_WORDS = 40;
export const DEFAULT_AUTOMOD_BLOCKED_WORDS = Object.freeze(['spam', 'scam']);

const STOCK_COMMAND_PATTERN = /^\/stock(?:\s+|:)([A-Za-z][A-Za-z0-9.-]{0,15})/i;
const CASH_TAG_PATTERN = /(^|[^\w])\$([A-Za-z][A-Za-z0-9.-]{0,9})\b/g;
const LINK_PATTERN = /(https?:\/\/|www\.)\S+/i;
const FLOOD_PATTERN = /(.)\1{7,}/i;
const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function listValue(value) {
  return Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
}

export function normalizeStockSymbols(value) {
  const symbols = [];
  const seen = new Set();

  for (const rawSymbol of listValue(value)) {
    const symbol = String(rawSymbol || '')
      .replace(/^\$/, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, '')
      .slice(0, 16);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_STOCK_WATCH_SYMBOLS) break;
  }

  return symbols;
}

export function normalizeBlockedWords(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,|\n]/);
  const words = [];
  const seen = new Set();

  for (const rawWord of source) {
    const word = String(rawWord || '').trim().toLowerCase().slice(0, 80);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length >= MAX_AUTOMOD_BLOCKED_WORDS) break;
  }

  return words;
}

export function normalizeStockTrackerConfig(value = {}) {
  const config = objectValue(value);
  return {
    enabled: config.enabled === true,
    symbols: normalizeStockSymbols(config.symbols),
  };
}

export function normalizeAutoModerationConfig(value = {}) {
  const config = objectValue(value);
  const blockedWords = normalizeBlockedWords(config.blockedWords);
  return {
    enabled: config.enabled === true,
    blockLinks: config.blockLinks === true,
    blockCaps: config.blockCaps !== false,
    blockFlood: config.blockFlood !== false,
    blockedWords: blockedWords.length ? blockedWords : [...DEFAULT_AUTOMOD_BLOCKED_WORDS],
  };
}

export function normalizeRoomBotConfig(value = {}) {
  const bots = objectValue(value);
  return {
    stockTracker: normalizeStockTrackerConfig(bots.stockTracker),
    autoModeration: normalizeAutoModerationConfig(bots.autoModeration),
  };
}

export function detectAutoModeration(text, configValue = {}) {
  const config = normalizeAutoModerationConfig(configValue);
  const clean = String(text || '').trim();
  if (!config.enabled || !clean) return null;

  const matchedWord = config.blockedWords.find((word) => {
    const escaped = word.replace(REGEXP_ESCAPE_PATTERN, '\\$&');
    return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(clean);
  });
  if (matchedWord) return `blocked keyword “${matchedWord}”`;

  if (config.blockLinks && LINK_PATTERN.test(clean)) return 'links are restricted in this room';
  if (config.blockFlood && FLOOD_PATTERN.test(clean.replace(/\s+/g, ''))) return 'repeated-character flood detected';

  const letters = clean.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '');
  if (config.blockCaps && letters.length >= 18 && upper.length / letters.length > 0.82) {
    return 'excessive caps detected';
  }

  return null;
}

export function extractStockSymbols(text, configValue = {}, { commandOnly = false } = {}) {
  const clean = String(text || '').trim();
  const symbols = new Set();
  const commandMatch = clean.match(STOCK_COMMAND_PATTERN);
  if (commandMatch) symbols.add(commandMatch[1].toUpperCase());

  if (!commandOnly) {
    for (const match of clean.matchAll(CASH_TAG_PATTERN)) symbols.add(match[2].toUpperCase());

    for (const symbol of normalizeStockTrackerConfig(configValue).symbols) {
      const escaped = symbol.replace(REGEXP_ESCAPE_PATTERN, '\\$&');
      if (new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(clean)) {
        symbols.add(symbol);
      }
    }
  }

  return [...symbols].slice(0, 3);
}
