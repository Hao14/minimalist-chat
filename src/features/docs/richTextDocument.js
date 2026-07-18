export const RICH_TEXT_MARKER = '<!--minimalist-richtext-v1-->';

export const FONT_OPTIONS = [
  'Inter',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Trebuchet MS',
  'Verdana',
];

const ALLOWED_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'COL', 'COLGROUP', 'DEL', 'DIV', 'EM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'IMG', 'INPUT', 'LI', 'OL',
  'P', 'PRE', 'S', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY',
  'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);

const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'META', 'LINK']);
const ALLOWED_CLASSES = new Set(['docs-check-item', 'docs-inline-comment']);
const FONT_SIZE_MAP = { 1: '8pt', 2: '10pt', 3: '11pt', 4: '14pt', 5: '18pt', 6: '24pt', 7: '36pt' };

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value, { image = false } = {}) {
  try {
    const parsed = new URL(String(value || '').trim(), window.location.origin);
    if (image && !['http:', 'https:'].includes(parsed.protocol)) return '';
    if (!image && !['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function normalizeFontElement(font) {
  const span = document.createElement('span');
  const face = font.getAttribute('face');
  const color = font.getAttribute('color');
  const size = font.getAttribute('size');
  if (face) span.style.fontFamily = face;
  if (color) span.style.color = color;
  if (size && FONT_SIZE_MAP[size]) span.style.fontSize = FONT_SIZE_MAP[size];
  span.append(...font.childNodes);
  font.replaceWith(span);
}

function sanitizeCssValue(property, value) {
  const clean = String(value || '').trim();
  if (!clean || /url\s*\(|expression\s*\(|javascript:/i.test(clean)) return '';

  if (property === 'font-family') {
    const firstFamily = clean.replace(/["']/g, '').split(',')[0].trim().toLowerCase();
    return FONT_OPTIONS.find((font) => font.toLowerCase() === firstFamily) || '';
  }
  if (property === 'font-size') {
    const match = clean.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i);
    if (!match) return '';
    const number = Number(match[1]);
    const unit = match[2].toLowerCase();
    const valid = unit === '%' ? number >= 50 && number <= 300
      : ['em', 'rem'].includes(unit) ? number >= 0.5 && number <= 4
        : number >= 8 && number <= 72;
    return valid ? `${number}${unit}` : '';
  }
  if (property === 'color' || property === 'background-color') {
    return globalThis.CSS?.supports?.('color', clean) ? clean : '';
  }
  if (property === 'text-align') return ['left', 'center', 'right', 'justify'].includes(clean) ? clean : '';
  if (property === 'line-height') {
    const number = Number.parseFloat(clean);
    return Number.isFinite(number) && number >= 0.8 && number <= 4 ? clean : '';
  }
  if (property === 'margin-left') {
    const match = clean.match(/^(\d+(?:\.\d+)?)(px|em|rem)$/i);
    return match && Number(match[1]) <= 240 ? clean : '';
  }
  if (property === 'direction') return ['ltr', 'rtl'].includes(clean) ? clean : '';
  if (property === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(clean) ? clean : '';
  if (property === 'font-style') return ['normal', 'italic'].includes(clean) ? clean : '';
  if (property === 'vertical-align') return ['baseline', 'sub', 'super'].includes(clean) ? clean : '';
  if (property === 'text-decoration-line') {
    const values = [...new Set(clean.toLowerCase().split(/\s+/).filter(Boolean))];
    return values.length && values.every((value) => ['none', 'underline', 'line-through'].includes(value))
      ? values.join(' ')
      : '';
  }
  return '';
}

function sanitizeElementAttributes(element) {
  const sourceStyle = element.getAttribute('style') || '';
  const allowedStyle = [];
  if (sourceStyle) {
    const scratch = document.createElement('span');
    scratch.setAttribute('style', sourceStyle);
    ['font-family', 'font-size', 'color', 'background-color', 'text-align', 'line-height', 'margin-left', 'direction', 'font-weight', 'font-style', 'vertical-align', 'text-decoration-line']
      .forEach((property) => {
        const value = sanitizeCssValue(property, scratch.style.getPropertyValue(property));
        if (value) allowedStyle.push(`${property}: ${value}`);
      });
  }

  const classNames = [...element.classList].filter((name) => ALLOWED_CLASSES.has(name));
  const href = element.tagName === 'A' ? safeUrl(element.getAttribute('href')) : '';
  const src = element.tagName === 'IMG' ? safeUrl(element.getAttribute('src'), { image: true }) : '';
  const alt = String(element.getAttribute('alt') || '').slice(0, 240);
  const title = String(element.getAttribute('title') || '').slice(0, 300);
  const comment = String(element.getAttribute('data-comment') || '').slice(0, 500);
  const checked = element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox' && (element.checked || element.hasAttribute('checked'));
  const colSpan = Number.parseInt(element.getAttribute('colspan') || '', 10);
  const rowSpan = Number.parseInt(element.getAttribute('rowspan') || '', 10);

  [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
  if (allowedStyle.length) element.setAttribute('style', allowedStyle.join('; '));
  if (classNames.length) element.className = classNames.join(' ');

  if (element.tagName === 'A' && href) {
    element.setAttribute('href', href);
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
    if (title) element.setAttribute('title', title);
  }
  if (element.tagName === 'IMG' && src) {
    element.setAttribute('src', src);
    element.setAttribute('alt', alt);
    element.setAttribute('loading', 'lazy');
    element.setAttribute('referrerpolicy', 'no-referrer');
    if (title) element.setAttribute('title', title);
  }
  if (element.tagName === 'INPUT') {
    element.setAttribute('type', 'checkbox');
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-label', 'Checklist item');
    if (checked) element.setAttribute('checked', '');
  }
  if (Number.isInteger(colSpan) && colSpan > 1 && colSpan <= 12) element.setAttribute('colspan', String(colSpan));
  if (Number.isInteger(rowSpan) && rowSpan > 1 && rowSpan <= 100) element.setAttribute('rowspan', String(rowSpan));
  if (comment && element.classList.contains('docs-inline-comment')) {
    element.setAttribute('data-comment', comment);
    element.setAttribute('title', `Comment: ${comment}`);
  }
}

export function sanitizeEditorHtml(rawHtml = '') {
  if (typeof document === 'undefined') return escapeHtml(rawHtml);
  const template = document.createElement('template');
  template.innerHTML = String(rawHtml || '');

  template.content.querySelectorAll('font').forEach(normalizeFontElement);
  [...template.content.querySelectorAll('*')].reverse().forEach((element) => {
    if (DROP_WITH_CONTENT.has(element.tagName)) {
      element.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (element.tagName === 'IMG' && !safeUrl(element.getAttribute('src'), { image: true })) {
      element.remove();
      return;
    }
    if (element.tagName === 'A' && !safeUrl(element.getAttribute('href'))) {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (element.tagName === 'INPUT' && element.getAttribute('type') !== 'checkbox') {
      element.remove();
      return;
    }
    sanitizeElementAttributes(element);
  });

  return template.innerHTML;
}

function inlineMarkdownToHtml(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

export function legacyTextToHtml(content = '') {
  const normalizedContent = String(content || '').replace(/\r\n/g, '\n');
  if (!normalizedContent.trim()) return '';
  const lines = normalizedContent.split('\n');
  const output = [];
  let listOpen = false;
  const closeList = () => {
    if (!listOpen) return;
    output.push('</ul>');
    listOpen = false;
  };

  lines.forEach((line) => {
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      return;
    }

    closeList();
    if (/^\s*---\s*$/.test(line)) output.push('<hr>');
    else if (/^###\s+/.test(line)) output.push(`<h3>${inlineMarkdownToHtml(line.replace(/^###\s+/, ''))}</h3>`);
    else if (/^##\s+/.test(line)) output.push(`<h2>${inlineMarkdownToHtml(line.replace(/^##\s+/, ''))}</h2>`);
    else if (/^#\s+/.test(line)) output.push(`<h1>${inlineMarkdownToHtml(line.replace(/^#\s+/, ''))}</h1>`);
    else if (/^>\s+/.test(line)) output.push(`<blockquote>${inlineMarkdownToHtml(line.replace(/^>\s+/, ''))}</blockquote>`);
    else if (!line.trim()) output.push('<p><br></p>');
    else output.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  });
  closeList();
  return sanitizeEditorHtml(output.join(''));
}

export function isRichTextContent(content = '') {
  return String(content || '').startsWith(RICH_TEXT_MARKER);
}

export function contentToEditorHtml(content = '') {
  const value = String(content || '');
  return isRichTextContent(value)
    ? sanitizeEditorHtml(value.slice(RICH_TEXT_MARKER.length))
    : legacyTextToHtml(value);
}

export function editorHtmlToContent(html = '') {
  return `${RICH_TEXT_MARKER}${sanitizeEditorHtml(html)}`;
}

export function contentToPlainText(content = '') {
  const value = String(content || '');
  if (!isRichTextContent(value)) return value.replace(/\s+/g, ' ').trim();
  if (typeof document === 'undefined') return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const template = document.createElement('template');
  template.innerHTML = sanitizeEditorHtml(value.slice(RICH_TEXT_MARKER.length));
  template.content.querySelectorAll('br, p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr').forEach((node) => node.append(' '));
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function nodeToMarkdown(node, depth = 0) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node;
  const children = () => [...element.childNodes].map((child) => nodeToMarkdown(child, depth + 1)).join('');
  const tag = element.tagName;
  if (tag === 'BR') return '\n';
  if (tag === 'STRONG') return `**${children()}**`;
  if (tag === 'EM') return `_${children()}_`;
  if (['S', 'STRIKE', 'DEL'].includes(tag)) return `~~${children()}~~`;
  if (tag === 'CODE' && element.parentElement?.tagName !== 'PRE') return `\`${children()}\``;
  if (tag === 'PRE') return `\n\`\`\`\n${element.textContent || ''}\n\`\`\`\n`;
  if (tag === 'A') return `[${children()}](${element.getAttribute('href') || ''})`;
  if (tag === 'IMG') return `![${element.getAttribute('alt') || ''}](${element.getAttribute('src') || ''})`;
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`;
  if (tag === 'BLOCKQUOTE') return `${children().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  if (tag === 'HR') return '\n---\n';
  if (tag === 'LI') return `${element.parentElement?.tagName === 'OL' ? '1.' : '-'} ${children().trim()}\n`;
  if (tag === 'INPUT' && element.getAttribute('type') === 'checkbox') return element.hasAttribute('checked') ? '[x] ' : '[ ] ';
  if (tag === 'DIV' && element.classList.contains('docs-check-item')) {
    const checkbox = element.querySelector(':scope > input[type="checkbox"]');
    const label = [...element.childNodes]
      .filter((child) => child !== checkbox)
      .map((child) => nodeToMarkdown(child, depth + 1))
      .join('')
      .trim();
    return `- [${checkbox?.hasAttribute('checked') ? 'x' : ' '}] ${label}\n`;
  }
  if (['P', 'DIV'].includes(tag)) return `${children().trimEnd()}\n\n`;
  if (tag === 'TR') return `| ${[...element.children].map((cell) => (cell.textContent || '').trim()).join(' | ')} |\n`;
  if (tag === 'TABLE') {
    const rows = [...element.rows];
    if (!rows.length) return '';
    const columnCount = Math.max(...rows.map((row) => row.cells.length), 1);
    const rowMarkdown = rows.map((row) => {
      const cells = Array.from({ length: columnCount }, (_, index) => row.cells[index]);
      return `| ${cells.map((cell) => String(cell?.textContent || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')).join(' | ')} |`;
    });
    rowMarkdown.splice(1, 0, `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`);
    return `\n${rowMarkdown.join('\n')}\n\n`;
  }
  return children();
}

export function contentToMarkdown(content = '') {
  const value = String(content || '');
  if (!isRichTextContent(value) || typeof document === 'undefined') return value;
  const template = document.createElement('template');
  template.innerHTML = sanitizeEditorHtml(value.slice(RICH_TEXT_MARKER.length));
  return [...template.content.childNodes]
    .map((node) => nodeToMarkdown(node))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
