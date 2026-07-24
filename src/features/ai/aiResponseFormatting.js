export const AI_RESPONSE_EMBED_LIMIT = 3;

const FENCE_PATTERN = /^\s{0,3}```([A-Za-z0-9_+#.-]{0,24})\s*$/;
const HEADING_PATTERN = /^\s{0,3}(#{1,4})\s+(.+?)\s*$/;
const BOLD_HEADING_PATTERN = /^\s*(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/;
const UNORDERED_ITEM_PATTERN = /^\s{0,3}[-*+]\s+(.+?)\s*$/;
const ORDERED_ITEM_PATTERN = /^\s{0,3}\d+[.)]\s+(.+?)\s*$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*?)\s*$/;
const RULE_PATTERN = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function boldHeadingText(line) {
  const match = line.match(BOLD_HEADING_PATTERN);
  return (match?.[1] || match?.[2] || '').trim();
}

function isBlockStart(line) {
  return FENCE_PATTERN.test(line)
    || HEADING_PATTERN.test(line)
    || Boolean(boldHeadingText(line))
    || UNORDERED_ITEM_PATTERN.test(line)
    || ORDERED_ITEM_PATTERN.test(line)
    || QUOTE_PATTERN.test(line)
    || RULE_PATTERN.test(line);
}

function consumeList(lines, start, pattern, type) {
  const items = [];
  let index = start;

  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) break;

    let content = match[1].trim();
    index += 1;
    while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !isBlockStart(lines[index])) {
      content += ` ${lines[index].trim()}`;
      index += 1;
    }
    items.push(content);
  }

  return { block: { type, items }, nextIndex: index };
}

export function parseAiResponseMarkdown(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const language = fence[1] || '';
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, content: code.join('\n') });
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(4, Number(heading[1].length) + 1),
        content: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    const boldHeading = boldHeadingText(line);
    if (boldHeading) {
      blocks.push({ type: 'heading', level: 3, content: boldHeading });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (UNORDERED_ITEM_PATTERN.test(line)) {
      const result = consumeList(lines, index, UNORDERED_ITEM_PATTERN, 'unordered-list');
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (ORDERED_ITEM_PATTERN.test(line)) {
      const result = consumeList(lines, index, ORDERED_ITEM_PATTERN, 'ordered-list');
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quote = [];
      while (index < lines.length) {
        const match = lines[index].match(QUOTE_PATTERN);
        if (!match) break;
        quote.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', content: quote.join('\n') });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: paragraph.join(' ') });
  }

  return blocks;
}

function trimUrl(value) {
  let url = String(value || '').trim().replace(/[.,!?;:'"\]}]+$/g, '');
  while (url.endsWith(')')) {
    const openCount = (url.match(/\(/g) || []).length;
    const closeCount = (url.match(/\)/g) || []).length;
    if (closeCount <= openCount) break;
    url = url.slice(0, -1);
  }
  return url;
}

function cleanLinkLabel(value) {
  return String(value || '')
    .replace(/[*_~`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function toLinkPreview(rawUrl, label = '') {
  const href = trimUrl(rawUrl);
  try {
    const parsed = new URL(href);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : decodeURIComponent(parsed.pathname).slice(0, 72);
    return {
      href: parsed.href,
      label: cleanLinkLabel(label) || host,
      host,
      path,
    };
  } catch {
    return null;
  }
}

export function extractAiResponseLinks(raw, limit = AI_RESPONSE_EMBED_LIMIT) {
  const text = String(raw || '');
  const boundedLimit = Math.max(0, Math.min(AI_RESPONSE_EMBED_LIMIT, Number(limit) || 0));
  const links = [];
  const seen = new Set();

  const add = (rawUrl, label) => {
    if (links.length >= boundedLimit) return;
    const link = toLinkPreview(rawUrl, label);
    if (!link || seen.has(link.href)) return;
    seen.add(link.href);
    links.push(link);
  };

  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) add(match[2], match[1]);
  for (const match of text.matchAll(BARE_URL_PATTERN)) add(match[0], '');

  return links;
}
