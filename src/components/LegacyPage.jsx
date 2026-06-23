import { createElement, useLayoutEffect, useMemo } from 'react';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const ATTRIBUTE_ALIASES = {
  acceptcharset: 'acceptCharset',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  class: 'className',
  colspan: 'colSpan',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  for: 'htmlFor',
  maxlength: 'maxLength',
  minlength: 'minLength',
  readonly: 'readOnly',
  rowspan: 'rowSpan',
  spellcheck: 'spellCheck',
  tabindex: 'tabIndex',
};

const BOOLEAN_ATTRIBUTES = new Set([
  'allowFullScreen',
  'async',
  'autoFocus',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'hidden',
  'loop',
  'multiple',
  'muted',
  'open',
  'readOnly',
  'required',
  'selected',
]);

function toStyleObject(styleText) {
  if (!styleText) return undefined;

  return styleText
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .reduce((style, rule) => {
      const divider = rule.indexOf(':');
      if (divider === -1) return style;

      const property = rule.slice(0, divider).trim();
      const value = rule.slice(divider + 1).trim();
      if (!property || !value) return style;

      const reactProperty = property.startsWith('--')
        ? property
        : property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      style[reactProperty] = value;
      return style;
    }, {});
}

function propsFromAttributes(element) {
  const props = {};

  Array.from(element.attributes).forEach((attr) => {
    const rawName = attr.name;
    const lowerName = rawName.toLowerCase();
    const propName = ATTRIBUTE_ALIASES[lowerName] || rawName;

    if (lowerName === 'style') {
      const style = toStyleObject(attr.value);
      if (style && Object.keys(style).length) props.style = style;
      return;
    }

    if (lowerName === 'value') {
      props.defaultValue = attr.value;
      return;
    }

    if (lowerName === 'checked') {
      props.defaultChecked = true;
      return;
    }

    props[propName] = BOOLEAN_ATTRIBUTES.has(propName) && attr.value === '' ? true : attr.value;
  });

  return props;
}

function renderDomNode(node, key) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;

  const tagName = node.tagName.toLowerCase();
  const props = { ...propsFromAttributes(node), key };

  if (tagName === 'textarea') {
    props.defaultValue = node.textContent || props.defaultValue || '';
    return createElement(tagName, props);
  }

  if (VOID_ELEMENTS.has(tagName)) {
    return createElement(tagName, props);
  }

  return createElement(
    tagName,
    props,
    Array.from(node.childNodes).map((child, childIndex) => renderDomNode(child, `${key}-${childIndex}`)),
  );
}

function readPage(source) {
  const bodyMatch = source.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttributes = bodyMatch?.[1] || '';
  const bodyHtml = bodyMatch?.[2] || source;
  const documentNode = new DOMParser().parseFromString(
    `<!doctype html><html><body${bodyAttributes}>${bodyHtml}</body></html>`,
    'text/html',
  );
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);

  documentNode.body.querySelectorAll('script').forEach((script) => script.remove());

  return {
    title: source.match(/<title>(.*?)<\/title>/i)?.[1] || 'Minimalist',
    bodyClass: documentNode.body.className,
    bodyStyle: documentNode.body.getAttribute('style') || '',
    nodes: Array.from(documentNode.body.childNodes),
    scripts,
  };
}

function appendScript({ src, code }) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');

    if (src) {
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
    } else {
      script.textContent = code;
    }

    document.body.appendChild(script);
    if (!src) resolve(script);
  });
}

export default function LegacyPage({ source, needsConfig = false, loadApp = true }) {
  const page = useMemo(() => readPage(source), [source]);

  useLayoutEffect(() => {
    const oldTitle = document.title;
    const oldClass = document.body.className;
    const oldStyle = document.body.getAttribute('style');
    const mountedScripts = [];
    let cancelled = false;

    document.title = page.title;
    document.body.className = page.bodyClass;
    if (page.bodyStyle) document.body.setAttribute('style', page.bodyStyle);
    else document.body.removeAttribute('style');

    const boot = async () => {
      for (const code of page.scripts) {
        if (cancelled) return;
        const script = await appendScript({ code });
        mountedScripts.push(script);
      }

      if (needsConfig && (!window.GCAL_CLIENT_ID || !window.STRIPE_CHECKOUT_ENDPOINT)) {
        document.querySelector('script[data-minimalist-config]')?.remove();
        await new Promise((resolve) => {
          const configScript = document.createElement('script');
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          configScript.dataset.minimalistConfig = 'true';
          configScript.async = false;
          configScript.onload = finish;
          configScript.onerror = finish;
          configScript.src = '/config.js?v=6';
          document.body.appendChild(configScript);
          mountedScripts.push(configScript);
          window.setTimeout(finish, 1500);
        });
      }

      if (!loadApp || cancelled) return;
      await import('../legacy-engine/app.js');
    };

    boot().catch((error) => {
      console.error('Minimalist failed to start:', error);
    });

    return () => {
      cancelled = true;
      mountedScripts.forEach((script) => script.remove());
      document.title = oldTitle;
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, [loadApp, needsConfig, page]);

  return (
    <div className="react-page">
      {page.nodes.map((node, index) => renderDomNode(node, index))}
    </div>
  );
}
