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
const HIGHLIGHT_OPEN = '';
const HIGHLIGHT_CLOSE = '';

const CODE_LANGUAGE_ALIASES = {
    html: 'html',
    htm: 'html',
    xml: 'html',
    svg: 'html',
    css: 'css',
    scss: 'css',
    sass: 'css',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    javascript: 'javascript',
    ts: 'javascript',
    tsx: 'javascript',
    typescript: 'javascript',
    json: 'json',
    py: 'python',
    python: 'python',
};

const normalizeCodeLanguage = (language = '') =>
    CODE_LANGUAGE_ALIASES[String(language).trim().toLowerCase()] || '';

const inferCodeLanguage = (escapedCode = '') => {
    const code = String(escapedCode);
    if (/&lt;[a-z!/][\s\S]*?&gt;/i.test(code)) return 'html';
    if (/^[\s{[\],:&quot;&#39;.\-\dA-Za-z]+$/m.test(code) && /&quot;[^&]+&quot;\s*:/.test(code)) return 'json';
    if (/[.#]?[-_a-zA-Z0-9]+\s*\{[\s\S]*?:[\s\S]*?\}/.test(code)) return 'css';
    if (/\b(import|export|const|let|var|function|return|async|await|console|document|window)\b|=&gt;/.test(code)) return 'javascript';
    if (/\b(def|class|import|from|print|return|async|await|None|True|False)\b/.test(code)) return 'python';
    return 'text';
};

const makeCodeMarker = () => {
    const tokens = [];
    return {
        mark(className, value) {
            const safeClass = String(className || 'plain').replace(/[^a-z0-9_-]/gi, '');
            const index = tokens.push(`<span class="tok-${safeClass}">${value}</span>`) - 1;
            return `${HIGHLIGHT_OPEN}${String.fromCharCode(0xe100 + index)}${HIGHLIGHT_CLOSE}`;
        },
        restore(value) {
            return String(value).replace(new RegExp(`${HIGHLIGHT_OPEN}([\\uE100-\\uF8FF])${HIGHLIGHT_CLOSE}`, 'g'), (_, marker) => {
                const index = marker.charCodeAt(0) - 0xe100;
                return tokens[index] || '';
            });
        },
    };
};

const highlightHtmlCode = (escapedCode) => {
    const marker = makeCodeMarker();
    let code = String(escapedCode)
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, (match) => marker.mark('comment', match))
        .replace(/(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g, (match) => marker.mark('string', match));

    code = code
        .replace(/(&lt;\/?)([A-Za-z][\w:.-]*)/g, (_, open, tag) => `${marker.mark('punctuation', open)}${marker.mark('tag', tag)}`)
        .replace(/(\s)([A-Za-z_:][\w:.-]*)(=)/g, (_, space, attr, equals) => `${space}${marker.mark('attr', attr)}${marker.mark('punctuation', equals)}`)
        .replace(/(\/?&gt;)/g, (match) => marker.mark('punctuation', match));

    return marker.restore(code);
};

const highlightCssCode = (escapedCode) => {
    const marker = makeCodeMarker();
    let code = String(escapedCode)
        .replace(/(\/\*[\s\S]*?\*\/)/g, (match) => marker.mark('comment', match))
        .replace(/(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g, (match) => marker.mark('string', match));

    code = code
        .replace(/^([^{}\n]+)(?=\s*\{)/gm, (match) => marker.mark('selector', match))
        .replace(/([A-Za-z-]+)(\s*:)/g, (_, property, colon) => `${marker.mark('property', property)}${marker.mark('punctuation', colon)}`)
        .replace(/(-?\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b)/g, (match) => marker.mark('number', match))
        .replace(/(#(?:[0-9a-f]{3,8})\b)/gi, (match) => marker.mark('number', match));

    return marker.restore(code);
};

const highlightJavascriptCode = (escapedCode) => {
    const marker = makeCodeMarker();
    let code = String(escapedCode)
        .replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (match) => marker.mark('comment', match))
        .replace(/(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|`[\s\S]*?`)/g, (match) => marker.mark('string', match));

    code = code
        .replace(/\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|let|new|of|return|super|switch|throw|try|typeof|var|void|while|yield|true|false|null|undefined)\b/g, (match) => marker.mark('keyword', match))
        .replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, (match) => marker.mark('function', match))
        .replace(/(-?\b\d+(?:\.\d+)?\b)/g, (match) => marker.mark('number', match))
        .replace(/([{}()[\].,;:+\-*/%=<>!&|?]+)/g, (match) => marker.mark('punctuation', match));

    return marker.restore(code);
};

const highlightJsonCode = (escapedCode) => {
    const marker = makeCodeMarker();
    let code = String(escapedCode)
        .replace(/(&quot;[\s\S]*?&quot;)(\s*:)?/g, (_, keyOrString, colon = '') => {
            const className = colon ? 'property' : 'string';
            return `${marker.mark(className, keyOrString)}${colon ? marker.mark('punctuation', colon) : ''}`;
        })
        .replace(/\b(true|false|null)\b/g, (match) => marker.mark('keyword', match))
        .replace(/(-?\b\d+(?:\.\d+)?\b)/g, (match) => marker.mark('number', match))
        .replace(/([{}[\],])/g, (match) => marker.mark('punctuation', match));
    return marker.restore(code);
};

const highlightPythonCode = (escapedCode) => {
    const marker = makeCodeMarker();
    let code = String(escapedCode)
        .replace(/(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g, (match) => marker.mark('string', match))
        .replace(/(#[^\n]*)/g, (match) => marker.mark('comment', match));

    code = code
        .replace(/\b(async|await|break|class|continue|def|elif|else|except|False|finally|for|from|if|import|in|is|lambda|None|not|or|pass|raise|return|True|try|while|with|yield)\b/g, (match) => marker.mark('keyword', match))
        .replace(/\b([A-Za-z_]\w*)(?=\s*\()/g, (match) => marker.mark('function', match))
        .replace(/(-?\b\d+(?:\.\d+)?\b)/g, (match) => marker.mark('number', match))
        .replace(/([{}()[\].,;:+\-*/%=<>!&|]+)/g, (match) => marker.mark('punctuation', match));

    return marker.restore(code);
};

const highlightCode = (escapedCode, language = '') => {
    const normalized = normalizeCodeLanguage(language) || inferCodeLanguage(escapedCode);
    if (normalized === 'html') return highlightHtmlCode(escapedCode);
    if (normalized === 'css') return highlightCssCode(escapedCode);
    if (normalized === 'javascript') return highlightJavascriptCode(escapedCode);
    if (normalized === 'json') return highlightJsonCode(escapedCode);
    if (normalized === 'python') return highlightPythonCode(escapedCode);
    return String(escapedCode);
};

export const renderMessageText = (raw) => {
    if (!raw) return '';
    const stash = [];
    const keep = (html) => `${STASH_OPEN}${stash.push(html) - 1}${STASH_CLOSE}`;

    let s = String(raw);

    // Pull code out before escaping the surrounding message. This keeps code
    // literal while avoiding entity text like &#39; being parsed as syntax.
    s = s.replace(/```([\s\S]*?)```/g, (_, block) => {
        let code = block.replace(/^\n/, '').replace(/\n$/, '');
        let language = '';
        const languageLine = code.match(/^([A-Za-z0-9_+#.-]{1,24})\n([\s\S]*)$/);
        if (languageLine && normalizeCodeLanguage(languageLine[1])) {
            language = normalizeCodeLanguage(languageLine[1]);
            code = languageLine[2];
        } else {
            language = inferCodeLanguage(escapeHtml(code));
        }
        const escapedCode = escapeHtml(code);
        return keep(`<pre class="msg-codeblock language-${language}" data-lang="${language === 'text' ? 'code' : language}"><code>${highlightCode(escapedCode, language)}</code></pre>`);
    });
    s = s.replace(/`([^`\n]+?)`/g, (_, code) => {
        const escapedCode = escapeHtml(code);
        const language = inferCodeLanguage(escapedCode);
        return keep(`<code class="msg-inline-code language-${language}" data-lang="${language === 'text' ? 'code' : language}">${highlightCode(escapedCode, language)}</code>`);
    });

    s = escapeHtml(s);

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

    // @mentions — highlight @handles (requires a non-word char before @ so emails aren't matched)
    s = s.replace(/(^|[^\w@])@([A-Za-z0-9_-]{2,32})/g, '$1<span class="msg-mention">@$2</span>');

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
