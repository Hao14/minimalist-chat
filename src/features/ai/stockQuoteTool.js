const STOCK_INTENT_PATTERN = /\b(?:stock|stocks|share|shares|ticker|market)\b/i;
const QUOTE_INTENT_PATTERN = /\b(?:price|quote|worth|trading|live|latest|current|real[ -]?time|today)\b/i;
const STOCK_BOT_NAME_PATTERN = /^stock price bot$/i;
const STOCK_BOT_QUOTE_PATTERN = /^\s*([A-Z][A-Z0-9.-]{0,15})(?:\s*·|\s*\r?\n)/;
const COMPANY_ALIASES = new Map([
  ['apple', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['google', 'GOOGL'],
  ['alphabet', 'GOOGL'],
  ['amazon', 'AMZN'],
  ['nvidia', 'NVDA'],
  ['meta', 'META'],
  ['tesla', 'TSLA'],
  ['netflix', 'NFLX'],
]);
const SYMBOL_STOP_WORDS = new Set([
  'AI', 'API', 'CAN', 'CURRENT', 'GET', 'LIVE', 'MARKET', 'NOW', 'PRICE', 'QUOTE',
  'REALTIME', 'SHARE', 'STOCK', 'THE', 'TODAY', 'WHAT', 'WORTH', 'YOU',
]);

export function normalizeStockQuoteSymbol(value) {
  return String(value || '')
    .replace(/^\$/, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
    .slice(0, 16);
}

export function isStockQuoteRequest(value) {
  const prompt = String(value || '').trim();
  if (!prompt) return false;
  if (/^\/stock(?:\s|:|$)/i.test(prompt) || /\$[A-Za-z][A-Za-z0-9.-]{0,15}\b/.test(prompt)) return true;
  if (!QUOTE_INTENT_PATTERN.test(prompt)) return false;
  if (STOCK_INTENT_PATTERN.test(prompt)) return true;
  return /\b[A-Z][A-Z0-9.-]{0,5}\b/.test(prompt);
}

function directStockSymbol(prompt) {
  const command = prompt.match(/^\/stock(?:\s+|:)([A-Za-z][A-Za-z0-9.-]{0,15})/i);
  if (command) return normalizeStockQuoteSymbol(command[1]);

  const cashTag = prompt.match(/(?:^|[^\w])\$([A-Za-z][A-Za-z0-9.-]{0,15})\b/);
  if (cashTag) return normalizeStockQuoteSymbol(cashTag[1]);

  const lowerPrompt = prompt.toLowerCase();
  for (const [company, symbol] of COMPANY_ALIASES) {
    if (new RegExp(`\\b${company}\\b`, 'i').test(lowerPrompt)) return symbol;
  }

  const nearbyPatterns = [
    /\b([A-Za-z][A-Za-z0-9.-]{0,15})\s+(?:stock|shares?)\b/i,
    /\b(?:price|quote)\s+(?:of|for)\s+([A-Za-z][A-Za-z0-9.-]{0,15})\b/i,
    /\b(?:ticker|symbol)\s+(?:is\s+)?([A-Za-z][A-Za-z0-9.-]{0,15})\b/i,
  ];
  for (const pattern of nearbyPatterns) {
    const match = prompt.match(pattern);
    const symbol = normalizeStockQuoteSymbol(match?.[1]);
    if (symbol && !SYMBOL_STOP_WORDS.has(symbol)) return symbol;
  }

  const uppercaseTokens = prompt.match(/\b[A-Z][A-Z0-9.-]{0,5}\b/g) || [];
  return uppercaseTokens
    .map(normalizeStockQuoteSymbol)
    .find((symbol) => symbol && !SYMBOL_STOP_WORDS.has(symbol)) || '';
}

function latestRoomStockSymbol(context = {}) {
  const messages = Array.isArray(context.messages) ? context.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (!STOCK_BOT_NAME_PATTERN.test(String(message.name || '').trim())) continue;
    const match = String(message.text || '').match(STOCK_BOT_QUOTE_PATTERN);
    const symbol = normalizeStockQuoteSymbol(match?.[1]);
    if (symbol) return symbol;
  }
  return '';
}

export function resolveStockQuoteRequest({ context = {}, messages = [] } = {}) {
  const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role !== 'assistant' && String(message?.content || '').trim());
  const prompt = String(latestUserMessage?.content || '').trim();
  if (!isStockQuoteRequest(prompt)) return null;

  const directSymbol = directStockSymbol(prompt);
  if (directSymbol) return { symbol: directSymbol, inferredFromRoom: false };
  const roomSymbol = latestRoomStockSymbol(context);
  return { symbol: roomSymbol, inferredFromRoom: Boolean(roomSymbol) };
}

function safeInline(value, fallback, limit = 100) {
  const clean = String(value || '')
    .replace(/\b(?:javascript|data|vbscript):\S*/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\r\n*_`[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
  return clean || fallback;
}

function formatQuoteTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) return 'Time not supplied';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function quoteSourceUrl(provider, symbol) {
  if (/stooq/i.test(provider)) {
    const stooqSymbol = /[.-]/.test(symbol) ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
    return `https://stooq.com/q/?s=${encodeURIComponent(stooqSymbol)}`;
  }
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;
}

export function formatStockTickerRequiredReply() {
  return [
    '## Which ticker?',
    'Tell me the stock symbol you want, such as **AAPL**, **MSFT**, or **NVDA**.',
    'You can also enter `/stock AAPL` in chat.',
  ].join('\n\n');
}

export function formatStockQuoteUnavailableReply(symbol) {
  const safeSymbol = normalizeStockQuoteSymbol(symbol) || 'that ticker';
  return [
    '## Quote unavailable',
    `I couldn’t get the latest market quote for **${safeSymbol}**. Check the ticker and try again.`,
    '> The room’s older messages may contain cached prices, so I did not reuse them as a current quote.',
  ].join('\n\n');
}

export function formatStockQuoteReply(quote = {}, { inferredFromRoom = false } = {}) {
  const symbol = normalizeStockQuoteSymbol(quote.symbol);
  const price = Number(quote.price);
  if (!symbol || !Number.isFinite(price)) return formatStockQuoteUnavailableReply(symbol);

  const name = safeInline(quote.name, symbol);
  const provider = safeInline(quote.provider, 'Market data');
  const currency = safeInline(quote.currency, 'USD', 8).toUpperCase();
  const change = Number(quote.change);
  const changePercent = Number(quote.changePercent);
  const hasChange = Number.isFinite(change) && Number.isFinite(changePercent);
  const direction = change > 0 ? '▲' : change < 0 ? '▼' : '•';
  const changeLine = hasChange
    ? `- **Change:** ${direction} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
    : '';
  const inferredLine = inferredFromRoom
    ? `_I used ${symbol} because it was the latest successful stock quote in this room._`
    : '';

  return [
    `## ${symbol}${name !== symbol ? ` · ${name}` : ''}`,
    `**${currency} ${price.toFixed(2)}**`,
    [changeLine, `- **As of:** ${formatQuoteTime(quote.at)}`, `- **Source:** ${provider}`].filter(Boolean).join('\n'),
    inferredLine,
    '> Latest available market data can be delayed. This is not financial advice.',
    `[Open ${symbol} market details](${quoteSourceUrl(provider, symbol)})`,
  ].filter(Boolean).join('\n\n');
}
