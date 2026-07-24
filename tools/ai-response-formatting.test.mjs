import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AI_RESPONSE_EMBED_LIMIT,
  extractAiResponseLinks,
  parseAiResponseMarkdown,
} from '../src/features/ai/aiResponseFormatting.js';
import { renderMessageText } from '../src/lib/text.js';

test('promotes common AI markdown into semantic response blocks', () => {
  const blocks = parseAiResponseMarkdown(`**Summary**
The room has **two** updates.

**Next Steps**
- Review the draft
- Send the reply

1. Open settings
2. Confirm access`);

  assert.deepEqual(blocks, [
    { type: 'heading', level: 3, content: 'Summary' },
    { type: 'paragraph', content: 'The room has **two** updates.' },
    { type: 'heading', level: 3, content: 'Next Steps' },
    { type: 'unordered-list', items: ['Review the draft', 'Send the reply'] },
    { type: 'ordered-list', items: ['Open settings', 'Confirm access'] },
  ]);
});

test('keeps quotes, rules, and fenced code as distinct blocks', () => {
  const blocks = parseAiResponseMarkdown(`## Details
> A quoted note
> continues here

---

\`\`\`js
const answer = 42;
\`\`\``);

  assert.deepEqual(blocks, [
    { type: 'heading', level: 3, content: 'Details' },
    { type: 'quote', content: 'A quoted note\ncontinues here' },
    { type: 'rule' },
    { type: 'code', language: 'js', content: 'const answer = 42;' },
  ]);
});

test('extracts only bounded, unique, credential-free http links', () => {
  const links = extractAiResponseLinks(`
[Project docs](https://example.com/docs).
Duplicate: https://example.com/docs
Unsafe: javascript:alert(1)
Credentials: https://user:secret@example.net/private
Second: http://example.org/path?q=private
Third: https://third.example/resource
Fourth: https://fourth.example/ignored
`);

  assert.equal(links.length, AI_RESPONSE_EMBED_LIMIT);
  assert.deepEqual(links.map(({ href, label, host, path }) => ({ href, label, host, path })), [
    { href: 'https://example.com/docs', label: 'Project docs', host: 'example.com', path: '/docs' },
    { href: 'http://example.org/path?q=private', label: 'example.org', host: 'example.org', path: '/path' },
    { href: 'https://third.example/resource', label: 'third.example', host: 'third.example', path: '/resource' },
  ]);
});

test('inline renderer escapes raw HTML and never links javascript URLs', () => {
  const html = renderMessageText('<script>alert(1)</script> [bad](javascript:alert(1)) **safe**');

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>safe<\/strong>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<script>/i);
});

test('both AI surfaces use the shared rich response component', async () => {
  const source = await readFile(new URL('../src/features/ai/AI.jsx', import.meta.url), 'utf8');

  assert.match(source, /<AiResponseContent text=\{message\.content\} \/>/);
  assert.match(source, /<AiResponseContent text=\{message\.content\} compact \/>/);
});
