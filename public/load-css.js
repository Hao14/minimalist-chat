(function loadMinimalistStyles() {
  try {
    document.documentElement.classList.toggle(
      'auth-session-hint',
      window.localStorage && window.localStorage.getItem('minimalist.auth.present.v1') === '1'
    );
  } catch {
    // The hint only prevents signed-in navigation flicker; Firebase remains authoritative.
  }
  var cssLinks = Array.prototype.slice.call(document.querySelectorAll('link[data-load-css]'));
  var path = window.location.pathname || '/';
  var routeName = (path.split('/').filter(Boolean)[0] || 'home').toLowerCase();
  var isAppRoute = /^\/(?:chat|join|login)(?:\/|$)/.test(path);
  var isVaultShareRoute = /^\/vault\/share(?:\/|$)/.test(path);
  var isChatRoute = /^\/(?:chat|join)(?:\/|$)/.test(path);
  var hasAuthPresenceHint = document.documentElement.classList.contains('auth-session-hint');
  var isAuthenticatedChatRoute = isChatRoute && hasAuthPresenceHint;
  var isHomeRoute = path === '/' || path === '';
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = Boolean(connection && connection.saveData);
  var effectiveType = String((connection && connection.effectiveType) || '');
  var constrainedConnection = saveData || /(?:slow-)?2g/.test(effectiveType);
  var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var compactViewport = window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
  var mobileOrTablet = coarsePointer || compactViewport;
  var mobileStylesQuery = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
  var mobileStylesViewport = Boolean(mobileStylesQuery && mobileStylesQuery.matches);
  var loaded = {};
  var savedTheme = 'light';
  var deferredCssReadyResolve = null;
  var featureCssReadyResolve = null;
  var featureCssReadySettled = false;
  try {
    savedTheme = String(localStorage.getItem('theme') || 'light').toLowerCase();
  } catch {
    savedTheme = 'light';
  }
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

  function isResponsiveStylesheet(link) {
    return /\/(?:desktop|mobile)\.css(?:[?#]|$)/.test(getHref(link));
  }

  function responsiveMedia(link) {
    var href = getHref(link);
    if (/\/mobile\.css(?:[?#]|$)/.test(href)) return '(max-width: 768px)';
    if (/\/desktop\.css(?:[?#]|$)/.test(href)) return '(min-width: 769px)';
    return link.media || 'all';
  }

  function isSavedThemeStylesheet(link) {
    return getLazyType(link) === 'theme' && getHref(link).indexOf('/themes/' + savedTheme + '.css') !== -1;
  }

  function shouldLoadNow(link) {
    var scope = link.getAttribute('data-css-scope');
    var lazy = getLazyType(link);
    if (link.getAttribute('data-css-priority') === 'critical') return true;
    if (isVaultShareRoute && isFeatureStylesheet(link)) return true;
    if (isResponsiveStylesheet(link)) {
      if (!isAppRoute) return false;
      return mobileStylesViewport
        ? /\/mobile\.css(?:[?#]|$)/.test(getHref(link))
        : /\/desktop\.css(?:[?#]|$)/.test(getHref(link));
    }
    if (isSavedThemeStylesheet(link)) return isAppRoute;
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
        preloadLink.media = responsiveMedia(preloadLink);
        preloadLink.rel = 'stylesheet';
        preloadLink.removeAttribute('as');
        return;
      }
      var stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = href;
      stylesheet.crossOrigin = preloadLink.crossOrigin || '';
      stylesheet.media = responsiveMedia(preloadLink);
      stylesheet.onload = resolve;
      stylesheet.onerror = resolve;
      preloadLink.parentNode.insertBefore(stylesheet, preloadLink.nextSibling);
      preloadLink.remove();
    });
  }

  function loadResponsiveStylesheet(event) {
    if (!isAppRoute) return;
    var wantsMobile = event ? event.matches : mobileStylesViewport;
    var target = cssLinks.find(function matchingResponsiveLink(link) {
      if (!isResponsiveStylesheet(link)) return false;
      return wantsMobile
        ? /\/mobile\.css(?:[?#]|$)/.test(getHref(link))
        : /\/desktop\.css(?:[?#]|$)/.test(getHref(link));
    });
    if (target) convertPreload(target);
  }

  if (mobileStylesQuery) {
    if (mobileStylesQuery.addEventListener) mobileStylesQuery.addEventListener('change', loadResponsiveStylesheet);
    else if (mobileStylesQuery.addListener) mobileStylesQuery.addListener(loadResponsiveStylesheet);
  }

  var immediateLinks = cssLinks.filter(shouldLoadNow);
  var deferredLinks = cssLinks.filter(function deferred(link) {
    return immediateLinks.indexOf(link) === -1;
  });
  var featureLinks = isAuthenticatedChatRoute
    ? deferredLinks.filter(isFeatureStylesheet)
    : [];
  var routineDeferredLinks = isAppRoute
    ? deferredLinks.filter(function notFeature(link) {
      return !isFeatureStylesheet(link)
        && !isResponsiveStylesheet(link)
        && getLazyType(link) !== 'theme';
    })
    : [];
  var ready = Promise.all(immediateLinks.map(convertPreload));
  var timeout = new Promise(function timeout(resolve) {
    window.setTimeout(resolve, 1800);
  });

  window.__minimalistCssReady = Promise.race([ready, timeout]);
  window.__minimalistDeferredCssReady = new Promise(function deferredReady(resolve) {
    deferredCssReadyResolve = resolve;
  });
  window.__minimalistFeatureCssReady = new Promise(function featureReady(resolve) {
    featureCssReadyResolve = function resolveFeatureReady() {
      if (featureCssReadySettled) return;
      featureCssReadySettled = true;
      resolve();
    };
  });

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
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;600;700&display=optional';
    stylesheet.crossOrigin = 'anonymous';
    document.head.appendChild(stylesheet);
  }

  function loadDeferredStyles() {
    Promise.all(routineDeferredLinks.map(convertPreload)).then(function doneDeferred() {
      if (deferredCssReadyResolve) deferredCssReadyResolve();
    });
    loadBrandFonts();
    routineDeferredLinks = [];
    removeDeferredListeners(loadDeferredStyles);
  }

  function resolveFeatureStylesReady() {
    if (featureCssReadyResolve) featureCssReadyResolve();
  }

  function loadFeatureStyles() {
    if (!featureLinks.length) {
      resolveFeatureStylesReady();
      return window.__minimalistFeatureCssReady || Promise.resolve();
    }

    var linksToLoad = featureLinks.slice();
    featureLinks = [];
    removeDeferredListeners(loadFeatureStyles);
    Promise.all(linksToLoad.map(convertPreload)).then(resolveFeatureStylesReady, resolveFeatureStylesReady);
    return window.__minimalistFeatureCssReady || Promise.resolve();
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
      window.setTimeout(loadDeferredStyles, isHomeRoute ? 220 : 520);
    }
    addDeferredListeners(loadDeferredStyles);
  } else if (deferredCssReadyResolve) {
    deferredCssReadyResolve();
    window.setTimeout(loadBrandFonts, isAppRoute ? 1200 : isHomeRoute ? 220 : 520);
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
  } else {
    resolveFeatureStylesReady();
  }
})();
