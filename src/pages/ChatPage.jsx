import { Fragment, createElement, useEffect, useState } from 'react';
import { initModernThemeMotion } from '../features/shell/modernThemeMotion.js';
import { writeAuthPresenceHint } from '../lib/authPresenceHint.js';
import { waitForInitialAuthState } from '../lib/authStateReady.js';
import { RoomAppsPanel } from '../features/rooms/RoomAppsPanel.jsx';
import { RoomPermissionsPanel } from '../features/rooms/RoomPermissionsPanel.jsx';
import { RoomSubscriptionPanel } from '../features/billing/RoomSubscriptionPanel.jsx';
import { AccountBillingPanel } from '../features/billing/AccountBillingPanel.jsx';
import { loadPersonalAgentPreferences } from '../features/ai/personalAgentPreference.js';
import { UpdatesCenterShell } from '../features/updates/UpdatesCenterShell.jsx';
import '../features/rooms/roomSettings.css';
import '../features/rooms/roomCreate.css';

const h = createElement;

function closeUserProfileDialog() {
  if (typeof window.closeUserProfilePopup === 'function') {
    window.closeUserProfilePopup();
    return;
  }
  const popup = document.getElementById('user-profile-popup');
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
  document.getElementById('profile-more-dropdown')?.classList.add('hidden');

  const settings = document.getElementById('settings-modal');
  if (!settings || settings.classList.contains('hidden')) {
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }
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

function renderFeatureModePanel() {
  return h(
    "div",
    {
      className: "settings-feature-mode-panel",
      id: "settings-feature-mode-panel",
    },
    "\n        ",
    h(
      "div",
      {
        className: "settings-feature-mode-copy",
      },
      "\n            ",
      h(
        "span",
        {
          className: "settings-feature-mode-title",
        },
        "Interface Mode"
      ),
      "\n            ",
      h(
        "span",
        {
          className: "settings-feature-mode-note",
          id: "feature-mode-note",
        },
        "Simple keeps the app quiet. Power shows the full room toolkit."
      ),
      "\n        "
    ),
    "\n        ",
    h(
      "div",
      {
        className: "settings-feature-mode-controls",
        role: "tablist",
        "aria-label": "Interface mode",
      },
      "\n            ",
      h(
        "button",
        {
          className: "action-btn feature-mode-select-btn",
          "data-feature-mode-select": "simple",
          type: "button",
          role: "tab",
          "aria-label": "Simple Mode: rooms, messages, files, search, and settings",
        },
        h("strong", null, "Simple Mode"),
        h("span", null, "Essentials only")
      ),
      "\n            ",
      h(
        "button",
        {
          className: "action-btn feature-mode-select-btn",
          "data-feature-mode-select": "power",
          type: "button",
          role: "tab",
          "aria-label": "Power Mode: tasks, polls, events, wiki, analytics, moderation, integrations, memory, time capsules, and archives",
        },
        h("strong", null, "Power Mode"),
        h("span", null, "Full toolkit")
      ),
      "\n        "
    ),
    "\n        ",
    h(
      "div",
      {
        className: "settings-feature-mode-summary",
        id: "feature-mode-summary",
      },
      "Simple Mode is active."
    ),
    "\n    "
  );
}

function renderPersonalAiPreferencePanel() {
  return h(
    "section",
    {
      className: "settings-personal-ai-panel",
      "aria-labelledby": "personal-ai-preference-title",
    },
    h(
      "div",
      { className: "settings-personal-ai-copy" },
      h("span", { className: "settings-personal-ai-title", id: "personal-ai-preference-title" }, "Winston navigation"),
      h(
        "span",
        { className: "settings-personal-ai-note", id: "personal-ai-preference-note" },
        "Choose where Winston appears on this device. Room AI stays available separately."
      )
    ),
    h(
      "div",
      {
        className: "settings-personal-ai-options",
        role: "group",
        "aria-labelledby": "personal-ai-preference-title",
      },
      h(
        "label",
        { className: "settings-personal-ai-switch" },
        h("input", {
          type: "checkbox",
          id: "personal-ai-desktop-enabled-toggle",
          role: "switch",
          defaultChecked: true,
          "aria-label": "Show Winston on desktop",
          "aria-describedby": "personal-ai-preference-note personal-ai-preference-status",
        }),
        h("span", { className: "settings-personal-ai-switch-label" }, "Desktop"),
        h("span", { className: "settings-personal-ai-track", "aria-hidden": "true" })
      ),
      h(
        "label",
        { className: "settings-personal-ai-switch" },
        h("input", {
          type: "checkbox",
          id: "personal-ai-mobile-enabled-toggle",
          role: "switch",
          defaultChecked: true,
          "aria-label": "Show Winston on mobile",
          "aria-describedby": "personal-ai-preference-note personal-ai-preference-status",
        }),
        h("span", { className: "settings-personal-ai-switch-label" }, "Mobile"),
        h("span", { className: "settings-personal-ai-track", "aria-hidden": "true" })
      )
    ),
    h(
      "span",
      {
        className: "settings-personal-ai-status",
        id: "personal-ai-preference-status",
        role: "status",
        "aria-live": "polite",
      },
      "Shown in desktop and mobile navigation"
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

function renderChatShell(
  bootFailure = null,
  personalAgentPreferences = { desktop: true, mobile: true },
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
      { className: "app-shell-nav" },
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
          className: "mobile-only",
        },
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-rooms-btn-mobile",
            "aria-label": "Open rooms",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-chats",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "ROOMS"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: `action-btn mobile-link-btn auth-only${mobilePersonalAgentEnabled ? '' : ' personal-ai-nav-hidden'}`,
            id: "open-personal-agent-btn-mobile",
            title: "Winston",
            "aria-label": "Open Winston",
            "aria-controls": "personal-ai-agent-panel",
            "aria-expanded": "false",
            hidden: !mobilePersonalAgentEnabled,
          },
          h("i", {
              className: "ph-bold ph-sparkle",
              "aria-hidden": "true",
            }),
          h("span", null, "WINSTON")
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-contacts-btn-mobile",
            "aria-label": "Open contacts",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-users",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "CONTACTS"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-vault-btn-mobile",
            "aria-label": "Open vault",
          },
          "\n                ",
          h("span", {
              className: "vault-rail-glyph",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "VAULT"
          ),
          "\n            "
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
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-bell",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "UPDATES"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            type: "button",
            className: "action-btn mobile-link-btn auth-only",
            id: "open-settings-btn-mobile",
            "aria-label": "Open settings",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-gear",
              "aria-hidden": "true",
            }),
          h(
            "span",
            null,
            "SETTINGS"
          ),
          "\n            "
        ),
        "\n        "
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
                "✖"
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
              "+ New room"
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
              h(
                "span",
                {
                  id: "active-room-name-display",
                  style: { fontWeight: "800", fontSize: "1.1rem", letterSpacing: "0.5px" },
                },
                "Global Chat"
              ),
              "\n                        ",
              h(
                "span",
                {
                  id: "active-room-tag",
                  className: "tier-badge advanced",
                },
                "PUBLIC"
              ),
              "\n                        ",
              h("i", {
                  className: "ph-bold ph-caret-down",
                  style: { fontSize: "1rem", color: "#888" },
                }),
              "\n                    "
            ),
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
                "☆ Favorite Room"
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
                title: "Add a page",
                type: "button",
                "aria-label": "Add a room page",
              },
              "+"
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
                "✖"
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
    h(UpdatesCenterShell),
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
          "✖"
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
    h(
      "div",
      {
        id: "pm-popup",
        className: "hidden",
        role: "dialog",
        "aria-modal": "true",
        "aria-hidden": "true",
        "aria-labelledby": "pm-target-name",
      },
      h("div", {
          id: "pm-dock-root",
        })
    ),
    "\n\n    ",
    h("div", {
        className: "modal-overlay hidden",
        id: "modal-overlay",
      }),
    "\n    \n    ",
    h(
      "div",
      {
        id: "settings-modal",
        className: "hidden brutalist-settings settings-shell-v3",
      },
      "\n        ",
      h(
        "button",
        {
          id: "close-settings-btn",
          className: "brutalist-close",
          title: "Close",
          "aria-label": "Close settings",
          type: "button",
        },
        h("i", {
          className: "ph-bold ph-x",
          "aria-hidden": "true",
        })
      ),
      "\n        ",
      h(
        "div",
        {
          className: "settings-sidebar",
        },
        "\n            ",
        h(
          "div",
          { className: "settings-sidebar-head" },
          h("span", { className: "settings-sidebar-kicker" }, "Minimalist"),
          h("strong", null, "Settings")
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tablist",
            role: "tablist",
            "aria-label": "Settings sections",
          },
          h(
            "button",
            {
              className: "settings-tab active",
              id: "tab-btn-profile",
              type: "button",
            },
            h("i", { className: "ph-bold ph-user-circle", "aria-hidden": "true" }),
            h("span", null, "My Account")
          ),
          h(
            "button",
            {
              className: "settings-tab",
              id: "tab-btn-billing",
              type: "button",
            },
            h("i", { className: "ph-bold ph-currency-circle-dollar", "aria-hidden": "true" }),
            h("span", null, "Billing")
          ),
          h(
            "button",
            {
              className: "settings-tab",
              id: "tab-btn-app",
              type: "button",
            },
            h("i", { className: "ph-bold ph-palette", "aria-hidden": "true" }),
            h("span", null, "Appearance")
          ),
          h(
            "button",
            {
              className: "settings-tab",
              id: "tab-btn-performance",
              type: "button",
            },
            h("i", { className: "ph-bold ph-gauge", "aria-hidden": "true" }),
            h("span", null, "Performance")
          ),
          h(
            "button",
            {
              className: "settings-tab",
              id: "tab-btn-notifications",
              type: "button",
            },
            h("i", { className: "ph-bold ph-bell", "aria-hidden": "true" }),
            h("span", null, "Notifications")
          )
        ),
        "\n            ",
        h("div", {
            className: "settings-divider",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "settings-session-actions",
          },
          h(
            "button",
            {
              className: "settings-session-btn settings-session-switch",
              id: "switch-user-btn",
              type: "button",
            },
            h("i", {
              className: "ph-bold ph-users-three",
            }),
            "Accounts"
          ),
          h(
            "button",
            {
              className: "settings-session-btn settings-session-logout",
              id: "logout-btn",
              type: "button",
            },
            h("i", {
              className: "ph-bold ph-sign-out",
            }),
            "Log Out"
          )
        ),
        "\n        "
      ),
      "\n\n        ",
      h(
        "div",
        {
          className: "settings-content",
        },
        "\n            ",
        h(
          "div",
          {
            className: "settings-pane active",
            id: "pane-profile",
          },
          "\n                ",
          h(
            "header",
            { className: "settings-pane-header" },
            h("span", { className: "settings-pane-kicker" }, "Account"),
            h(
              "h2",
              {
                id: "profile-pane-title",
              },
              "My Account"
            ),
            h(
              "p",
              { id: "profile-pane-description" },
              "Manage your identity, sign-in details, and public profile."
            )
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card settings-account-identity profile-view-section",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-header",
              },
              "\n                        ",
              h("img", {
                  id: "settings-photo-preview",
                  src: undefined,
                }),
              "\n                        ",
              h(
                  "div",
                  {
                    className: "settings-card-title",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "title-name",
                    id: "settings-display-name-title",
                  },
                  "User"
                ),
                h("span", { className: "settings-card-subtitle" }, "Your public identity"),
                "\n                        "
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "preview-profile-btn",
                  className: "action-btn settings-preview-trigger",
                  type: "button",
                  "aria-expanded": "false",
                  "aria-controls": "settings-profile-preview",
                },
                h("i", { className: "ph-bold ph-eye", "aria-hidden": "true" }),
                h("span", null, "Preview card")
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "account-session-actions profile-view-section",
            },
            h(
              "button",
              {
                id: "account-switch-user-btn",
                className: "account-session-action account-switch-action",
                type: "button",
              },
              h(
                "span",
                null,
                h("i", {
                  className: "ph-bold ph-users-three",
                }),
                "Accounts"
              ),
              h("i", {
                className: "ph-bold ph-arrow-right",
              })
            ),
            h(
              "button",
              {
                id: "account-logout-btn",
                className: "account-session-action account-logout-action",
                type: "button",
              },
              h(
                "span",
                null,
                h("i", {
                  className: "ph-bold ph-sign-out",
                }),
                "Log Out"
              ),
              h("i", {
                className: "ph-bold ph-arrow-right",
              })
            )
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "settings-card settings-account-details profile-view-section",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "div",
                { className: "settings-section-heading" },
                h("div", null,
                  h("h3", null, "Account details"),
                  h("p", null, "Private details used to secure your account.")
                )
              ),
              h(
                "div",
                { className: "settings-detail-list" },
                h(
                  "div",
                  { className: "settings-detail-row" },
                  h("i", { className: "ph-bold ph-calendar-blank", "aria-hidden": "true" }),
                  h("span", null, "Joined"),
                  h("strong", { id: "settings-joined-date" }, "Loading…")
                ),
                h(
                  "div",
                  { className: "settings-detail-row" },
                  h("i", { className: "ph-bold ph-envelope-simple", "aria-hidden": "true" }),
                  h("span", null, "Email"),
                  h("strong", { id: "settings-user-email" }, "Loading…")
                ),
                h(
                  "div",
                  { className: "settings-detail-row" },
                  h("i", { className: "ph-bold ph-phone", "aria-hidden": "true" }),
                  h("span", null, "Phone"),
                  h("strong", { id: "settings-user-phone" }, "Loading…")
                )
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "settings-card profile-view-section",
              id: "public-profile-card",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "div",
                { className: "settings-section-heading settings-public-profile-head" },
                "\n                            ",
                h(
                  "div",
                  null,
                  h("h3", null, "Public profile"),
                  h("p", null, "Control what people see when they open your card.")
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "toggle-edit-btn",
                    type: "button",
                    className: "settings-edit-profile-btn",
                  },
                  h("i", { className: "ph-bold ph-pencil-simple", "aria-hidden": "true" }),
                  "Edit profile"
                ),
                "\n                        "
              ),
              "\n                        ",
              h("div", {
                  id: "profile-completeness",
                  className: "profile-completeness",
                }),
              "\n                        ",
              h(
                "div",
                {
                  id: "profile-summary-compact",
                  className: "profile-summary-compact",
                },
                "\n                            ",
                h(
                  "div",
                  null,
                  h(
                    "span",
                    null,
                    "Name"
                  ),
                  h(
                    "strong",
                    {
                      id: "profile-summary-name",
                    },
                    "User"
                  )
                ),
                "\n                            ",
                h(
                  "div",
                  null,
                  h(
                    "span",
                    null,
                    "Status"
                  ),
                  h(
                    "strong",
                    {
                      id: "profile-summary-status",
                    },
                    "—"
                  )
                ),
                "\n                            ",
                h(
                  "div",
                  null,
                  h(
                    "span",
                    null,
                    "Pronouns"
                  ),
                  h(
                    "strong",
                    {
                      id: "profile-summary-pronouns",
                    },
                    "—"
                  )
                ),
                "\n                            ",
                h(
                  "div",
                  null,
                  h(
                    "span",
                    null,
                    "Flair"
                  ),
                  h(
                    "strong",
                    {
                      id: "profile-summary-flair",
                    },
                    "—"
                  )
                ),
                "\n                            ",
                h(
                  "p",
                  {
                    id: "profile-summary-bio",
                  },
                  "No bio yet."
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "settings-card hidden",
              id: "profile-edit-page",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "profile-edit-page-head",
                },
                "\n                            ",
                h(
                  "div",
                  null,
                  "\n                                ",
                  h(
                    "span",
                    {
                      className: "profile-edit-kicker",
                    },
                    "Public Profile"
                  ),
                  "\n                                ",
                  h(
                    "h3",
                    null,
                    "Edit Public Profile"
                  ),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "cancel-profile-edit-btn",
                    type: "button",
                    className: "action-btn",
                  },
                  "Back"
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  id: "profile-form-fields",
                  className: "profile-edit-card",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "DISPLAY NAME"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "text",
                      id: "edit-display-name",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "PRONOUNS"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "text",
                      id: "edit-pronouns",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "STATUS"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "text",
                      id: "edit-status",
                      maxLength: "80",
                      placeholder: "🟢 Available",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "ROLE / FLAIR"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "text",
                      id: "edit-flair",
                      maxLength: "24",
                      placeholder: "e.g. Designer, Mod",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "AVATAR IMAGE"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "file",
                      id: "edit-photo-file",
                      accept: "image/*",
                      style: { padding: "0.4rem" },
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "BANNER IMAGE"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "file",
                      id: "edit-banner-file",
                      accept: "image/*",
                      style: { padding: "0.4rem" },
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group profile-edit-wide",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "ABOUT ME"
                  ),
                  "\n                                ",
                  h("textarea", {
                      id: "edit-bio",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group profile-edit-wide",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "LINKS ",
                    h(
                      "span",
                      {
                        style: { fontWeight: "400", textTransform: "none" },
                      },
                      "(one per line: Label | https://url)"
                    )
                  ),
                  "\n                                ",
                  h("textarea", {
                      id: "edit-links",
                      placeholder: "GitHub | https://github.com/me",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "SKILLS ",
                    h(
                      "span",
                      {
                        style: { fontWeight: "400", textTransform: "none" },
                      },
                      "(comma separated)"
                    )
                  ),
                  "\n                                ",
                  h("input", {
                      type: "text",
                      id: "edit-skills",
                      placeholder: "JavaScript, Design, Writing",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "input-group",
                  },
                  "\n                                ",
                  h(
                    "label",
                    null,
                    "THEME COLOR"
                  ),
                  "\n                                ",
                  h("input", {
                      type: "color",
                      id: "edit-theme-color",
                      className: "color-input",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "profile-edit-actions",
                  },
                  "\n                                ",
                  h(
                    "button",
                    {
                      id: "update-profile-btn",
                      style: { marginTop: "1rem", width: "100%" },
                    },
                    "Save Changes"
                  ),
                  "\n                                ",
                  h(
                    "button",
                    {
                      id: "cancel-profile-edit-inline-btn",
                      type: "button",
                      className: "action-btn",
                    },
                    "Cancel"
                  ),
                  "\n                            "
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "settings-card settings-danger-card profile-view-section",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "div",
                { className: "settings-danger-copy" },
                h("i", { className: "ph-bold ph-shield-warning", "aria-hidden": "true" }),
                h(
                  "div",
                  null,
                  h("h3", null, "Danger zone"),
                  h("p", null, "Account deletion is permanent and cannot be undone.")
                )
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "delete-account-btn",
                  type: "button",
                  className: "settings-delete-account-btn",
                },
                "Delete account"
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n            "
        ),
        "\n\n            ",
        h(
          "div",
          {
            className: "settings-pane hidden",
            id: "pane-billing",
          },
          h(AccountBillingPanel)
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "settings-pane hidden",
            id: "pane-performance",
          },
          "\n                ",
          h(
            "header",
            { className: "settings-pane-header" },
            h("span", { className: "settings-pane-kicker" }, "Device"),
            h("h2", null, "Performance"),
            h("p", null, "Tune motion, rendering, and data use for this device.")
          ),
          "\n                ",
          h("div", {
            className: "performance-settings-root",
            id: "performance-settings-root",
          }),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "settings-pane hidden",
            id: "pane-app",
          },
          "\n                ",
          h(
            "header",
            { className: "settings-pane-header" },
            h("span", { className: "settings-pane-kicker" }, "Personalization"),
            h("h2", null, "Appearance"),
            h("p", null, "Choose how Minimalist looks and how much of the workspace is visible.")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card",
              style: { padding: "2rem" },
            },
            "\n                    ",
            h(
              "span",
              {
                style: { fontWeight: "700", fontSize: "1.2rem", display: "block", marginBottom: "1rem" },
              },
              "Theme Selection"
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "theme-selection-row",
                role: "radiogroup",
                "aria-label": "Theme selection",
                style: { display: "flex", gap: "1rem" },
              },
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "light",
                  type: "button",
                  style: { flex: "1", margin: "0" },
                },
                "Light ☀️"
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "dark",
                  type: "button",
                  style: { flex: "1", margin: "0" },
                },
                "Dark 🌙"
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "gray",
                  type: "button",
                  style: { flex: "1", margin: "0" },
                },
                "Gray ☁️"
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "modern",
                  type: "button",
                  style: { flex: "1", margin: "0" },
                },
                "Modern ✨"
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "codex",
                  type: "button",
                  style: { flex: "1", margin: "0" },
                },
                "Codex"
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "custom-theme-panel",
                id: "custom-theme-panel",
              },
              "\n                        ",
              h(
                "div",
                null,
                "\n                            ",
                h(
                  "span",
                  {
                    className: "custom-theme-title",
                  },
                  "Custom Accent Theme"
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    className: "custom-theme-note",
                    id: "custom-theme-note",
                  },
                  "Free for everyone — pick any accent color for this device."
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "custom-theme-controls",
                },
                "\n                            ",
                h("input", {
                    type: "color",
                    id: "custom-accent-color",
                    className: "color-input",
                    defaultValue: "#FFD700",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "action-btn",
                    id: "apply-custom-theme-btn",
                    type: "button",
                  },
                  "Apply"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "action-btn",
                    id: "reset-custom-theme-btn",
                    type: "button",
                  },
                  "Reset"
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                    ",
            renderFeatureModePanel(),
            "\n                    ",
            renderPersonalAiPreferencePanel(),
            "\n                "
          ),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "settings-pane hidden",
            id: "pane-notifications",
          },
          "\n                ",
          h(
            "header",
            { className: "settings-pane-header" },
            h("span", { className: "settings-pane-kicker" }, "Attention"),
            h("h2", null, "Notifications"),
            h("p", null, "Decide what can interrupt you and when.")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card settings-notifications-hero",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h("span", { className: "notif-settings-kicker" }, "Activity Center"),
              "\n                        ",
              h("h3", null, "Stay informed without the noise."),
              "\n                        ",
              h(
                "p",
                null,
                "Control room alerts, mentions, keyword alerts, digests, Do Not Disturb, schedules, and private-message push settings from one place."
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card notification-phone-card",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "notification-phone-head",
                },
                "\n                            ",
                h("span", null, h("i", { className: "ph-bold ph-device-mobile" }), " PM alerts"),
                "\n                            ",
                h("div", {
                    id: "notification-phone-alerts-slot",
                  }),
                "\n                        "
              ),
              "\n                        ",
              h(
                "p",
                null,
                "Enable browser/PWA alerts for private messages on this device. Mobile browsers will use the same setting when installed as an app."
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n                ",
          h("div", {
              id: "notification-settings-root",
              className: "notif-settings-root",
            }),
          "\n            "
        ),
        "\n        "
      ),
      "\n        ",
      h(
        "aside",
        {
          id: "settings-profile-preview",
          className: "settings-preview-rail hidden",
          role: "region",
          "aria-labelledby": "settings-preview-title",
          "aria-hidden": "true",
        },
        h(
          "header",
          { className: "settings-preview-header" },
          h(
            "div",
            null,
            h("span", { className: "settings-preview-kicker" }, "Live card"),
            h("h2", { id: "settings-preview-title" }, "Profile preview"),
            h("p", null, "This is how your profile appears to other people.")
          ),
          h(
            "button",
            {
              id: "close-settings-preview-btn",
              className: "settings-preview-close",
              type: "button",
              "aria-label": "Back to My Account",
            },
            h("i", { className: "ph-bold ph-arrow-left settings-preview-back-icon", "aria-hidden": "true" }),
            h("i", { className: "ph-bold ph-x settings-preview-x-icon", "aria-hidden": "true" }),
            h("span", null, "Back to account")
          )
        ),
        h(
          "div",
          { className: "settings-preview-body" },
          h("div", {
            id: "settings-card-inline-preview",
            className: "settings-preview-card-host",
            "aria-live": "polite",
          }),
          h(
            "p",
            { className: "settings-preview-note" },
            h("i", { className: "ph-bold ph-eye", "aria-hidden": "true" }),
            " Changes to your public profile will appear here."
          )
        )
      ),
      " \n    "
    ),
    " \n\n    ",
    h(
      "div",
      {
        id: "user-profile-popup",
        className: "hidden",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "up-name",
        "aria-hidden": "true",
        "aria-busy": "false",
        tabIndex: -1,
        onKeyDown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeUserProfileDialog();
          }
        },
      },
      "\n        ",
      h(
        "button",
        {
          className: "profile-popup-close",
          id: "close-user-profile-btn",
          type: "button",
          "aria-label": "Close profile",
          title: "Close profile",
          onClick: closeUserProfileDialog,
        },
        h("i", {
          className: "ph-bold ph-x",
          "aria-hidden": "true",
        })
      ),
      "\n        ",
      h(
        "div",
        {
          className: "profile-banner",
          id: "up-banner",
        },
        "\n            ",
        h(
          "button",
          {
            className: "profile-popup-more",
            id: "more-profile-btn",
            type: "button",
            "aria-label": "Open profile actions",
          },
          h("i", {
              className: "ph-bold ph-dots-three",
              "aria-hidden": "true",
            })
        ),
        "\n            ",
        h(
          "div",
          {
            id: "profile-more-dropdown",
            className: "hidden brutalist-dropdown",
          },
          "\n                ",
          h(
            "button",
            {
              id: "up-mute-btn",
              style: { fontWeight: "600" },
            },
            "Mute User"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "up-remove-friend-btn",
              className: "danger-btn",
            },
            "Remove Friend"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            className: "profile-avatar-wrapper",
          },
          "\n                ",
          h("img", {
              id: "up-avatar",
              src: undefined,
              alt: "Avatar",
            }),
          "\n                ",
          h("span", {
              className: "up-presence status-dot",
              id: "up-presence",
              title: "",
            }),
          "\n            "
        ),
        "\n        "
      ),
      "\n        ",
      h(
        "div",
        {
          className: "profile-content",
        },
        "\n            ",
        h(
          "div",
          {
            className: "profile-name-row",
          },
          "\n                ",
          h(
            "span",
            {
              className: "profile-display-name",
              id: "up-name",
            }
          ),
          "\n                ",
          h(
            "span",
            {
              className: "profile-pronouns",
              id: "up-pronouns",
            },
            "Pronouns"
          ),
          "\n                ",
          h("span", {
              className: "profile-flair",
              id: "up-flair",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            style: { marginTop: "-5px", marginBottom: "10px" },
          },
          "\n                ",
          h(
            "span",
            {
              className: "profile-short-id",
              id: "up-shortid",
            },
            "#000000"
          ),
          "\n            "
        ),
        "\n            ",
        h("div", {
            className: "profile-status",
            id: "up-status",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "profile-bio",
            id: "up-bio",
          },
          "Bio goes here..."
        ),
        "\n            ",
        h("div", {
            className: "profile-links",
            id: "up-links",
          }),
        "\n            ",
        h("div", {
            className: "profile-skills",
            id: "up-skills",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "profile-section-label",
          },
          "Skill Trees"
        ),
        "\n            ",
        h("div", {
            className: "profile-skilltree",
            id: "up-skilltree",
          }),
        "\n            ",
        h("div", {
            className: "profile-badges",
            id: "up-badges",
          }),
        "\n            ",
        h("div", {
            className: "profile-rep",
            id: "up-rep",
          }),
        "\n            ",
        h("div", {
            className: "profile-follow-stats",
            id: "up-follow-stats",
          }),
        "\n            ",
        h("div", {
            className: "profile-mutual",
            id: "up-mutual",
          }),
        "\n            ",
        h("div", {
            className: "profile-spotlight",
            id: "up-spotlight",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "profile-activity-wrap",
            id: "up-activity-wrap",
          },
          "\n                ",
          h(
            "div",
            {
              className: "profile-section-label",
            },
            "Activity"
          ),
          "\n                ",
          h("div", {
              className: "profile-heatmap",
              id: "up-heatmap",
            }),
          "\n                ",
          h("ul", {
              className: "profile-activity",
              id: "up-activity",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            className: "profile-joined-date",
            id: "up-joined",
          },
          "Joined: Loading..."
        ),
        "\n            ",
        h(
          "div",
          {
            className: "profile-actions",
          },
          "\n                ",
          h(
            "button",
            {
              id: "up-message-btn",
            },
            "Message"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "up-follow-btn",
              className: "up-follow",
            },
            "Follow"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "up-kudos-btn",
              className: "up-kudos",
            },
            h("i", {
                className: "ph-bold ph-hand-heart",
              }),
            " Kudos ",
            h(
              "span",
              {
                id: "up-kudos-count",
              },
              "0"
            )
          ),
          "\n                ",
          h(
            "button",
            {
              id: "up-share-btn",
              className: "up-share",
              title: "Copy profile link",
            },
            h("i", {
                className: "ph-bold ph-link",
              })
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "admin-dashboard-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "6000", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
        h(
          "div",
          {
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "400px", padding: "2rem", textAlign: "center" },
        },
        "\n            ",
        h(
          "h2",
          {
            style: { borderBottom: "4px solid red", paddingBottom: "0.5rem", color: "red", marginTop: "0" },
          },
          "RESTRICTED: ADMIN"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "input-group mt-1",
            style: { textAlign: "left" },
          },
          "\n                ",
          h(
            "label",
            null,
            "TARGET USER ID (UID)"
          ),
          "\n                ",
          h("input", {
              type: "text",
              id: "admin-target-id",
              placeholder: "Enter precise UID...",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "1rem", marginTop: "1rem" },
          },
          "\n                ",
          h(
            "button",
            {
              id: "admin-mute-btn",
              style: { background: "#FF9800", color: "#000", borderColor: "#000", flex: "1" },
            },
            "Mute 24h"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "admin-ban-btn",
              style: { background: "red", color: "white", borderColor: "#000", flex: "1" },
            },
            "Permaban"
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            id: "admin-wipe-btn",
            style: { background: "transparent", color: "var(--text-color)", marginTop: "2rem" },
          },
          "Wipe Ghost Connections"
        ),
        "\n            ",
        h(
          "button",
          {
            id: "close-admin-dashboard-btn",
            style: { background: "var(--text-color)", color: "var(--bg-color)", marginTop: "0.5rem" },
          },
          "Close Dashboard"
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n    ",
    h(
      "div",
      {
        id: "room-action-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "6000", display: "flex", justifyContent: "center", alignItems: "center" },
        role: "presentation",
        "aria-hidden": "true",
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card room-action-card",
          id: "room-action-card",
          style: { width: "90%", maxWidth: "520px", padding: "2rem", textAlign: "left" },
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "room-action-title",
          "aria-describedby": "room-action-subtitle",
        },
        "\n            ",
        h(
          "h2",
          {
            id: "room-action-title",
            style: { borderBottom: "4px solid var(--text-color)", paddingBottom: "0.5rem", marginTop: "0" },
          },
          "Join Room"
        ),
        "\n            ",
        h(
          "p",
          {
            id: "room-action-subtitle",
            className: "room-action-subtitle",
          },
          "Paste a room link or invite code."
        ),
        h(
          "button",
          {
            id: "close-room-action-btn",
            className: "room-action-close",
            type: "button",
            "aria-label": "Close room dialog",
          },
          h("i", { className: "ph-bold ph-x", "aria-hidden": "true" })
        ),
        "\n            ",
        h(
          "div",
          {
            id: "room-join-fields",
            className: "input-group mt-1",
            style: { textAlign: "left" },
          },
          "\n                ",
          h(
            "label",
            {
              id: "room-action-label",
            },
            "ROOM ID"
          ),
          "\n                ",
          h("input", {
              type: "text",
              id: "room-action-input",
              placeholder: "Enter Room ID...",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            id: "create-room-wizard",
            className: "hidden room-create-wizard",
          },
          "\n                ",
          h(
            "div",
            {
              className: "room-create-progress",
            },
            "\n                    ",
            h("span", { id: "room-create-step-label" }, "Step 1 of 2"),
            "\n                    ",
            h("span", { id: "room-create-type-pill" }, "Choose room type"),
            "\n                "
          ),
          "\n                ",
          h(
            "div",
            {
              id: "room-create-type-step",
              className: "room-create-step",
            },
            "\n                    ",
                h(
                  "button",
                  {
                    type: "button",
                    className: "room-type-option",
                    "data-room-type": "friends",
                    "aria-pressed": "false",
              },
              "\n                        ",
              h("i", { className: "ph-bold ph-users-three" }),
              "\n                        ",
              h(
                "span",
                null,
                "Friends group"
              ),
              "\n                        ",
              h(
                "small",
                null,
                "A cozy room for friends, family, classmates, or small squads."
              ),
              "\n                    "
            ),
            "\n                    ",
                h(
                  "button",
                  {
                    type: "button",
                    className: "room-type-option",
                    "data-room-type": "community",
                    "aria-pressed": "false",
              },
              "\n                        ",
              h("i", { className: "ph-bold ph-planet" }),
              "\n                        ",
              h(
                "span",
                null,
                "Community"
              ),
              "\n                        ",
              h(
                "small",
                null,
                "A discoverable room for clubs, creators, teams, and shared interests."
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n                ",
          h(
            "div",
            {
              id: "room-create-details-step",
              className: "hidden room-create-step",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "input-group",
              },
              "\n                        ",
              h(
                "label",
                {
                  htmlFor: "create-room-name-input",
                },
                "ROOM NAME"
              ),
              "\n                        ",
              h("input", {
                  type: "text",
                  id: "create-room-name-input",
                  maxLength: "42",
                  placeholder: "Morning Rituals, Study Room, Project Team...",
                }),
              h(
                "div",
                { className: "room-name-meta" },
                h("span", null, "Keep it clear and recognizable."),
                h("span", { id: "create-room-name-count" }, "0 / 42")
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "input-group",
              },
              "\n                        ",
              h(
                "label",
                null,
                "ROOM PICTURE"
              ),
              "\n                        ",
              h(
                "label",
                {
                  className: "room-picture-picker",
                  htmlFor: "create-room-picture-input",
                },
                "\n                            ",
                h(
                  "span",
                  {
                    id: "create-room-picture-preview",
                    className: "room-picture-preview",
                  },
                  h("i", { className: "ph-bold ph-image" })
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    className: "room-picture-picker-copy",
                  },
                  "\n                                ",
                  h("strong", null, "Add an optional picture"),
                  "\n                                ",
                  h("small", null, "Square images work best. Max 5MB."),
                  "\n                            "
                ),
                "\n                        "
              ),
              "\n                        ",
              h("input", {
                  type: "file",
                  id: "create-room-picture-input",
                  accept: "image/*",
                  className: "hidden",
                }),
              "\n                    "
            ),
            h(
              "section",
              { className: "room-create-privacy", "aria-label": "Room privacy" },
              h("i", { id: "room-create-privacy-icon", className: "ph-bold ph-lock-key" }),
              h(
                "div",
                null,
                h("strong", null, "Privacy"),
                h("span", { id: "room-create-privacy-copy" }, "Private · invited people only")
              )
            ),
            h(
              "section",
              { className: "room-create-review", "aria-label": "Room preview" },
              h(
                "div",
                { className: "room-create-review-heading" },
                h("span", null, "Preview"),
                h("small", null, "Ready to create")
              ),
              h(
                "div",
                { className: "room-create-review-card" },
                h(
                  "span",
                  { id: "room-create-review-avatar", className: "room-create-review-avatar" },
                  h("i", { className: "ph-bold ph-chats" })
                ),
                h(
                  "div",
                  null,
                  h("strong", { id: "room-create-preview-name" }, "Your room name"),
                  h("span", { id: "room-create-preview-type" }, "Choose a room type")
                )
              )
            ),
            "\n                "
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "footer",
          { className: "room-action-footer" },
          h(
            "button",
            { id: "room-action-cancel-btn", className: "room-action-secondary", type: "button" },
            "Cancel"
          ),
          h(
            "div",
            { className: "room-action-footer-end" },
            h(
              "button",
              { id: "room-create-back-btn", className: "hidden room-action-secondary", type: "button" },
              h("i", { className: "ph-bold ph-arrow-left" }),
              "Back"
            ),
            h(
              "button",
              { id: "room-action-submit", className: "room-action-primary", type: "button" },
              "Join"
            )
          )
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "room-settings-modal",
        className: "hidden modal-overlay room-settings-overlay room-settings-overlay-v2",
        style: { zIndex: "6000", display: "flex", justifyContent: "center", alignItems: "center" },
        role: "presentation",
        "aria-hidden": "true",
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card room-settings-card room-settings-modern room-settings-v2",
          id: "room-settings-card",
          style: { width: "90%", maxWidth: "700px", height: "70vh", padding: "0", textAlign: "left", display: "flex", flexDirection: "row", overflow: "hidden", background: "var(--bg-color)" },
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "room-settings-title",
          "aria-describedby": "room-settings-room-meta",
        },
        "\n            ",
        h(
          "header",
          { className: "room-settings-header" },
          h("div", {
            id: "rs-room-settings-picture",
            className: "room-settings-header-picture",
            "aria-hidden": "true",
          }, h("i", { className: "ph-bold ph-chats" })),
          h(
            "div",
            { className: "room-settings-heading" },
            h("p", { className: "room-settings-eyebrow" }, "Room settings"),
            h("h1", { id: "room-settings-title" }, "Room settings"),
            h(
              "p",
              { id: "room-settings-room-meta", className: "room-settings-room-meta" },
              h("span", { id: "rs-room-settings-name" }, "Room"),
              h("span", { "aria-hidden": "true" }, "·"),
              h("span", { id: "rs-room-settings-privacy" }, "Private room")
            )
          ),
          h(
            "span",
            {
              id: "rs-room-settings-status",
              className: "room-settings-status",
              role: "status",
              "aria-live": "polite",
            },
            "Ready"
          )
        ),
        "\n            ",
        h(
          "button",
          {
            id: "close-room-settings-x",
            className: "room-settings-x",
            type: "button",
            "aria-label": "Close room settings",
          },
          h("i", {
              className: "ph-bold ph-x",
            })
        ),
        "\n            \n            ",
        h(
          "nav",
          {
            className: "settings-sidebar",
            style: { width: "30%", minWidth: "180px", padding: "1.5rem", borderRight: "4px solid var(--text-color)" },
            "aria-label": "Room settings sections",
          },
          "\n                \n                ",
          h(
            "p",
            {
              className: "sidebar-header",
              style: { fontSize: "0.9rem" },
            },
            "ROOM SETTINGS"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tablist",
              role: "tablist",
              "aria-orientation": "vertical",
            },
          h(
            "button",
            {
              className: "settings-tab active",
              id: "rs-tab-overview",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "true",
              "aria-controls": "rs-pane-overview",
              tabIndex: 0,
            },
            h("i", { className: "ph-bold ph-squares-four" }),
            h("span", null, "Overview")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-members",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-members",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-users-three" }),
            h("span", null, "Members")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-channels",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-channels",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-hash" }),
            h("span", null, "Channels")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-permissions",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-permissions",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-shield-check" }),
            h("span", null, "Permissions")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-webhooks",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-webhooks",
              "aria-label": "Apps and integrations",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-plugs-connected" }),
            h("span", null, "Apps")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-subscription",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-subscription",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-currency-circle-dollar" }),
            h("span", null, "Subscription")
          ),
          "\n                ",
          h(
            "button",
            {
              className: "settings-tab",
              id: "rs-tab-logs",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
              type: "button",
              role: "tab",
              "aria-selected": "false",
              "aria-controls": "rs-pane-logs",
              tabIndex: -1,
            },
            h("i", { className: "ph-bold ph-clock-counter-clockwise" }),
            h("span", null, "Audit Logs")
          )),
          "\n                \n                ",
          h("div", {
              style: { flexGrow: "1" },
            }),
          "\n                \n                ",
          h("div", {
              className: "settings-divider",
            }),
          "\n                ",
          h(
            "button",
            {
              id: "rs-delete-room-btn",
              className: "mini-btn danger hidden",
              style: { width: "100%", padding: "0.8rem", marginBottom: "0.5rem", border: "2px solid red" },
              type: "button",
            },
            "Delete Room"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "rs-leave-room-btn",
              className: "mini-btn danger hidden",
              style: { width: "100%", padding: "0.8rem", marginBottom: "0.5rem", border: "2px solid red" },
              type: "button",
            },
            "Leave Room"
          ),
          "\n\n                ",
          h(
            "button",
            {
              id: "close-room-settings-btn",
              className: "mini-btn",
              style: { width: "100%", padding: "0.8rem", background: "transparent", color: "var(--text-color)", border: "2px solid var(--text-color)" },
              type: "button",
            },
            "Close Menu"
          ),
          "\n            "
        ),
        "\n\n            ",
        h(
          "div",
          {
            className: "room-settings-content",
            style: { flex: "1", padding: "2rem", overflowY: "auto" },
          },
          "\n                ",
          h(
            "div",
            {
              id: "rs-pane-overview",
              className: "rs-pane",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-overview",
              "aria-hidden": "false",
              tabIndex: 0,
            },
            "\n                    ",
            h(
              "div",
              {
                className: "rs-room-picture-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-room-picture-preview",
                  id: "rs-room-picture-preview",
                  "aria-hidden": "true",
                },
                h("i", {
                    className: "ph-bold ph-chats",
                  })
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-room-picture-body",
                },
                "\n                            ",
                h(
                  "h2",
                  null,
                  "Room Picture"
                ),
                "\n                            ",
                h(
                  "p",
                  {
                    id: "rs-room-picture-help",
                  },
                  "Add a square image for the collapsed room rail. Global Chat uses the built-in globe."
                ),
                "\n                            ",
                h("input", {
                    type: "file",
                    id: "rs-room-picture-input",
                    accept: "image/*",
                    "aria-label": "Choose a room picture",
                  }),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rs-room-picture-actions",
                  },
                  h(
                    "button",
                    {
                      id: "rs-save-room-picture-btn",
                      className: "mini-btn",
                      type: "button",
                    },
                    "Save Picture"
                  ),
                  h(
                    "button",
                    {
                      id: "rs-remove-room-picture-btn",
                      className: "mini-btn danger",
                      type: "button",
                    },
                    "Remove"
                  )
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "rs-room-identity-card",
              },
              "\n                        ",
              h(
                "h2",
                null,
                "Room Identity"
              ),
              "\n                        ",
              h(
                "p",
                null,
                "Control the room banner, description, topic, category, discovery, recommendations, and template."
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-banner-preview",
                  id: "rs-room-banner-preview",
                },
                h("i", {
                    className: "ph-bold ph-image",
                  }),
                h("span", null, "Room banner")
              ),
              "\n                        ",
              h("input", {
                  type: "file",
                  id: "rs-room-banner-input",
                  accept: "image/*",
                  "aria-label": "Choose a room banner",
                }),
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-room-picture-actions",
                },
                h(
                  "button",
                  {
                    id: "rs-save-room-banner-btn",
                    className: "mini-btn",
                    type: "button",
                  },
                  "Save Banner"
                ),
                h(
                  "button",
                  {
                    id: "rs-remove-room-banner-btn",
                    className: "mini-btn danger",
                    type: "button",
                  },
                  "Remove Banner"
                )
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-identity-grid",
                },
                h(
                  "label",
                  null,
                  "Description",
                  h("textarea", {
                      id: "rs-room-description-input",
                      rows: 3,
                      placeholder: "What is this room for?",
                    })
                ),
                h(
                  "label",
                  null,
                  "Topic",
                  h("input", {
                      id: "rs-room-topic-input",
                      maxLength: "90",
                      placeholder: "This week: launch planning, finals week, raid night...",
                    })
                ),
                h(
                  "label",
                  null,
                  "Category",
                  h("input", {
                      id: "rs-room-category-input",
                      maxLength: "36",
                      placeholder: "Study, Gaming, Team, Creator...",
                    })
                ),
                h(
                  "label",
                  null,
                  "Template",
                  h(
                    "select",
                    {
                      id: "rs-room-template-select",
                    },
                    h("option", { value: "blank" }, "Blank room"),
                    h("option", { value: "study" }, "Study room"),
                    h("option", { value: "creator" }, "Creator community"),
                    h("option", { value: "project" }, "Project team"),
                    h("option", { value: "support" }, "Support group"),
                    h("option", { value: "gaming" }, "Gaming group"),
                    h("option", { value: "club" }, "Club hub")
                  )
                )
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "rs-toggle-row",
                },
                h(
                  "label",
                  null,
                  h("input", {
                      type: "checkbox",
                      id: "rs-room-discoverable",
                    }),
                  " Room discovery"
                ),
                h(
                  "label",
                  null,
                  h("input", {
                      type: "checkbox",
                      id: "rs-room-recommendations",
                    }),
                  " Room recommendations"
                )
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "rs-save-room-identity-btn",
                  className: "action-btn",
                  style: { width: "100%" },
                  type: "button",
                },
                "Save Room Identity"
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              id: "rs-pane-members",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-members",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            "\n                    ",
            h(
              "h2",
              {
                style: { borderBottom: "3px solid var(--text-color)", paddingBottom: "0.5rem", marginBottom: "1rem" },
              },
              "Member List"
            ),
            "\n                    ",
            h("ul", {
                id: "rs-members-list",
                style: { listStyle: "none", padding: "0", display: "flex", flexDirection: "column", gap: "0.5rem" },
              }),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              id: "rs-pane-channels",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-channels",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            "\n                    ",
            h(
              "h2",
              {
                style: { borderBottom: "3px solid var(--text-color)", paddingBottom: "0.5rem", marginBottom: "1rem" },
              },
              "Channels"
            ),
            "\n                    ",
            h(
              "p",
              {
                style: { fontSize: "0.9rem", fontWeight: "600", color: "#666", marginBottom: "1rem" },
              },
              "Create focused chat channels inside this room. #general keeps the original room chat."
            ),
            "\n                    ",
            h("ul", {
                id: "rs-channel-list",
                className: "rs-simple-list",
              }),
            "\n                    ",
            h(
              "div",
              {
                className: "input-group",
                style: { marginTop: "1rem" },
              },
              "\n                        ",
              h(
                "label",
                { htmlFor: "rs-channel-input" },
                "NEW CHANNEL NAME"
              ),
              "\n                        ",
              h("input", {
                  type: "text",
                  id: "rs-channel-input",
                  placeholder: "design, announcements, bugs...",
                }),
              "\n                    "
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "rs-add-channel-btn",
                className: "action-btn",
                style: { width: "100%" },
                type: "button",
              },
              "Add Channel"
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              id: "rs-pane-permissions",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-permissions",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            h(RoomPermissionsPanel, null)
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-webhooks",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-webhooks",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            h(RoomAppsPanel, null)
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-subscription",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-subscription",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            h(RoomSubscriptionPanel, null)
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-logs",
              className: "rs-pane hidden",
              role: "tabpanel",
              "aria-labelledby": "rs-tab-logs",
              "aria-hidden": "true",
              tabIndex: 0,
            },
            "\n                    ",
            h(
              "h2",
              {
                style: { borderBottom: "3px solid var(--text-color)", paddingBottom: "0.5rem", marginBottom: "1rem" },
              },
              "Audit Logs"
            ),
            "\n                    ",
            h("ul", {
                id: "rs-logs-list",
                style: { listStyle: "none", padding: "0", display: "flex", flexDirection: "column", gap: "0.5rem" },
              }),
            "\n                "
          ),
          "\n            "
        ),
        "\n            \n        "
      ),
      "\n    "
    ),
    "\n    ",
    h(
      "div",
      {
        id: "leave-room-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "7000", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "400px", padding: "2rem", textAlign: "center" },
        },
        "\n            ",
        h(
          "h2",
          {
            style: { borderBottom: "4px solid var(--text-color)", paddingBottom: "0.5rem", marginTop: "0" },
          },
          "Leave Room"
        ),
        "\n            ",
        h(
          "p",
          {
            style: { margin: "1.5rem 0", fontWeight: "600", fontSize: "1.1rem" },
          },
          "Are you sure you want to leave this room?"
        ),
        "\n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "1rem", marginTop: "1rem" },
          },
          "\n                ",
          h(
            "button",
            {
              id: "cancel-leave-btn",
              className: "action-btn",
              style: { flex: "1", margin: "0", padding: "0.8rem", boxShadow: "none" },
            },
            "Cancel"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "confirm-leave-btn",
              style: { background: "var(--text-color)", color: "var(--bg-color)", border: "2px solid var(--text-color)", flex: "1", padding: "0.8rem", margin: "0", fontWeight: "bold" },
            },
            "Leave"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "delete-room-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "7000", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "400px", padding: "2rem", textAlign: "center" },
        },
        "\n            ",
        h(
          "h2",
          {
            style: { borderBottom: "4px solid red", paddingBottom: "0.5rem", marginTop: "0", color: "red" },
          },
          "Delete Room"
        ),
        "\n            ",
        h(
          "p",
          {
            style: { margin: "1rem 0", fontWeight: "600", fontSize: "0.95rem" },
          },
          "This action is permanent. Type ",
          h(
            "strong",
            {
              style: { color: "red" },
            },
            "confirm"
          ),
          " to proceed."
        ),
        "\n            ",
        h("input", {
            type: "text",
            id: "delete-room-input",
            placeholder: "Type confirm...",
            style: { width: "100%", textAlign: "center", fontWeight: "bold", padding: "0.8rem", border: "3px solid var(--text-color)" },
          }),
        "\n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "1rem", marginTop: "1rem" },
          },
          "\n                ",
          h(
            "button",
            {
              id: "cancel-delete-btn",
              className: "action-btn",
              style: { flex: "1", margin: "0", padding: "0.8rem", boxShadow: "none" },
            },
            "Cancel"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "confirm-delete-btn",
              style: { background: "red", color: "white", border: "2px solid var(--text-color)", flex: "1", padding: "0.8rem", margin: "0", fontWeight: "bold" },
            },
            "Delete"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "custom-context-menu",
        className: "hidden brutalist-dropdown",
        style: { position: "fixed", zIndex: "10000", minWidth: "160px" },
      },
      "\n        ",
      h(
        "button",
        {
          id: "ctx-mute-btn",
          style: { fontWeight: "600" },
        },
        "Mute User"
      ),
      "\n        ",
      h(
        "button",
        {
          id: "ctx-friend-btn",
          style: { fontWeight: "600" },
        },
        "Add Friend"
      ),
      "\n        ",
      h(
        "button",
        {
          id: "ctx-copy-btn",
          style: { fontWeight: "600" },
        },
        "Copy User ID"
      ),
      "\n    "
    ),
    "\n    ",
    h(
      "div",
      {
        id: "mute-user-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "7500", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "400px", padding: "2rem", textAlign: "center" },
        },
        "\n            ",
        h(
          "h2",
          {
            style: { borderBottom: "4px solid var(--text-color)", paddingBottom: "0.5rem", marginTop: "0" },
          },
          "Mute User"
        ),
        "\n            ",
        h(
          "p",
          {
            style: { margin: "1rem 0", fontWeight: "600" },
          },
          "Select mute duration for ",
          h(
            "span",
            {
              id: "mute-target-name",
            },
            "User"
          ),
          ":"
        ),
        "\n            \n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "0.5rem", marginBottom: "1rem", justifyContent: "center" },
          },
          "\n                ",
          h(
            "button",
            {
              className: "mini-btn outline mute-duration-btn",
              "data-time": "5",
            },
            "5m"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "mini-btn outline mute-duration-btn",
              "data-time": "15",
            },
            "15m"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "mini-btn outline mute-duration-btn",
              "data-time": "60",
            },
            "1h"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "mini-btn outline mute-duration-btn",
              "data-time": "1440",
            },
            "24h"
          ),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "input-group",
            style: { textAlign: "left" },
          },
          "\n                ",
          h(
            "label",
            null,
            "CUSTOM TIME (MINUTES)"
          ),
          "\n                ",
          h("input", {
              type: "number",
              id: "mute-custom-time",
              placeholder: "e.g. 30",
              min: "1",
              style: { width: "100%" },
            }),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "1rem", marginTop: "1.5rem" },
          },
          "\n                ",
          h(
            "button",
            {
              id: "cancel-mute-btn",
              className: "action-btn",
              style: { flex: "1", margin: "0", padding: "0.8rem", boxShadow: "none" },
            },
            "Cancel"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "confirm-mute-btn",
              style: { background: "red", color: "white", border: "2px solid var(--text-color)", flex: "1", padding: "0.8rem", margin: "0", fontWeight: "bold" },
            },
            "Mute"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n    ",
    h("div", {
        id: "emoji-picker",
        className: "hidden",
      }),
    "\n\n    ",
    "\n    ",
    h(
      "div",
      {
        id: "search-modal",
        className: "hidden",
      },
      "\n        ",
      h(
        "div",
        {
          className: "search-box",
        },
        "\n            ",
        h(
          "div",
          {
            className: "search-input-row",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-magnifying-glass",
            }),
          "\n                ",
          h("input", {
              type: "text",
              id: "global-search-input",
              placeholder: "Search messages, rooms, people...",
              autoComplete: "off",
            }),
          "\n                ",
          h(
            "button",
            {
              id: "close-search-btn",
              type: "button",
              "aria-label": "Close search",
            },
            "✖"
          ),
          "\n            "
        ),
        "\n            ",
        h("div", {
            id: "search-results",
          }),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    "\n    ",
    h(
      "div",
      {
        id: "welcome-tour",
        className: "hidden",
      },
      "\n        ",
      h(
        "div",
        {
          className: "wt-card",
        },
        "\n            ",
        h(
          "div",
          {
            className: "wt-emoji",
            id: "wt-emoji",
          },
          "👋"
        ),
        "\n            ",
        h(
          "h2",
          {
            id: "wt-title",
          },
          "Welcome to Rooms!"
        ),
        "\n            ",
        h("p", {
            id: "wt-text",
          }),
        "\n            ",
        h("div", {
            className: "wt-dots",
            id: "wt-dots",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "wt-actions",
          },
          "\n                ",
          h(
            "button",
            {
              type: "button",
              id: "wt-skip",
              className: "wt-skip",
            },
            "Skip"
          ),
          "\n                ",
          h(
            "button",
            {
              type: "button",
              id: "wt-next",
              className: "wt-next",
            },
            "Take a quick tour"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
    "\n\n    ",
    "\n    ",
    h(
      "div",
      {
        id: "delete-account-modal",
        className: "hidden modal-overlay",
        style: { zIndex: "6500", display: "flex", alignItems: "center", justifyContent: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "420px", padding: "2rem", textAlign: "center" },
        },
        "\n            ",
        h(
          "div",
          {
            style: { fontSize: "2.5rem", lineHeight: "1" },
          },
          "⚠️"
        ),
        "\n            ",
        h(
          "h2",
          {
            style: { margin: "0.4rem 0 0.3rem", color: "red" },
          },
          "Delete Account?"
        ),
        "\n            ",
        h(
          "p",
          {
            style: { fontWeight: "600", color: "#666" },
          },
          "This permanently deletes your account and profile. You'll be signed out immediately. This can't be undone."
        ),
        "\n            ",
        h(
          "div",
          {
            className: "input-group",
            style: { textAlign: "left", marginTop: "1rem" },
          },
          "\n                ",
          h(
            "label",
            null,
            "Type ",
            h(
              "strong",
              null,
              "DELETE"
            ),
            " to confirm"
          ),
          "\n                ",
          h("input", {
              type: "text",
              id: "delete-confirm-input",
              placeholder: "DELETE",
              autoComplete: "off",
            }),
          "\n            "
        ),
        "\n            ",
        h(
          "div",
          {
            style: { display: "flex", gap: "1rem", marginTop: "1rem" },
          },
          "\n                ",
          h(
            "button",
            {
              id: "delete-cancel-btn",
              style: { flex: "1", background: "transparent", color: "var(--text-color)", border: "3px solid var(--text-color)", boxShadow: "none", margin: "0" },
            },
            "Cancel"
          ),
          "\n                ",
          h(
            "button",
            {
              id: "delete-confirm-btn",
              style: { flex: "1", background: "red", color: "#fff", border: "3px solid #000", boxShadow: "none", margin: "0" },
            },
            "Delete Forever"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n    "
    ),
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
        "span",
        {
          id: "toast-icon",
        },
        "⚠️"
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
        "✖"
      ),
      "\n    "
    ),
    "\n"
  );
}

export default function ChatPage() {
  const bootFailure = useChatBoot();
  useRoomNavMotion();
  useEffect(() => initModernThemeMotion(), []);
  return h('div', { className: 'react-page chat-react-page' }, renderChatShell(bootFailure, loadPersonalAgentPreferences()));
}
