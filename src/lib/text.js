// Shared text helpers used across the React app and legacy adapters.

// Escape a string for safe insertion into HTML (text or double-quoted attributes).
export const escapeHtml = (s) =>
    (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

// Normalize a user-supplied URL so it always has a protocol (prevents
// "javascript:" and relative-path surprises by forcing http/https).
export const safeUrl = (u) => {
    u = (u || '').trim();
    if (!u) return '#';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
};

// Render a chat message with lightweight Markdown.
// SECURITY: the raw text is HTML-escaped FIRST, then formatting tokens are
// applied to the escaped string, so user input can never inject live markup.
// Code spans/blocks are pulled out (into private-use sentinels) before
// formatting so their contents stay literal and never collide with real text.
const STASH_OPEN = '';
const STASH_CLOSE = '';
export const renderMessageText = (raw) => {
    if (!raw) return '';
    const stash = [];
    const keep = (html) => `${STASH_OPEN}${stash.push(html) - 1}${STASH_CLOSE}`;

    let s = escapeHtml(raw);

    // Fenced code blocks ```...```
    s = s.replace(/```([\s\S]*?)```/g, (_, code) =>
        keep(`<pre class="msg-codeblock"><code>${code.replace(/^\n/, '').replace(/\n$/, '')}</code></pre>`));
    // Inline code `...`
    s = s.replace(/`([^`\n]+?)`/g, (_, code) => keep(`<code class="msg-inline-code">${code}</code>`));

    // Emphasis
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_([^_\n]+?)_(?![\w])/g, '$1<em>$2</em>');

    // Markdown links [text](url) — url already escaped, only http/https allowed
    s = s.replace(/\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bare URLs (skip ones already inside an href="...")
    s = s.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

    // @mentions — highlight @name tokens (requires a non-word char before @ so emails aren't matched)
    s = s.replace(/(^|[^\w@])@(\w{2,32})/g, '$1<span class="msg-mention">@$2</span>');

    s = s.replace(/\n/g, '<br>');
    // Restore stashed code spans/blocks
    return s.replace(new RegExp(STASH_OPEN + '(\\d+)' + STASH_CLOSE, 'g'), (_, i) => stash[i]);
};

// Parse the profile "links" textarea — one per line: "Label | https://url" (or just a URL).
export const parseProfileLinks = (text) =>
    (text || '').split('\n').map((line) => {
        line = line.trim();
        if (!line) return null;
        const [rawLabel, rawUrl] = line.includes('|') ? [line.slice(0, line.indexOf('|')), line.slice(line.indexOf('|') + 1)] : [null, line];
        const url = safeUrl((rawUrl || '').trim());
        if (url === '#') return null;
        let label = (rawLabel || '').trim();
        if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; } }
        return { label: label.slice(0, 40), url };
    }).filter(Boolean).slice(0, 8);

// Render profile links as safe, clickable chips.
export const renderProfileLinks = (links) =>
    (Array.isArray(links) ? links : []).map((l) =>
        `<a class="profile-link" href="${escapeHtml(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || l.url)}</a>`
    ).join('');

// Serialize stored links back into the textarea format for editing.
export const linksToText = (links) =>
    (Array.isArray(links) ? links : []).map((l) => `${l.label || ''} | ${l.url || ''}`).join('\n');

if (typeof window !== 'undefined') {
    window.parseProfileLinks = parseProfileLinks;
    window.renderProfileLinks = renderProfileLinks;
    window.linksToText = linksToText;
}
