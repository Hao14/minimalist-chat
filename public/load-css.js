(function loadMinimalistStyles() {
  var cssLinks = Array.prototype.slice.call(document.querySelectorAll('link[data-load-css]'));
  var path = window.location.pathname || '/';
  var routeName = (path.split('/').filter(Boolean)[0] || 'home').toLowerCase();
  var isAppRoute = /^\/(?:chat|join|login)(?:\/|$)/.test(path);
  var isChatRoute = /^\/(?:chat|join)(?:\/|$)/.test(path);
  var isHomeRoute = path === '/' || path === '';
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = Boolean(connection && connection.saveData);
  var effectiveType = String((connection && connection.effectiveType) || '');
  var constrainedConnection = saveData || /(?:slow-)?2g/.test(effectiveType);
  var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var compactViewport = window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
  var mobileOrTablet = coarsePointer || compactViewport;
  var loaded = {};
  document.documentElement.classList.add(isAppRoute ? 'route-app' : 'route-marketing');
  document.documentElement.classList.add('route-' + routeName);
  if (isHomeRoute) document.documentElement.classList.add('route-home');

  function getHref(link) {
    return link.href || link.getAttribute('data-href') || '';
  }

  function getLazyType(link) {
    return (link.getAttribute('data-css-lazy') || '').toLowerCase();
  }

  function isFeatureStylesheet(link) {
    return getLazyType(link) === 'feature' || /\/features\.css(?:[?#]|$)/.test(getHref(link));
  }

  function shouldLoadNow(link) {
    var scope = link.getAttribute('data-css-scope');
    var lazy = getLazyType(link);
    if (link.getAttribute('data-css-priority') === 'critical') return true;
    if (lazy) return false;
    if (scope === 'app') return isAppRoute;
    return false;
  }

  function convertPreload(preloadLink) {
    return new Promise(function resolveWhenLoaded(resolve) {
      var href = getHref(preloadLink);
      if (!href || loaded[href]) {
        resolve();
        return;
      }
      loaded[href] = true;
      if (preloadLink.href) {
        preloadLink.onload = resolve;
        preloadLink.onerror = resolve;
        preloadLink.rel = 'stylesheet';
        preloadLink.removeAttribute('as');
        return;
      }
      var stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = href;
      stylesheet.crossOrigin = preloadLink.crossOrigin || '';
      stylesheet.media = preloadLink.media || 'all';
      stylesheet.onload = resolve;
      stylesheet.onerror = resolve;
      preloadLink.parentNode.insertBefore(stylesheet, preloadLink.nextSibling);
      preloadLink.remove();
    });
  }

  var immediateLinks = cssLinks.filter(shouldLoadNow);
  var deferredLinks = cssLinks.filter(function deferred(link) {
    return immediateLinks.indexOf(link) === -1;
  });
  var featureLinks = isAppRoute
    ? deferredLinks.filter(isFeatureStylesheet)
    : [];
  var routineDeferredLinks = isAppRoute
    ? deferredLinks.filter(function notFeature(link) {
      return featureLinks.indexOf(link) === -1;
    })
    : deferredLinks;
  var ready = Promise.all(immediateLinks.map(convertPreload));
  var timeout = new Promise(function timeout(resolve) {
    window.setTimeout(resolve, 1800);
  });

  window.__minimalistCssReady = Promise.race([ready, timeout]);

  function loadBrandFonts() {
    if (loaded.__brandFonts) return;
    loaded.__brandFonts = true;
    if (constrainedConnection && isAppRoute) return;
    [
      ['preconnect', 'https://fonts.googleapis.com', ''],
      ['preconnect', 'https://fonts.gstatic.com', 'anonymous'],
    ].forEach(function addFontHint(parts) {
      var rel = parts[0];
      var href = parts[1];
      if (document.querySelector('link[rel="' + rel + '"][href="' + href + '"]')) return;
      var hint = document.createElement('link');
      hint.rel = rel;
      hint.href = href;
      if (parts[2]) hint.crossOrigin = parts[2];
      document.head.appendChild(hint);
    });
    var stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;600;700&display=swap';
    stylesheet.crossOrigin = 'anonymous';
    document.head.appendChild(stylesheet);
  }

  function loadDeferredStyles() {
    routineDeferredLinks.forEach(convertPreload);
    loadBrandFonts();
    routineDeferredLinks = [];
    removeDeferredListeners(loadDeferredStyles);
  }

  function loadFeatureStyles() {
    featureLinks.forEach(convertPreload);
    featureLinks = [];
    removeDeferredListeners(loadFeatureStyles);
  }

  function addDeferredListeners(callback) {
    window.addEventListener('scroll', callback, { once: true, passive: true });
    window.addEventListener('pointerdown', callback, { once: true, passive: true });
    window.addEventListener('keydown', callback, { once: true });
  }

  function removeDeferredListeners(callback) {
    window.removeEventListener('scroll', callback);
    window.removeEventListener('pointerdown', callback);
    window.removeEventListener('keydown', callback);
  }

  window.__minimalistLoadFeatureStyles = loadFeatureStyles;

  if (routineDeferredLinks.length) {
    if (isAppRoute) {
      var idle = window.requestIdleCallback || function requestIdleFallback(callback) {
        return window.setTimeout(callback, 1800);
      };
      idle(loadDeferredStyles, { timeout: 2200 });
    } else {
      window.setTimeout(loadDeferredStyles, 15000);
    }
    addDeferredListeners(loadDeferredStyles);
  }

  if (featureLinks.length) {
    var featureIdle = window.requestIdleCallback || function featureIdleFallback(callback) {
      return window.setTimeout(callback, 1800);
    };
    if (!mobileOrTablet && !constrainedConnection) {
      window.setTimeout(function deferFeatureStyles() {
        featureIdle(loadFeatureStyles, { timeout: 5000 });
      }, isChatRoute ? 30000 : 18000);
    }
  }
})();
