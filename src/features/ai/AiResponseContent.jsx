import { createElement, memo, useMemo } from 'react';
import { renderMessageText } from '../../lib/text.js';
import { extractAiResponseLinks, parseAiResponseMarkdown } from './aiResponseFormatting.js';

const INLINE_TAGS = new Set(['a', 'br', 'code', 'del', 'em', 'pre', 'span', 'strong']);

function safeElementProps(element, key) {
  const tagName = element.tagName.toLowerCase();
  const props = { key };

  if (tagName === 'a') {
    const href = element.getAttribute('href') || '#';
    props.href = /^https?:\/\//i.test(href) ? href : '#';
    props.target = '_blank';
    props.rel = 'noopener noreferrer';
  }

  const className = (element.getAttribute('class') || '')
    .split(/\s+/)
    .filter((name) => /^(msg-|tok-|language-)/.test(name))
    .join(' ');
  if (className) props.className = className;

  if ((tagName === 'pre' || tagName === 'code') && element.hasAttribute('data-lang')) {
    props['data-lang'] = element.getAttribute('data-lang') || '';
  }

  return props;
}

function renderSafeNode(node, key) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;

  const tagName = node.tagName.toLowerCase();
  if (!INLINE_TAGS.has(tagName)) return node.textContent;
  const props = safeElementProps(node, key);
  if (tagName === 'br') return createElement('br', props);

  return createElement(
    tagName,
    props,
    Array.from(node.childNodes).map((child, childIndex) => renderSafeNode(child, `${key}-${childIndex}`)),
  );
}

const InlineMarkdown = memo(function InlineMarkdown({ text }) {
  const nodes = useMemo(() => {
    const html = renderMessageText(text || '');
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    return Array.from(parsed.body.firstChild?.childNodes || []).map((node, index) => renderSafeNode(node, index));
  }, [text]);

  return nodes;
});

function ResponseBlock({ block, index }) {
  if (block.type === 'heading') {
    return createElement(`h${block.level}`, { key: index }, <InlineMarkdown text={block.content} />);
  }
  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const List = block.type === 'ordered-list' ? 'ol' : 'ul';
    return (
      <List key={index}>
        {block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}><InlineMarkdown text={item} /></li>)}
      </List>
    );
  }
  if (block.type === 'quote') return <blockquote key={index}><InlineMarkdown text={block.content} /></blockquote>;
  if (block.type === 'rule') return <hr key={index} />;
  if (block.type === 'code') {
    const fence = `\`\`\`${block.language}\n${block.content}\n\`\`\``;
    return <InlineMarkdown key={index} text={fence} />;
  }
  return <p key={index}><InlineMarkdown text={block.content} /></p>;
}

export const AiResponseContent = memo(function AiResponseContent({ text, compact = false }) {
  const blocks = useMemo(() => parseAiResponseMarkdown(text), [text]);
  const links = useMemo(() => extractAiResponseLinks(text), [text]);

  return (
    <div className={`ai-response-content${compact ? ' ai-response-content-compact' : ''}`}>
      <div className="ai-response-body">
        {blocks.map((block, index) => <ResponseBlock key={`${block.type}-${index}`} block={block} index={index} />)}
      </div>
      {links.length ? (
        <div className="ai-response-embeds" aria-label="Links in this response">
          {links.map((link) => (
            <a key={link.href} className="ai-response-embed" href={link.href} target="_blank" rel="noopener noreferrer">
              <span className="ai-response-embed-icon" aria-hidden="true"><i className="ph-bold ph-link" /></span>
              <span className="ai-response-embed-copy">
                <strong>{link.label}</strong>
                <small>{link.host}{link.path}</small>
              </span>
              <i className="ph-bold ph-arrow-up-right" aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
});
