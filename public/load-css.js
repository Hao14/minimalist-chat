(function loadMinimalistStyles() {
  try {
    document.documentElement.classList.toggle(
      'auth-session-hint',
      window.localStorage && window.localStorage.getItem('minimalist.auth.present.v1') === '1'
    );
  } catch {
    // The hint only prevents signed-in navigation flicker; Firebase remains authoritative.
  }
  // base.css is linked as a normal render-blocking stylesheet in index.html.
  // This deferred helper only resolves route, theme, device, and feature CSS.
  var cssLinks = Array.prototype.slice.call(document.querySelectorAll('[data-load-css]'));
  var path = window.location.pathname || '/';
  var routeName = (path.split('/').filter(Boolean)[0] || 'home').toLowerCase();
  var isAppRoute = /^\/(?:chat|join|login)(?:\/|$)/.test(path);
  var isVaultShareRoute = /^\/vault\/share(?:\/|$)/.test(path);
  var schedulesAppStartupStyles = isAppRoute || isVaultShareRoute;
  var isHomeRoute = path === '/' || path === '';
  var supportsModules = 'noModule' in document.createElement('script');
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = Boolean(connection && connection.saveData);
  var effectiveType = String((connection && connection.effectiveType) || '');
  var constrainedConnection = saveData || /(?:slow-)?2g/.test(effectiveType);
  var mobileStylesQuery = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
  var mobileStylesViewport = Boolean(mobileStylesQuery && mobileStylesQuery.matches);
  var loaded = {};
  var savedTheme = 'light';
  var deferredCssReadyResolve = null;
  var featureCssReadyResolve = null;
  var featureCssReadySettled = false;
  var brandFontsScheduled = false;
  var bootReady = false;
  var bootFailureShown = false;
  var bootFailureTimer = 0;

  function createReloadButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload Minimalist';
    button.addEventListener('click', function reloadMinimalist() {
      window.location.reload();
    });
    return button;
  }

  function showBootFailure() {
    if (bootReady || bootFailureShown) return;
    bootFailureShown = true;
    window.clearTimeout(bootFailureTimer);

    if (isHomeRoute) {
      if (window.__minimalistRevealStaticHome) window.__minimalistRevealStaticHome();
      return;
    }

    var shell = document.getElementById('app-boot-shell');
    var prerenderedRoute = document.querySelector('[data-prerender-route]');
    if (prerenderedRoute) {
      if (shell) shell.remove();
      var notice = document.createElement('aside');
      notice.className = 'boot-fallback-notice';
      notice.setAttribute('role', 'alert');
      var noticeText = document.createElement('span');
      noticeText.textContent = 'The interactive app did not finish loading. This static page is still available.';
      notice.appendChild(noticeText);
      notice.appendChild(createReloadButton());
      prerenderedRoute.parentNode.insertBefore(notice, prerenderedRoute);
      return;
    }

    if (!shell) return;
    while (shell.firstChild) shell.removeChild(shell.firstChild);
    shell.classList.add('instant-shell-failed');
    shell.setAttribute('role', 'alert');
    shell.setAttribute('aria-live', 'assertive');
    shell.setAttribute('aria-label', 'Minimalist could not finish loading');

    var panel = document.createElement('section');
    panel.className = 'boot-failure-panel';
    var heading = document.createElement('h1');
    heading.textContent = 'Minimalist could not finish loading.';
    var copy = document.createElement('p');
    copy.textContent = 'Reload to retry. If this keeps happening, update your browser or check the connection.';
    panel.appendChild(heading);
    panel.appendChild(copy);
    panel.appendChild(createReloadButton());
    shell.appendChild(panel);
  }

  window.__minimalistMarkBootReady = function markBootReady() {
    bootReady = true;
    window.clearTimeout(bootFailureTimer);
  };
  window.__minimalistReportBootFailure = showBootFailure;
  window.addEventListener('error', function revealAfterEntryFailure(event) {
    var target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.type === 'module') showBootFailure();
  }, true);
  bootFailureTimer = window.setTimeout(showBootFailure, 15000);
  if (!supportsModules) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBootFailure, { once: true });
    } else {
      showBootFailure();
    }
  }
  try {
    savedTheme = String(localStorage.getItem('theme') || 'light').toLowerCase();
  } catch {
    savedTheme = 'light';
  }
  document.documentElement.classList.add(isAppRoute ? 'route-app' : 'route-marketing');
  document.documentElement.classList.add('route-' + routeName);
  if (isHomeRoute) {
    document.documentElement.classList.add('route-home');
    if (supportsModules) {
      window.__minimalistRevealStaticHome = function revealStaticHome() {
        document.documentElement.classList.remove('home-react-pending');
      };
      if (!document.querySelector('link[data-phosphor-bold-subset]')) {
        var homeIconStyles = document.createElement('link');
        homeIconStyles.rel = 'stylesheet';
        homeIconStyles.href = '/phosphor-bold-subset.css?v=4';
        homeIconStyles.setAttribute('data-phosphor-bold-subset', 'true');
        document.head.appendChild(homeIconStyles);
      }
    }
  }

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
    return /\/(?:desktop|mobile|mobile-app-dock)\.css(?:[?#]|$)/.test(getHref(link));
  }

  function isMobileResponsiveStylesheet(link) {
    return /\/(?:mobile|mobile-app-dock)\.css(?:[?#]|$)/.test(getHref(link));
  }

  function responsiveMedia(link) {
    var href = getHref(link);
    if (/\/(?:mobile|mobile-app-dock)\.css(?:[?#]|$)/.test(href)) return '(max-width: 768px)';
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
        ? isMobileResponsiveStylesheet(link)
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
    var targets = cssLinks.filter(function matchingResponsiveLink(link) {
      if (!isResponsiveStylesheet(link)) return false;
      return wantsMobile
        ? isMobileResponsiveStylesheet(link)
        : /\/desktop\.css(?:[?#]|$)/.test(getHref(link));
    });
    targets.forEach(convertPreload);
  }

  if (mobileStylesQuery) {
    if (mobileStylesQuery.addEventListener) mobileStylesQuery.addEventListener('change', loadResponsiveStylesheet);
    else if (mobileStylesQuery.addListener) mobileStylesQuery.addListener(loadResponsiveStylesheet);
  }

  // Device and selected-theme styles should begin promptly, but they must not
  // delay the application handoff. base.css is the only render-blocking sheet.
  var startupDeferredLinks = cssLinks.filter(shouldLoadNow);
  var deferredLinks = cssLinks.filter(function deferred(link) {
    return startupDeferredLinks.indexOf(link) === -1;
  });
  var featureLinks = deferredLinks.filter(isFeatureStylesheet);
  var routineDeferredLinks = schedulesAppStartupStyles
    ? startupDeferredLinks.concat(deferredLinks.filter(function notFeature(link) {
      return !isFeatureStylesheet(link)
        && !isResponsiveStylesheet(link)
        && getLazyType(link) !== 'theme';
    }))
    : [];

  window.__minimalistCssReady = Promise.resolve();
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

  function scheduleBrandFonts() {
    if (brandFontsScheduled) return;
    brandFontsScheduled = true;
    var queueAfterLoad = function queueAfterLoad() {
      var idle = window.requestIdleCallback || function fontIdleFallback(callback) {
        return window.setTimeout(callback, 1200);
      };
      idle(loadBrandFonts, { timeout: 2400 });
    };
    if (document.readyState === 'complete') queueAfterLoad();
    else window.addEventListener('load', queueAfterLoad, { once: true });
  }

  function loadDeferredStyles() {
    Promise.all(routineDeferredLinks.map(convertPreload)).then(function doneDeferred() {
      if (deferredCssReadyResolve) deferredCssReadyResolve();
    });
    scheduleBrandFonts();
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
  window.addEventListener('minimalist:feature-styles-request', loadFeatureStyles);

  if (routineDeferredLinks.length) {
    if (schedulesAppStartupStyles) {
      // Paint the base shell once, then apply the matching device/theme layer
      // without putting it on the Chat-ready critical path.
      window.requestAnimationFrame(function deferAppStylesAfterPaint() {
        window.requestAnimationFrame(loadDeferredStyles);
      });
      window.setTimeout(loadDeferredStyles, 350);
    } else {
      window.setTimeout(loadDeferredStyles, isHomeRoute ? 220 : 520);
    }
    addDeferredListeners(loadDeferredStyles);
  } else if (deferredCssReadyResolve) {
    deferredCssReadyResolve();
    scheduleBrandFonts();
  }

  if (!featureLinks.length) {
    resolveFeatureStylesReady();
  }
})();
