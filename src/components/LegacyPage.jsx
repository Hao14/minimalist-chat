import { useLayoutEffect, useMemo } from 'react';

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
    html: documentNode.body.innerHTML,
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

  return <div className="react-page" dangerouslySetInnerHTML={{ __html: page.html }} />;
}
