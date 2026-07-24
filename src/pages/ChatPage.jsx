import {
  Fragment,
  useCallback,
  createElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import { writeAuthPresenceHint } from '../lib/authPresenceHint.js';
import { waitForInitialAuthState } from '../lib/authStateReady.js';
import { loadPersonalAgentPreferences } from '../features/ai/personalAgentPreference.js';

const h = createElement;
function useDeferredModernThemeMotion() {
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let loadFailed = false;
    let disposeMotion = () => {};
    let motionActive = false;

    const syncMotion = () => {
      const shouldRun = document.body.classList.contains('modern-mode');
      if (!shouldRun) {
        if (motionActive) disposeMotion();
        disposeMotion = () => {};
        motionActive = false;
        return;
      }
      if (motionActive || loading || loadFailed) return;
      loading = true;
      import('../features/shell/modernThemeMotion.js')
        .then(({ initModernThemeMotion }) => {
          if (cancelled || !document.body.classList.contains('modern-mode')) return;
          disposeMotion = initModernThemeMotion();
          motionActive = true;
        })
        .catch((error) => {
          loadFailed = true;
          console.warn('[theme] Modern motion could not start.', error);
        })
        .finally(() => {
          loading = false;
        });
    };
    const observer = new MutationObserver(syncMotion);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const frame = window.requestAnimationFrame(syncMotion);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      disposeMotion();
    };
  }, []);
}

const LEGACY_MODAL_SELECTOR = [
  '#admin-dashboard-modal',
  '#leave-room-modal',
  '#delete-room-modal',
  '#mute-user-modal',
  '#delete-account-modal',
].join(',');

const LEGACY_MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useLegacyModalFocus() {
  useEffect(() => {
    let activeDialog = null;
    let returnFocus = null;
    let focusFrame = 0;

    const visibleFocusableItems = (dialog) => Array.from(
      dialog?.querySelectorAll(LEGACY_MODAL_FOCUSABLE_SELECTOR) || [],
    ).filter((element) => element.getClientRects().length > 0);

    const visibleDialogs = () => Array.from(document.querySelectorAll(LEGACY_MODAL_SELECTOR))
      .filter((dialog) => (
        !dialog.hidden
        && !dialog.classList.contains('hidden')
        && dialog.getAttribute('aria-hidden') !== 'true'
      ))
      .sort((left, right) => {
        const leftZ = Number.parseInt(window.getComputedStyle(left).zIndex, 10) || 0;
        const rightZ = Number.parseInt(window.getComputedStyle(right).zIndex, 10) || 0;
        return leftZ - rightZ;
      });

    const scheduleFocusInside = (dialog) => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        if (activeDialog !== dialog || dialog.classList.contains('hidden')) return;
        if (dialog.contains(document.activeElement)) return;
        const target = dialog.querySelector('[autofocus]') || visibleFocusableItems(dialog)[0] || dialog;
        if (!dialog.hasAttribute('tabindex') && target === dialog) dialog.tabIndex = -1;
        target.focus?.();
      });
    };

    const restorePreviousFocus = () => {
      const target = returnFocus;
      returnFocus = null;
      if (!target?.isConnected) return;
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => target.focus?.());
    };

    const syncDialog = () => {
      const nextDialog = visibleDialogs().at(-1) || null;
      if (nextDialog === activeDialog) return;

      if (nextDialog) {
        if (!activeDialog) {
          returnFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        }
        activeDialog = nextDialog;
        scheduleFocusInside(nextDialog);
        return;
      }

      activeDialog = null;
      restorePreviousFocus();
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Tab' || !activeDialog) return;
      const focusable = visibleFocusableItems(activeDialog);
      if (!focusable.length) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
      subtree: true,
    });
    document.addEventListener('keydown', handleKeyDown, true);
    syncDialog();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', handleKeyDown, true);
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);
}

function renderLazyRoomView(view, extraClassName = 'hidden') {
  return h(
    "div",
    {
      id: `room-view-${view}`,
      className: `room-view ${extraClassName}`.trim(),
      "data-deferred-room-view": view,
      role: "tabpanel",
      "aria-labelledby": `room-tab-${view}`,
      "aria-hidden": extraClassName.includes('hidden') ? "true" : "false",
    },
    h(
      "div",
      {
        className: "room-view-loading",
        role: "status",
        "aria-live": "polite",
        style: {
          display: "grid",
          placeItems: "center",
          minHeight: "220px",
          color: "var(--muted-text, #777)",
          fontWeight: 800,
          letterSpacing: "0.04em",
        },
      },
      "Loading..."
    )
  );
}

const CONFIG_SCRIPT_SRC = '/config.js?v=localai7';
const REQUIRED_CONFIG_GLOBALS = ['GCAL_CLIENT_ID', 'STRIPE_CHECKOUT_ENDPOINT'];

function rememberPendingChatNotificationUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/chat' && params.has('notification')) {
      sessionStorage.setItem('pendingChatUrl', `${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
  } catch {
    // Session storage can be blocked in some mobile auth flows.
  }
}

function requiresVerifiedPasswordUser(user) {
  if (!user?.email) return false;
  if (user.emailVerified !== false) return false;
  return user.providerData?.some((provider) => provider?.providerId === 'password') === true;
}

function describeChatBootFailure(error) {
  const code = String(error?.code || 'boot/unknown');
  if (code === 'auth/timeout' || code === 'auth/network-request-failed') {
    return {
      code,
      title: 'We could not confirm your session',
      message: 'Check your connection, then retry. If this keeps happening, return to sign in.',
    };
  }

  if (code === 'auth/web-storage-unsupported') {
    return {
      code,
      title: 'Session storage is unavailable',
      message: 'Allow site storage for Minimalist, then retry or return to sign in.',
    };
  }

  return {
    code,
    title: 'Minimalist could not finish starting',
    message: 'Retry the app. If it still fails, return to sign in and start a fresh session.',
  };
}

function retryChatBoot() {
  window.location.reload();
}

function returnToSignInFromBoot() {
  writeAuthPresenceHint(false);
  window.location.replace('/login');
}

function renderChatBootStatus(bootFailure) {
  return h(
    Fragment,
    null,
    h(
      'div',
      {
        className: `boot-line ${bootFailure ? 'is-error' : 'is-complete'} boot-line-static`,
      },
      h('span', { className: 'boot-line-no' }, '00'),
      h('span', { className: 'boot-status' }, bootFailure ? 'err' : 'run'),
      h(
        'span',
        { className: 'boot-code' },
        h('span', { className: 'boot-key' }, 'session'),
        h('span', { className: 'boot-punc' }, '.'),
        h('span', { className: 'boot-fn' }, 'prepare'),
        h('span', { className: 'boot-punc' }, '('),
        h('span', { className: 'boot-string' }, '"identity"'),
        h('span', { className: 'boot-punc' }, ')'),
        h(
          'span',
          { className: 'boot-muted' },
          bootFailure ? ' // session unavailable' : ' // waiting for auth',
        ),
      ),
      bootFailure ? null : h('span', { className: 'boot-cursor' }),
    ),
    bootFailure
      ? h(
        'div',
        { className: 'boot-recovery' },
        h('strong', { className: 'boot-recovery-title' }, bootFailure.title),
        h('p', { className: 'boot-recovery-message' }, bootFailure.message),
        h(
          'div',
          { className: 'boot-recovery-actions' },
          h('button', { type: 'button', onClick: retryChatBoot }, 'Retry'),
          h(
            'button',
            { type: 'button', className: 'boot-recovery-secondary', onClick: returnToSignInFromBoot },
            'Return to sign in',
          ),
        ),
      )
      : null,
  );
}

function hasRuntimeConfig() {
  return REQUIRED_CONFIG_GLOBALS.every((key) => Boolean(window[key]));
}

function loadConfigScript() {
  if (hasRuntimeConfig()) return Promise.resolve();
  if (window.__minimalistConfigPromise) return window.__minimalistConfigPromise;

  window.__minimalistConfigPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const existingScript = document.querySelector('script[data-minimalist-config], script[src*="/config.js"]');
    const script = existingScript || document.createElement('script');

    script.dataset.minimalistConfig = 'true';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', finish, { once: true });

    if (!existingScript) {
      script.async = false;
      script.src = CONFIG_SCRIPT_SRC;
      (document.head || document.body || document.documentElement).appendChild(script);
    }

    window.setTimeout(finish, 1500);
  }).finally(() => {
    window.__minimalistConfigPromise = null;
  });

  return window.__minimalistConfigPromise;
}

function useChatBoot() {
  const [bootFailure, setBootFailure] = useState(null);

  useEffect(() => {
    const oldTitle = document.title;
    const oldClass = document.body.className;
    const oldStyle = document.body.getAttribute('style');
    let cancelled = false;

    document.title = 'Minimalist | Chat';
    document.body.className = '';
    document.body.removeAttribute('style');

    const boot = async () => {
      const [{ onAuthStateChanged }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('../lib/firebase.js'),
      ]);
      const user = auth.currentUser || await waitForInitialAuthState(auth, onAuthStateChanged);

      if (cancelled) return;

      if (!user) {
        writeAuthPresenceHint(false);
        rememberPendingChatNotificationUrl();
        if (window.location.pathname.startsWith('/join/')) {
          sessionStorage.setItem('pendingJoinUrl', `${window.location.pathname}${window.location.search}${window.location.hash}`);
        }
        window.location.replace('/login');
        return;
      }

      if (requiresVerifiedPasswordUser(user)) {
        writeAuthPresenceHint(false);
        rememberPendingChatNotificationUrl();
        if (window.location.pathname.startsWith('/join/')) {
          sessionStorage.setItem('pendingJoinUrl', `${window.location.pathname}${window.location.search}${window.location.hash}`);
        }
        window.location.replace('/login');
        return;
      }

      window.currentUser = user;
      writeAuthPresenceHint(true);
      if (!window.GCAL_CLIENT_ID || !window.STRIPE_CHECKOUT_ENDPOINT) void loadConfigScript();
      if (!cancelled) {
        await import('../features/shell/chatApp.js');
        window.requestAnimationFrame(() => window.hydrateRoomCollapsePreference?.());
      }
    };

    boot().catch((error) => {
      console.error('Minimalist failed to start:', error);
      if (!cancelled) setBootFailure(describeChatBootFailure(error));
    });

    return () => {
      cancelled = true;
      const disposeContactsPanel = window.disposeContactsPanel;
      if (typeof disposeContactsPanel === 'function') queueMicrotask(disposeContactsPanel);
      document.title = oldTitle;
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, []);

  return bootFailure;
}

function useRoomNavMotion() {
  useEffect(() => {
    const rail = document.getElementById('room-sub-nav');
    if (!rail) return undefined;

    let frame = 0;
    const updateIndicator = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const activeTab = rail.querySelector('.room-tab.active');
        if (!activeTab) return;

        const railRect = rail.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();
        const x = tabRect.left - railRect.left + rail.scrollLeft;
        const center = tabRect.left - railRect.left + tabRect.width / 2;

        rail.style.setProperty('--room-nav-indicator-x', `${Math.max(0, x)}px`);
        rail.style.setProperty('--room-nav-indicator-w', `${Math.max(24, tabRect.width)}px`);
        rail.style.setProperty('--room-nav-active-center', `${Math.max(0, center)}px`);
      });
    };

    const observer = new MutationObserver(updateIndicator);
    observer.observe(rail, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateIndicator) : null;
    resizeObserver?.observe(rail);

    const handlePointerMove = (event) => {
      const rect = rail.getBoundingClientRect();
      rail.style.setProperty('--room-nav-pointer-x', `${event.clientX - rect.left}px`);
      rail.style.setProperty('--room-nav-pointer-y', `${event.clientY - rect.top}px`);
    };

    rail.addEventListener('pointermove', handlePointerMove);
    rail.addEventListener('scroll', updateIndicator, { passive: true });
    window.addEventListener('resize', updateIndicator);
    updateIndicator();
    const refreshTimer = window.setTimeout(updateIndicator, 450);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(refreshTimer);
      observer.disconnect();
      resizeObserver?.disconnect();
      rail.removeEventListener('pointermove', handlePointerMove);
      rail.removeEventListener('scroll', updateIndicator);
      window.removeEventListener('resize', updateIndicator);
    };
  }, []);
}

function useDeferredChatSurfaces() {
  const [DeferredSurfaces, setDeferredSurfaces] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'idle', error: null });
  const readyPromiseRef = useRef(null);
  const readyResolveRef = useRef(null);
  const readyRejectRef = useRef(null);
  const mountedRef = useRef(false);

  const ensureDeferredSurfaces = useCallback(() => {
    if (mountedRef.current) return Promise.resolve(true);
    if (readyPromiseRef.current) return readyPromiseRef.current;

    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    readyPromiseRef.current = readyPromise;
    readyResolveRef.current = resolveReady;
    readyRejectRef.current = rejectReady;
    setLoadState({ status: 'loading', error: null });

    Promise.all([
      Promise.resolve(window.__minimalistLoadFeatureStyles?.()),
      import('../features/shell/ChatDeferredSurfaces.jsx'),
    ])
      .then(([, module]) => {
        setDeferredSurfaces(() => module.default);
      })
      .catch((error) => {
        if (readyPromiseRef.current === readyPromise) {
          readyPromiseRef.current = null;
          readyResolveRef.current = null;
          readyRejectRef.current = null;
        }
        setLoadState({ status: 'error', error });
        rejectReady(error);
        window.dispatchEvent(new CustomEvent('minimalist:deferred-surfaces-error', {
          detail: { error },
        }));
      });

    return readyPromise;
  }, []);

  const handleDeferredSurfacesReady = useCallback(() => {
    mountedRef.current = true;
    setLoadState({ status: 'ready', error: null });
    readyResolveRef.current?.(true);
    readyResolveRef.current = null;
    readyRejectRef.current = null;
  }, []);

  useEffect(() => {
    const previousEnsure = window.ensureChatDeferredSurfaces;
    const requestSurfaces = () => {
      ensureDeferredSurfaces().catch((error) => {
        window.showToast?.(error?.message || 'These controls could not be opened. Please try again.');
      });
    };

    window.ensureChatDeferredSurfaces = ensureDeferredSurfaces;
    window.addEventListener('minimalist:deferred-surfaces-request', requestSurfaces);

    return () => {
      window.removeEventListener('minimalist:deferred-surfaces-request', requestSurfaces);
      if (window.ensureChatDeferredSurfaces === ensureDeferredSurfaces) {
        if (previousEnsure) window.ensureChatDeferredSurfaces = previousEnsure;
        else delete window.ensureChatDeferredSurfaces;
      }
      if (!mountedRef.current) {
        readyRejectRef.current?.(new Error('Deferred Chat controls were unmounted before they finished loading.'));
      }
    };
  }, [ensureDeferredSurfaces]);

  if (DeferredSurfaces) {
    return <DeferredSurfaces onReady={handleDeferredSurfacesReady} />;
  }

  if (loadState.status === 'loading') {
    return (
      <span
        className="chat-deferred-surface-loading"
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          right: '1rem',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          zIndex: 10000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          minHeight: '40px',
          padding: '0.55rem 0.75rem',
          border: '1px solid var(--border-color, #d8d8d8)',
          borderRadius: '12px',
          background: 'var(--bg-color, #fff)',
          color: 'var(--text-color, #111)',
          boxShadow: '0 8px 24px rgb(0 0 0 / 10%)',
          fontSize: '0.8125rem',
          fontWeight: 700,
        }}
      >
        <i className="ph-bold ph-spinner-gap" aria-hidden="true" />
        Preparing additional Chat controls…
      </span>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div
        className="chat-deferred-surface-error"
        role="alert"
        style={{
          position: 'fixed',
          right: '1rem',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          maxWidth: 'min(32rem, calc(100vw - 2rem))',
          padding: '0.75rem',
          border: '1px solid var(--border-color, currentColor)',
          borderRadius: '12px',
          background: 'var(--bg-color, #fff)',
          color: 'var(--text-color, #111)',
        }}
      >
        <i className="ph-bold ph-warning" aria-hidden="true" />
        <span>Additional Chat controls could not be loaded.</span>
        <button
          type="button"
          onClick={() => ensureDeferredSurfaces().catch(() => {})}
          aria-label="Retry loading additional Chat controls"
          style={{ minHeight: '40px', borderRadius: '8px' }}
        >
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  return null;
}

function renderChatShell(
  bootFailure = null,
  personalAgentPreferences = { desktop: true, mobile: true },
  deferredSurfaces = null,
) {
  const desktopPersonalAgentEnabled = personalAgentPreferences.desktop !== false;
  const mobilePersonalAgentEnabled = personalAgentPreferences.mobile !== false;
  return h(
    Fragment,
    null,
    "\n    ",
    h("div", {
        className: "shape yellow-circle bottom-left",
      }),
    "\n\n    ",
    h(
      "nav",
      { className: "app-shell-nav", "aria-label": "App navigation" },
      "\n        ",
      h(
        "a",
        {
          href: "/",
          id: "nav-logo",
          "aria-label": "Minimalist home",
        },
        "\n            ",
        h(
          "div",
          {
            className: "mascot-blip",
          },
          "\n                ",
          h("div", {
              className: "blip-eye left",
            }),
          "\n                ",
          h("div", {
              className: "blip-eye right",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "span",
          {
            className: "logo-text",
          },
          "MINIMALIST"
        ),
        "\n        "
      ),
      "\n\n        ",
      "\n        ",
      h(
        "div",
        {
          className: "desktop-nav",
        },
        "\n            ",
        h(
        "a",
        {
          href: "/",
          className: "rail-icon guest-only",
          title: "Home",
          "aria-label": "Home",
        },
          h("i", {
              className: "ph-bold ph-house",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "a",
        {
          href: "/story",
          className: "rail-icon guest-only",
          title: "Story",
          "aria-label": "Story",
        },
          h("i", {
              className: "ph-bold ph-book-open",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "a",
        {
          href: "/chat",
          className: "rail-icon auth-only hidden",
          title: "Chat",
          "aria-label": "Open chat",
        },
          h("i", {
              className: "ph-bold ph-chats",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "button",
        {
            type: "button",
            className: "rail-icon auth-only hidden",
            id: "open-contacts-btn",
            title: "Contacts",
            "aria-label": "Open contacts",
          },
          h("i", {
              className: "ph-bold ph-users",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "button",
        {
            type: "button",
            className: `rail-icon auth-only hidden${desktopPersonalAgentEnabled ? '' : ' personal-ai-nav-hidden'}`,
            id: "open-personal-agent-btn",
            title: "Winston",
            "aria-label": "Open Winston",
            "aria-controls": "personal-ai-agent-panel",
            "aria-expanded": "false",
            hidden: !desktopPersonalAgentEnabled,
          },
          h("i", {
              className: "ph-bold ph-sparkle",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "button",
        {
            type: "button",
            className: "rail-icon auth-only hidden",
            id: "open-vault-btn",
            title: "Vault",
            "aria-label": "Open Vault",
          },
          h("span", {
              className: "vault-rail-glyph",
              "aria-hidden": "true",
            })
        ),
        h("div", {
            style: { flexGrow: "1", width: "100%", minHeight: "20px" },
          }),
        "\n\n            ",
        h(
          "button",
          {
            type: "button",
            id: "open-updates-btn-desktop",
            className: "rail-icon updates-entry auth-only hidden",
            title: "Updates",
            "aria-label": "Open updates",
            "aria-controls": "updates-panel",
            "aria-expanded": "false",
          },
          h("i", {
              className: "ph-bold ph-bell",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "button",
        {
            type: "button",
            className: "rail-icon auth-only hidden",
            id: "open-search-btn",
            title: "Search",
            "aria-label": "Open search",
          },
          h("i", {
              className: "ph-bold ph-magnifying-glass",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "button",
        {
            type: "button",
            className: "rail-icon auth-only hidden",
            id: "open-settings-btn",
            title: "Settings",
            "aria-label": "Open settings",
          },
          h("i", {
              className: "ph-bold ph-gear",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "a",
        {
          href: "/login",
          className: "rail-icon guest-only",
          title: "Login",
          "aria-label": "Log in",
        },
          h("i", {
              className: "ph-bold ph-sign-in",
              "aria-hidden": "true",
            })
        ),
        "\n        "
      ),
      "\n        \n        ",
      "\n        ",
      h(
        "div",
        {
          id: "mobile-nav-links",
          className: "mobile-only mobile-app-dock",
          role: "group",
          "aria-label": "Primary app destinations",
        },
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only active",
            id: "open-rooms-btn-mobile",
            "aria-label": "Open rooms",
            "aria-controls": "desktop-room-sidebar",
            "aria-expanded": "false",
            "aria-current": "page",
            "data-mobile-dock-action": "rooms",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-chats",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "Rooms"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-contacts-btn-mobile",
            "aria-label": "Open contacts",
            "aria-controls": "contacts-panel pm-popup",
            "aria-expanded": "false",
            "data-mobile-dock-action": "contacts",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-users",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "Contacts"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: `action-btn mobile-link-btn mobile-link-btn--assistant auth-only${mobilePersonalAgentEnabled ? '' : ' personal-ai-nav-hidden'}`,
            id: "open-personal-agent-btn-mobile",
            title: "Winston",
            "aria-label": "Open Winston",
            "aria-controls": "personal-ai-agent-panel",
            "aria-expanded": "false",
            "data-mobile-dock-action": "personal-agent",
            hidden: !mobilePersonalAgentEnabled,
          },
          h("i", {
              className: "ph-bold ph-sparkle",
              "aria-hidden": "true",
            }),
          h("span", null, "Winston")
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-updates-btn-mobile",
            "aria-label": "Open updates",
            "aria-controls": "updates-panel",
            "aria-expanded": "false",
            "data-mobile-dock-action": "updates",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-bell",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "Updates"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-more-btn-mobile",
            "aria-label": "Open more app destinations",
            "aria-controls": "mobile-dock-more-menu",
            "aria-expanded": "false",
            "aria-haspopup": "dialog",
            "data-mobile-dock-action": "more",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-dots-three",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "More"
          ),
          "\n            "
        ),
        "\n        "
      ),
      h(
        "div",
        {
          id: "mobile-dock-more-menu",
          className: "mobile-only mobile-dock-more-menu hidden",
          role: "dialog",
          "aria-modal": "false",
          "aria-labelledby": "mobile-dock-more-title",
          "aria-hidden": "true",
        },
        h(
          "div",
          { className: "mobile-dock-more-heading" },
          h(
            "span",
            { className: "mobile-dock-more-title" },
            h("small", null, "Workspace"),
            h("strong", { id: "mobile-dock-more-title" }, "More")
          ),
          h(
            "button",
            {
              id: "close-mobile-dock-more",
              className: "mobile-dock-more-close",
              type: "button",
              "aria-label": "Close more destinations",
            },
            h("i", { className: "ph-bold ph-x", "aria-hidden": "true" })
          )
        ),
        h(
          "div",
          { className: "mobile-dock-more-actions", role: "menu", "aria-label": "More app destinations" },
          h(
            "button",
            {
              type: "button",
              className: "action-btn mobile-dock-more-action auth-only",
              id: "open-search-btn-mobile",
              role: "menuitem",
              "aria-label": "Open search",
              "aria-controls": "search-modal",
              "aria-expanded": "false",
            },
            h("span", { className: "mobile-dock-more-icon", "aria-hidden": "true" }, h("i", { className: "ph-bold ph-magnifying-glass" })),
            h("span", { className: "mobile-dock-more-copy" }, h("strong", null, "Search"), h("small", null, "Rooms, people, messages")),
            h("i", { className: "ph-bold ph-caret-right mobile-dock-more-arrow", "aria-hidden": "true" })
          ),
          h(
            "button",
            {
              type: "button",
              className: "action-btn mobile-dock-more-action auth-only",
              id: "open-vault-btn-mobile",
              role: "menuitem",
              "aria-label": "Open vault",
              "aria-controls": "vault-panel",
              "aria-expanded": "false",
            },
            h("span", { className: "mobile-dock-more-icon", "aria-hidden": "true" }, h("span", { className: "vault-rail-glyph" })),
            h("span", { className: "mobile-dock-more-copy" }, h("strong", null, "Vault"), h("small", null, "Saved links and files")),
            h("i", { className: "ph-bold ph-caret-right mobile-dock-more-arrow", "aria-hidden": "true" })
          ),
          h(
            "button",
            {
              type: "button",
              className: "action-btn mobile-dock-more-action auth-only",
              id: "open-settings-btn-mobile",
              role: "menuitem",
              "aria-label": "Open settings",
              "aria-controls": "settings-modal",
              "aria-expanded": "false",
            },
            h("span", { className: "mobile-dock-more-icon", "aria-hidden": "true" }, h("i", { className: "ph-bold ph-gear" })),
            h("span", { className: "mobile-dock-more-copy" }, h("strong", null, "Settings"), h("small", null, "Account and appearance")),
            h("i", { className: "ph-bold ph-caret-right mobile-dock-more-arrow", "aria-hidden": "true" })
          )
        )
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        className: "app-screen boot-loader-screen",
        id: "loading-screen",
        role: bootFailure ? "alert" : "status",
        "aria-live": bootFailure ? "assertive" : "polite",
        "aria-busy": bootFailure ? "false" : "true",
        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-start", flex: "1", height: "100vh", padding: "3rem", position: "fixed", top: "0", left: "0", width: "100vw", zIndex: "9999", background: "var(--bg-color)", transition: "opacity 0.5s ease", boxSizing: "border-box" },
      },
      "\n        \n        ",
      h(
        "div",
        {
          className: "boot-brand",
          style: { display: "flex", alignItems: "center", gap: "15px" },
        },
        "\n            ",
        h(
          "div",
          {
            className: "mascot-blip boot-logo-blip",
            style: { margin: "0", cursor: "default", width: "44px", height: "36px", borderWidth: "3px", boxShadow: "3px 3px 0px var(--text-color)" },
          },
          "\n                ",
          h("div", {
              className: "blip-eye left",
              style: { width: "6px", height: "6px" },
            }),
          "\n                ",
          h("div", {
              className: "blip-eye right",
              style: { width: "6px", height: "6px" },
            }),
          "\n            "
        ),
        "\n            ",
        h(
        "span",
          {
            className: "boot-logo-word",
            style: { fontWeight: "800", fontSize: "1.4rem", letterSpacing: "2px", color: "var(--text-color)" },
          },
          "MINIMALIST"
        ),
        "\n        "
      ),
      "\n\n        ",
      h(
      "div",
        {
          id: "boot-sequence",
          className: "boot-terminal",
          style: { display: "flex", flexDirection: "column", gap: "10px", fontFamily: "monospace", fontSize: "1rem", fontWeight: "700", color: "var(--text-color)", textTransform: "uppercase" },
        },
        "\n            ",
        renderChatBootStatus(bootFailure),
        "\n            "
      ),
      "\n\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        className: "chat-container-full app-screen hidden",
        id: "chat-wrapper",
      },
      "\n        ",
      h(
        "div",
        {
          id: "chat-interface",
          className: "fade-in-up",
          style: { flexDirection: "row", position: "relative" },
        },
        "\n            \n            ",
        h(
          "div",
          {
            id: "desktop-room-sidebar",
            role: "complementary",
            "aria-label": "Rooms",
          },
          "\n                ",
          h(
            "div",
            {
              className: "sidebar-header",
              style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
            },
            "\n                    ",
            h(
              "h3",
              null,
              "Rooms"
            ),
            "\n                    ",
            h(
              "div",
              {
                style: { display: "flex", alignItems: "center", gap: "0.35rem" },
              },
              "\n                        ",
              h(
                "button",
                {
                  className: "room-collapse-btn",
                  id: "toggle-rooms-collapse-btn",
                  type: "button",
                  title: "Collapse rooms",
                  "aria-label": "Collapse rooms",
                },
                h("i", {
                    className: "ph-bold ph-sidebar",
                    "aria-hidden": "true",
                  })
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "close-panel mobile-only",
                  id: "close-mobile-rooms-btn",
                  type: "button",
                  "aria-label": "Close rooms panel",
                  style: { background: "none", border: "none", fontSize: "1.5rem", margin: "0", padding: "0", boxShadow: "none" },
                },
                h("i", {
                  className: "ph-bold ph-x",
                  "aria-hidden": "true",
                })
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n                ",
          h("ul", {
              id: "room-list",
            }),
          "\n                ",
          h(
            "div",
            {
              className: "sidebar-actions",
            },
            "\n                    ",
            h(
              "button",
              {
                id: "create-room-btn",
                className: "room-action-btn btn-dark",
                type: "button",
              },
              h("i", {
                className: "ph-bold ph-plus",
                "aria-hidden": "true",
              }),
              " New room"
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "join-room-btn",
                className: "room-action-btn btn-light",
                type: "button",
              },
              "Join"
            ),
            "\n                "
          ),
          "\n            "
        ),
        "\n\n            ",
        h(
          "div",
          {
            id: "main-chat-area",
          },
          "\n                \n                ",
          h(
            "div",
            {
              id: "active-room-header",
              style: { position: "relative", zIndex: "100", display: "flex", alignItems: "center", padding: "0.8rem 1.5rem", borderBottom: "3px solid var(--text-color)", background: "var(--bg-color)", minHeight: "60px" },
            },
            "\n                    \n                    ",
            h(
              "button",
              {
                id: "mobile-back-to-rooms",
                className: "mobile-only action-btn",
                type: "button",
                "aria-label": "Back to rooms",
                style: { border: "none", boxShadow: "none", padding: "0", margin: "0", marginRight: "15px", fontSize: "1.5rem", background: "transparent", cursor: "pointer" },
              },
              h("i", {
                  className: "ph-bold ph-arrow-left",
                  "aria-hidden": "true",
                })
            ),
            "\n                    \n                    ",
            h(
              "div",
              {
                id: "room-name-wrapper",
                role: "button",
                tabIndex: 0,
                "aria-haspopup": "menu",
                "aria-expanded": "false",
                "aria-controls": "room-settings-dropdown",
                style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "4px", borderRadius: "4px", transition: "background 0.2s" },
              },
              "\n                        ",
              h("span", {
                id: "active-room-name-display",
                style: { fontWeight: "800", fontSize: "1.1rem", letterSpacing: "0.5px" },
              }, "Global Chat"),
              h("i", {
                 className: "ph-bold ph-caret-down",
                 "aria-hidden": "true",
                 style: { fontSize: "1rem", color: "#888" },
               }),
              "\n                    "
            ),
            h("div", {
              id: "room-header-meta",
              className: "room-header-meta",
              "aria-live": "polite",
              "aria-label": "Room details",
            }),
            "\n\n                    ",
            h(
              "div",
              {
                className: "room-header-actions",
                style: { marginLeft: "auto", display: "flex", alignItems: "center", position: "relative" },
              },
              "\n                        ",
              h("input", {
                  type: "text",
                  id: "room-search-input",
                 className: "header-search-input",
                 placeholder: "Search...",
                 autoComplete: "off",
                 "aria-label": "Search messages in this room",
                 "aria-hidden": "true",
                  tabIndex: -1,
                }),
              "\n                        ",
              h(
                "button",
                {
                  id: "toggle-room-search-btn",
                  type: "button",
                  "aria-label": "Search messages",
                  "aria-controls": "room-search-input",
                  "aria-expanded": "false",
                  title: "Search Messages",
                  style: { background: "transparent", border: "none", boxShadow: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--text-color)", padding: "0", margin: "0", display: "flex", alignItems: "center", justifyContent: "center", width: "35px", height: "35px", lineHeight: "1", outline: "none" },
                },
                "\n                            ",
                h("i", {
                    className: "ph-bold ph-magnifying-glass",
                    "aria-hidden": "true",
                  }),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n\n                    ",
            h(
              "div",
              {
                id: "room-settings-dropdown",
                className: "hidden brutalist-dropdown",
                style: { top: "60px", left: "1.5rem" },
              },
              "\n                        ",
              h(
                "button",
                {
                  id: "room-drop-invite",
                },
                "Invite / Link"
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "room-drop-favorite",
                },
                h("i", {
                  className: "ph-bold ph-star",
                  "aria-hidden": "true",
                }),
                " Favorite Room"
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "room-drop-hide",
                },
                "Hide Room"
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "room-drop-settings",
                },
                "Room Settings"
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "room-drop-notifications",
                },
                "Notification Options"
              ),
              "\n                    "
            ),
            "\n                    ",
            "\n                    ",
            h("div", {
                id: "room-add-page-menu",
                className: "hidden brutalist-dropdown",
                role: "menu",
                "aria-label": "Room tools",
                "aria-hidden": "true",
                style: { top: "96px", left: "1.5rem" },
              }),
            "\n                "
          ),
          "\n               ",
          h(
            "div",
            {
              id: "room-sub-nav",
              className: "room-nav-rail",
              role: "tablist",
              "aria-label": "Room views",
              style: { display: "flex", gap: "2rem", padding: "0 1.5rem", background: "var(--bg-color)", alignItems: "center" },
            },
            "\n                    ",
            h(
              "button",
              {
                id: "room-tab-home",
                className: "room-tab",
                "data-target": "home",
                type: "button",
                role: "tab",
                "aria-selected": "false",
                "aria-controls": "room-view-home",
                tabIndex: -1,
              },
              h("i", { className: "ph-bold ph-house", "aria-hidden": "true" }),
              h("span", null, "Home")
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "room-tab-chat",
                className: "room-tab active",
                "data-target": "chat",
                type: "button",
                role: "tab",
                "aria-selected": "true",
                "aria-controls": "room-view-chat",
                tabIndex: 0,
              },
              h("i", { className: "ph-bold ph-chat-circle-text", "aria-hidden": "true" }),
              h("span", null, "Chat")
            ),
            "\n                    ",
            "\n                    ",
            h("span", {
                id: "room-pages-dynamic",
                style: { display: "contents" },
              }),
            "\n                    ",
            h(
              "button",
              {
                id: "room-add-page-btn",
                className: "hidden",
                title: "Room tools",
                type: "button",
                "aria-label": "Open room tools",
                "aria-haspopup": "menu",
                "aria-controls": "room-add-page-menu",
                "aria-expanded": "false",
              },
              h("i", {
                className: "ph-bold ph-plus",
                "aria-hidden": "true",
              })
            ),
            "\n                "
          ),
          "\n                ",
          h(
            "div",
            {
              id: "room-channel-bar",
              className: "hidden",
            },
            "\n                    ",
            h(
              "span",
              {
                className: "channel-kicker",
              },
              "Channels"
            ),
            "\n                    ",
            h("div", {
                id: "room-channel-list",
              }),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              id: "room-view-chat",
              className: "room-view active",
              role: "tabpanel",
              "aria-labelledby": "room-tab-chat",
              "aria-hidden": "false",
              style: { flex: "1", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" },
            },
            "\n                    ",
            h(
              "div",
              {
                id: "loading-history",
                className: "hidden",
              },
              "Loading history..."
            ),
            "\n                    ",
            h("ul", {
                id: "messages",
              }),
            "\n                    \n                    ",
            h(
              "div",
              {
                id: "typing-status-container",
                className: "hidden",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "typing-dots",
                },
                h("div", {
                    className: "dot",
                  }),
                h("div", {
                    className: "dot",
                  }),
                h("div", {
                    className: "dot",
                  })
              ),
              "\n                        ",
              h(
                "span",
                {
                  id: "typing-text",
                },
                "Someone is typing..."
              ),
              "\n                    "
            ),
            "\n\n                    ",
            h(
              "div",
              {
                id: "active-reply-box",
                className: "hidden",
              },
              "\n                        ",
              h(
                "div",
                null,
                "\n                            ",
                h(
                  "strong",
                  null,
                  "Replying to ",
                  h("span", {
                      id: "replying-to-name",
                    }),
                  ":"
                ),
                "\n                            ",
                h("span", {
                    id: "replying-to-text",
                  }),
                "\n                        "
              ),
              "\n                        ",
              h(
                "span",
                {
                  className: "cancel-reply",
                  id: "cancel-reply-btn",
                },
                h("i", {
                  className: "ph-bold ph-x",
                  "aria-hidden": "true",
                })
              ),
              "\n                    "
            ),
            "\n\n                    ",
            h(
              "form",
              {
                id: "chat-form",
                action: "",
              },
              "\n                        ",
              h("input", {
                  type: "file",
                  id: "image-input",
                  className: "hidden",
                }),
              "\n                        ",
              h(
                "div",
                {
                  className: "composer-input-row",
                },
                "\n                            ",
                h("textarea", {
                    id: "message-input",
                    rows: "1",
                    placeholder: "Message Room...",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    type: "submit",
                    id: "mobile-send-btn",
                    className: "composer-send-btn",
                    title: "Send message",
                    "aria-label": "Send message",
                  },
                  "\n                                ",
                  h("i", {
                      className: "ph-bold ph-paper-plane-tilt",
                      "aria-hidden": "true",
                    }),
                  "\n                            "
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "composer-toolbar",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "composer-tool-group",
                    "aria-label": "Message tools",
                  },
                  "\n                                ",
                  h(
                    "button",
                    {
                      type: "button",
                      id: "attach-btn",
                      className: "composer-icon-btn",
                      title: "Attach file",
                      "aria-label": "Attach file",
                    },
                    "\n                                    ",
                    h("i", {
                        className: "ph-bold ph-paperclip",
                      }),
                    "\n                                "
                  ),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    className: "composer-hint",
                  },
                  "Enter ↵ send · Shift+Enter new line"
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          renderLazyRoomView("home"),
          "\n\n                ",
          renderLazyRoomView("docs"),
          "\n\n                ",
          renderLazyRoomView("whiteboard"),
          "\n\n                ",
          "\n                ",
          renderLazyRoomView("tasks"),
          "\n\n                ",
          "\n                ",
          renderLazyRoomView("events"),
          "\n\n                ",
          "\n                ",
          renderLazyRoomView("calendar"),
          "\n\n                ",
          "\n                ",
          renderLazyRoomView("ai"),
          "\n\n                ",
          "\n                ",
          renderLazyRoomView("calls"),
          "\n            "
        ),
        "\n\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    "\n\n    ",
    h(
      "div",
      {
        id: "contacts-panel",
        className: "contacts-panel-v2",
        role: "complementary",
        "aria-labelledby": "contacts-panel-heading",
        "aria-hidden": "true",
      },
      "\n        ",
      h(
        "div",
        {
          className: "contacts-header",
        },
        "\n            ",
        h(
          "h2",
          {
            className: "contacts-panel-title",
            id: "contacts-panel-heading",
          },
          "Contacts"
        ),
        h(
          "button",
          {
            className: "close-panel",
            id: "close-contacts-btn",
            type: "button",
            "aria-label": "Close contacts panel",
          },
          h("i", {
            className: "ph-bold ph-x",
            "aria-hidden": "true",
          })
        ),
        "\n        "
      ),
      "\n        \n        ",
      h(
        "div",
        {
          className: "contacts-search-wrap",
        },
        "\n            ",
        h(
          "div",
          {
            className: "contacts-search-field",
          },
          h("i", {
              className: "ph-bold ph-magnifying-glass contacts-search-icon",
              "aria-hidden": "true",
            }),
          h("input", {
              type: "search",
              id: "contact-search-input",
              autoComplete: "off",
              placeholder: "Search contacts...",
              "aria-label": "Search contacts",
              "aria-describedby": "contacts-search-help contacts-search-status",
            }),
          h(
            "button",
            {
              className: "contacts-search-clear",
              id: "clear-contact-search-btn",
              type: "button",
              hidden: true,
              "aria-label": "Clear contact search",
            },
            h("i", {
              className: "ph-bold ph-x",
              "aria-hidden": "true",
            })
          )
        ),
        h(
          "div",
          {
            className: "contacts-search-context",
          },
          h("span", { id: "contacts-search-help" }, "Type 2+ letters to search all people."),
          h("span", {
            id: "contacts-search-status",
            role: "status",
            "aria-live": "polite",
            "aria-atomic": "true",
          })
        ),
        "\n        "
      ),
      "\n        \n        ",
      h("ul", {
          id: "contacts-list",
          "aria-label": "Contacts",
          "aria-busy": "false",
        }),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "personal-ai-agent-panel",
        role: "dialog",
        "aria-modal": "false",
        "aria-labelledby": "personal-ai-agent-title",
        "aria-hidden": "true",
      },
      "\n        ",
      h(
        "div",
        {
          className: "contacts-header",
        },
        "\n            ",
        h(
          "span",
          { id: "personal-ai-agent-title" },
          "Winston"
        ),
        h(
          "button",
          {
            className: "close-panel",
            id: "close-personal-agent-btn",
            type: "button",
            "aria-label": "Close Winston",
          },
          h("i", { className: "ph-bold ph-x", "aria-hidden": "true" })
        ),
        "\n        "
      ),
      "\n        ",
      h("div", {
          id: "personal-ai-agent-root",
        }),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "vault-panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "vault-panel-title",
        "aria-hidden": "true",
      },
      "\n        ",
      h(
        "div",
        {
          className: "contacts-header",
        },
        "\n            ",
        h(
          "span",
          {
            className: "vault-panel-title",
            id: "vault-panel-title",
          },
          h("i", {
              className: "ph-bold ph-fingerprint",
              "aria-hidden": "true",
            }),
          h("span", null, "Vault"),
          h("small", null, "Private on this device")
        ),
        h(
          "button",
          {
            className: "close-panel close-panel-btn",
            id: "close-vault-btn",
            type: "button",
            "aria-label": "Close vault panel",
          },
          h("i", {
              className: "ph-bold ph-x",
              "aria-hidden": "true",
            })
        ),
        "\n        "
      ),
      "\n        ",
      h("div", {
          id: "vault-root",
        }),
      "\n    "
    ),
    deferredSurfaces,
    "\n\n\n    ",
    h(
      "div",
      {
        id: "brutalist-toast",
        className: "toast-hidden",
        role: "status",
        "aria-live": "polite",
        "aria-hidden": "true",
        hidden: true,
      },
      "\n        ",
      h(
        "i",
        {
          id: "toast-icon",
          className: "ph-bold ph-warning",
          "aria-hidden": "true",
        },
      ),
      "\n        ",
      h(
        "span",
        {
          id: "toast-message",
        },
        "Error message goes here"
      ),
      "\n        ",
      h(
        "button",
        {
          id: "toast-close",
          type: "button",
          "aria-label": "Close notification",
          tabIndex: -1,
        },
        h("i", {
          className: "ph-bold ph-x",
          "aria-hidden": "true",
        })
      ),
      "\n    "
    ),
    "\n"
  );
}

export default function ChatPage() {
  const bootFailure = useChatBoot();
  const deferredSurfaces = useDeferredChatSurfaces();
  useRoomNavMotion();
  useLegacyModalFocus();
  useDeferredModernThemeMotion();
  return h(
    'div',
    { className: 'react-page chat-react-page' },
    renderChatShell(bootFailure, loadPersonalAgentPreferences(), deferredSurfaces),
  );
}
