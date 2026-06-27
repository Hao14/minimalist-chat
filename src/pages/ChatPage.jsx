import { Fragment, createElement, useEffect } from 'react';
import { initModernThemeMotion } from '../features/shell/modernThemeMotion.js';

const h = createElement;

function renderLazyRoomView(view, extraClassName = 'hidden') {
  return h(
    "div",
    {
      id: `room-view-${view}`,
      className: `room-view ${extraClassName}`.trim(),
      "data-deferred-room-view": view,
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

function loadConfigScript() {
  return new Promise((resolve) => {
    document.querySelector('script[data-minimalist-config]')?.remove();
    const script = document.createElement('script');
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    script.dataset.minimalistConfig = 'true';
    script.async = false;
    script.onload = finish;
    script.onerror = finish;
    script.src = '/config.js?v=6';
    document.body.appendChild(script);
    window.setTimeout(finish, 1500);
  });
}

function useChatBoot() {
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
      const user = auth.currentUser || await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
          unsubscribe();
          resolve(currentUser);
        });
      });

      if (cancelled) return;

      if (!user) {
        if (window.location.pathname.startsWith('/join/')) {
          sessionStorage.setItem('pendingJoinUrl', `${window.location.pathname}${window.location.search}${window.location.hash}`);
        }
        window.location.replace('/login');
        return;
      }

      if (!window.GCAL_CLIENT_ID || !window.STRIPE_CHECKOUT_ENDPOINT) await loadConfigScript();
      if (!cancelled) {
        await import('../features/shell/chatApp.js');
        window.requestAnimationFrame(() => window.hydrateRoomCollapsePreference?.());
      }
    };

    boot().catch((error) => {
      console.error('Minimalist failed to start:', error);
      window.showToast?.(`Minimalist failed to start: ${error.message || error}`);
    });

    return () => {
      cancelled = true;
      document.title = oldTitle;
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, []);
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

function renderChatShell() {
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
      null,
      "\n        ",
      h(
        "a",
        {
          href: "/",
          id: "nav-logo",
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
          },
          h("i", {
              className: "ph-bold ph-house",
            })
        ),
        "\n            ",
        h(
          "a",
          {
            href: "/story",
            className: "rail-icon guest-only",
            title: "Story",
          },
          h("i", {
              className: "ph-bold ph-book-open",
            })
        ),
        "\n            ",
        h(
          "a",
          {
            href: "/chat",
            className: "rail-icon auth-only hidden",
            title: "Chat",
          },
          h("i", {
              className: "ph-bold ph-chats",
            })
        ),
        "\n            ",
        h(
          "button",
          {
            className: "rail-icon auth-only hidden",
            id: "open-contacts-btn",
            title: "Contacts",
          },
          h("i", {
              className: "ph-bold ph-users",
            })
        ),
        "\n            ",
        h(
          "button",
          {
            className: "rail-icon auth-only hidden",
            id: "open-personal-agent-btn",
            title: "Personal AI Agent",
          },
          h("i", {
              className: "ph-bold ph-sparkle",
            })
        ),
        "\n            ",
        h(
          "button",
          {
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
        "\n\n            ",
        h("div", {
            style: { flexGrow: "1", width: "100%", minHeight: "20px" },
          }),
        "\n\n            ",
        h(
          "a",
          {
            href: "#",
            id: "open-updates-btn-desktop",
            className: "rail-icon auth-only hidden",
            title: "Updates",
          },
          h("i", {
              className: "ph-bold ph-bell",
            })
        ),
        "\n            ",
        h(
          "button",
          {
            className: "rail-icon auth-only hidden",
            id: "open-search-btn",
            title: "Search",
          },
          h("i", {
              className: "ph-bold ph-magnifying-glass",
            })
        ),
        "\n            ",
        h(
          "button",
          {
            className: "rail-icon auth-only hidden",
            id: "open-settings-btn",
            title: "Settings",
          },
          h("i", {
              className: "ph-bold ph-gear",
            })
        ),
        "\n            ",
        h(
          "a",
          {
            href: "/login",
            className: "rail-icon guest-only",
            title: "Login",
          },
          h("i", {
              className: "ph-bold ph-sign-in",
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
            className: "action-btn mobile-link-btn auth-only",
            id: "open-rooms-btn-mobile",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-chats",
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
            className: "action-btn mobile-link-btn auth-only",
            id: "open-contacts-btn-mobile",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-users",
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
            className: "action-btn mobile-link-btn auth-only",
            id: "open-vault-btn-mobile",
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
            className: "action-btn mobile-link-btn auth-only",
            id: "open-updates-btn-mobile",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-bell",
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
            className: "action-btn mobile-link-btn auth-only",
            id: "open-settings-btn-mobile",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-gear",
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
        h(
          "div",
          {
            className: "boot-line is-complete boot-line-static",
          },
          h("span", { className: "boot-line-no" }, "00"),
          h("span", { className: "boot-status" }, "run"),
          h(
            "span",
            {
              className: "boot-code",
            },
            h("span", { className: "boot-key" }, "session"),
            h("span", { className: "boot-punc" }, "."),
            h("span", { className: "boot-fn" }, "prepare"),
            h("span", { className: "boot-punc" }, "("),
            h("span", { className: "boot-string" }, "\"identity\""),
            h("span", { className: "boot-punc" }, ")"),
            h("span", { className: "boot-muted" }, " // waiting for auth")
          ),
          h("span", { className: "boot-cursor" })
        ),
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
                  title: "Collapse rooms",
                  "aria-label": "Collapse rooms",
                },
                h("i", {
                    className: "ph-bold ph-sidebar",
                  })
              ),
              "\n                        ",
              h(
                "button",
                {
                  className: "close-panel mobile-only",
                  id: "close-mobile-rooms-btn",
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
              },
              "+ New room"
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "join-room-btn",
                className: "room-action-btn btn-light",
              },
              "→] Join"
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
                style: { border: "none", boxShadow: "none", padding: "0", margin: "0", marginRight: "15px", fontSize: "1.5rem", background: "transparent", cursor: "pointer" },
              },
              h("i", {
                  className: "ph-bold ph-arrow-left",
                })
            ),
            "\n                    \n                    ",
            h(
              "div",
              {
                id: "room-name-wrapper",
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
                style: { marginLeft: "auto", display: "flex", alignItems: "center", position: "relative" },
              },
              "\n                        ",
              h("input", {
                  type: "text",
                  id: "room-search-input",
                  className: "header-search-input",
                  placeholder: "Search...",
                  autoComplete: "off",
                }),
              "\n                        ",
              h(
                "div",
                {
                  id: "toggle-room-search-btn",
                  title: "Search Messages",
                  style: { background: "transparent", border: "none", boxShadow: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--text-color)", padding: "0", margin: "0", display: "flex", alignItems: "center", justifyContent: "center", width: "35px", height: "35px", lineHeight: "1", outline: "none" },
                },
                "\n                            ",
                h("i", {
                    className: "ph-bold ph-magnifying-glass",
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
              style: { display: "flex", gap: "2rem", padding: "0 1.5rem", background: "var(--bg-color)", alignItems: "center" },
            },
            "\n                    ",
            h(
              "button",
              {
                className: "room-tab",
                "data-target": "home",
              },
              h("i", { className: "ph-bold ph-house" }),
              h("span", null, "Home")
            ),
            "\n                    ",
            h(
              "button",
              {
                className: "room-tab active",
                "data-target": "chat",
              },
              h("i", { className: "ph-bold ph-chat-circle-text" }),
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
                      className: "ph-bold ph-arrow-right",
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
    h(
      "div",
      {
        id: "updates-panel",
      },
      "\n        ",
      h(
        "div",
        {
          className: "contacts-header",
          style: { flexDirection: "column", alignItems: "flex-start", gap: "10px", paddingBottom: "0" },
        },
        "\n            ",
        h(
          "div",
          {
            style: { display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" },
          },
          "\n                ",
          h(
            "span",
            {
              style: { fontSize: "1.2rem", fontWeight: "800" },
            },
            "Updates"
          ),
          "\n                ",
          h(
            "span",
            {
              className: "close-panel",
              id: "close-updates-btn",
            },
            "✖"
          ),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "update-tabs",
          },
          "\n                ",
          h(
            "button",
            {
              className: "update-tab active",
              id: "tab-notifications",
            },
            "Activity"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "update-tab",
              id: "tab-quests",
            },
            "Quests"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "update-tab",
              id: "tab-leaderboard",
            },
            "Leaderboard"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "update-tab",
              id: "tab-recognition",
            },
            "Recognition"
          ),
          "\n                ",
          h(
            "button",
            {
              className: "update-tab",
              id: "tab-changelog",
            },
            "Changelog"
          ),
          "\n            "
        ),
        "\n        "
      ),
      "\n        \n        ",
      h(
        "ul",
        {
          id: "notifications-list",
          style: { listStyle: "none", overflowY: "auto", flex: "1", padding: "1.5rem", margin: "0", display: "flex", flexDirection: "column", gap: "0.8rem" },
        },
        "\n            ",
        h(
          "div",
          {
            style: { textAlign: "center", color: "#888", marginTop: "2rem", fontWeight: "bold" },
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-bell-slash",
              style: { fontSize: "3rem", marginBottom: "1rem", display: "block", color: "var(--text-color)" },
            }),
          "\n                You're all caught up!\n            "
        ),
        "\n        "
      ),
      "\n\n        ",
      h("ul", {
          id: "updates-list",
          className: "hidden",
        }),
      "\n        ",
      h("ul", {
          id: "leaderboard-list",
          className: "hidden",
          style: { listStyle: "none", overflowY: "auto", flex: "1", padding: "1rem", margin: "0", display: "flex", flexDirection: "column", gap: "0.5rem" },
        }),
      "\n        ",
      h("ul", {
          id: "recognition-list",
          className: "hidden",
          style: { listStyle: "none", overflowY: "auto", flex: "1", padding: "1rem", margin: "0", display: "flex", flexDirection: "column", gap: "0.6rem" },
        }),
      "\n        ",
      h("ul", {
          id: "quests-list",
          className: "hidden",
          style: { listStyle: "none", overflowY: "auto", flex: "1", padding: "1rem", margin: "0", display: "flex", flexDirection: "column", gap: "0.6rem" },
        }),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "contacts-panel",
      },
      "\n        ",
      h(
        "div",
        {
          className: "contacts-header",
        },
        "\n            ",
        h(
          "div",
          {
            className: "contacts-panel-title",
          },
          "\n                ",
          h("i", {
              className: "ph-bold ph-users",
            }),
          "\n                ",
          h(
            "div",
            null,
            "\n                    ",
            h("span", null, "People"),
            "\n                    ",
            h("strong", null, "Contacts"),
            "\n                "
          ),
          "\n            "
        ),
        h(
          "span",
          {
            className: "close-panel",
            id: "close-contacts-btn",
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
          "p",
          {
            className: "contacts-panel-subtitle",
          },
          "Find friends, requests, and people from shared rooms."
        ),
        "\n            ",
        h("i", {
            className: "ph-bold ph-magnifying-glass contacts-search-icon",
          }),
        h("input", {
            type: "text",
            id: "contact-search-input",
            autoComplete: "off",
            placeholder: "Search people...",
          }),
        "\n        "
      ),
      "\n        \n        ",
      h("ul", {
          id: "contacts-list",
        }),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "personal-ai-agent-panel",
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
          null,
          "Personal AI"
        ),
        h(
          "span",
          {
            className: "close-panel",
            id: "close-personal-agent-btn",
          },
          "✖"
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
          null,
          "Vault"
        ),
        h(
          "span",
          {
            className: "close-panel",
            id: "close-vault-btn",
          },
          "✖"
        ),
        "\n        "
      ),
      "\n        ",
      h("div", {
          id: "vault-root",
        }),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        id: "pm-popup",
        className: "hidden",
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
        className: "hidden brutalist-settings",
      },
      "\n        ",
      h(
        "button",
        {
          id: "close-settings-btn",
          className: "brutalist-close",
          title: "Close",
        },
        "✖"
      ),
      "\n        ",
      h(
        "div",
        {
          className: "settings-sidebar",
        },
        "\n            ",
        h(
          "h3",
          {
            className: "sidebar-header",
          },
          "USER SETTINGS"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab active",
            id: "tab-btn-profile",
          },
          "My Account"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab",
            id: "tab-btn-billing",
          },
          "Billing"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab",
            id: "tab-btn-app",
          },
          "Appearance"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab",
            id: "tab-btn-performance",
          },
          "Performance"
        ),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab",
            id: "tab-btn-notifications",
          },
          "Notifications"
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
              className: "settings-session-btn settings-session-logout",
              id: "logout-btn",
              type: "button",
            },
            h("i", {
              className: "ph-bold ph-sign-out",
            }),
            "Log Out"
          ),
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
            "Add User"
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
            "h2",
            {
              id: "profile-pane-title",
            },
            "My Account"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card profile-view-section",
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
                "\n                        "
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "preview-profile-btn",
                  className: "action-btn",
                  style: { width: "auto", margin: "0" },
                },
                "Preview Card"
              ),
              "\n                    "
            ),
            "\n                    ",
            h("div", {
                id: "settings-card-inline-preview",
                className: "hidden",
              }),
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
                "Add User"
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
              className: "settings-card profile-view-section",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "h3",
                {
                  className: "sidebar-header",
                  style: { border: "none", marginBottom: "0.5rem", padding: "0" },
                },
                "Account Safety"
              ),
              "\n                        ",
              h(
                "p",
                {
                  id: "settings-joined-date",
                  style: { fontWeight: "600", color: "#666", fontSize: "0.9rem", marginBottom: "0.2rem" },
                },
                "Joined: Loading..."
              ),
              "\n                        ",
              h(
                "p",
                {
                  id: "settings-user-email",
                  style: { fontWeight: "600", color: "#666", fontSize: "0.9rem", marginBottom: "0.2rem" },
                },
                "Email: Loading..."
              ),
              "\n                        ",
              h(
                "p",
                {
                  id: "settings-user-phone",
                  style: { fontWeight: "600", color: "#666", fontSize: "0.9rem" },
                },
                "Phone: Loading..."
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
                {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" },
                },
                "\n                            ",
                h(
                  "h3",
                  {
                    className: "sidebar-header",
                    style: { border: "none", margin: "0", padding: "0" },
                  },
                  "Public Profile"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "toggle-edit-btn",
                    style: { width: "auto", margin: "0", padding: "0.4rem 1rem" },
                  },
                  "Edit Profile"
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
              className: "settings-card profile-view-section",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card-body",
              },
              "\n                        ",
              h(
                "h3",
                {
                  className: "sidebar-header",
                  style: { border: "none", marginBottom: "0.5rem", padding: "0", color: "red" },
                },
                "Account Management"
              ),
              "\n                        ",
              h(
                "p",
                {
                  style: { fontWeight: "600", color: "#666", fontSize: "0.9rem" },
                },
                "Account deletion is permanent. Once you delete your account, there is no going back."
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "delete-account-btn",
                  style: { background: "transparent", color: "red", borderColor: "red", width: "auto", padding: "0.8rem 1.5rem", marginTop: "1rem", boxShadow: "4px 4px 0px red" },
                },
                "Delete Account"
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
          "\n                ",
          h(
            "h2",
            null,
            "Billing"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-card billing-current-card",
              style: { border: "4px solid var(--text-color)", boxShadow: "6px 6px 0px var(--accent-color)" },
            },
            "\n                    ",
            h(
              "div",
              {
                className: "billing-current-body",
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 2rem", background: "var(--accent-color)", color: "var(--text-color)" },
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "billing-current-info",
                  style: { display: "flex", flexDirection: "column", gap: "0.3rem" },
                },
                "\n                            ",
                h(
                  "span",
                  {
                    style: { fontSize: "0.85rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "1px" },
                  },
                  "Current Plan"
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    id: "billing-plan-name",
                    style: { fontSize: "1.8rem", fontWeight: "800", lineHeight: "1" },
                  },
                  "Minimalist Base"
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    id: "billing-tier-badge",
                    className: "tier-badge base",
                    style: { width: "fit-content" },
                  },
                  "BASE"
                ),
                "\n                            ",
                h(
                  "span",
                  {
                    id: "billing-plan-limits",
                    style: { fontSize: "0.85rem", fontWeight: "800" },
                  },
                  "10MB per file · 500MB/day · Screen share 720p/30"
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "manage-billing-btn",
                  style: { width: "auto", margin: "0", padding: "0.6rem 1.5rem", background: "var(--bg-color)", color: "var(--text-color)", boxShadow: "4px 4px 0px var(--text-color)", fontSize: "1rem" },
                },
                "Manage"
              ),
              "            \n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "settings-card hidden stripe-embedded-card",
              id: "stripe-embedded-checkout-card",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "stripe-embedded-header",
              },
              "\n                        ",
              h(
                "div",
                null,
                "\n                            ",
                h(
                  "span",
                  {
                    className: "stripe-embedded-kicker",
                  },
                  "Secure Stripe Checkout"
                ),
                "\n                            ",
                h(
                  "h3",
                  {
                    id: "stripe-embedded-title",
                  },
                  "Upgrade"
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "stripe-embedded-close",
                  className: "mini-btn",
                  type: "button",
                },
                "Close"
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "p",
              {
                id: "stripe-embedded-status",
                className: "stripe-embedded-status",
              },
              "Stripe is loading securely inside this page…"
            ),
            "\n                    ",
            h("div", {
                id: "stripe-embedded-checkout",
                className: "stripe-embedded-checkout",
              }),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              className: "billing-plan-grid",
              style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" },
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card billing-plan-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "settings-card-body billing-plan-body",
                },
                "\n                            ",
                h(
                  "h3",
                  null,
                  "Advanced"
                ),
                "\n                            ",
                h(
                  "h2",
                  {
                    style: { border: "none", margin: "0" },
                  },
                  "$1.99",
                  h(
                    "span",
                    null,
                    "/mo"
                  )
                ),
                "\n                            ",
                h(
                  "ul",
                  {
                    style: { listStyle: "none", margin: "1rem 0", fontWeight: "600", fontSize: "0.9rem" },
                  },
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ 700MB per file"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ 1.5GB daily upload cap"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Create up to 5 rooms"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Screen share 1080p/60"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Advanced tier badge"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Everything in Base"
                  ),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "upgrade-advanced-btn",
                    className: "action-btn",
                    style: { width: "100%" },
                  },
                  "Upgrade"
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card billing-plan-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "settings-card-body billing-plan-body",
                },
                "\n                            ",
                h(
                  "h3",
                  null,
                  "Pro"
                ),
                "\n                            ",
                h(
                  "h2",
                  {
                    style: { border: "none", margin: "0" },
                  },
                  "$3.99",
                  h(
                    "span",
                    null,
                    "/mo"
                  )
                ),
                "\n                            ",
                h(
                  "ul",
                  {
                    style: { listStyle: "none", margin: "1rem 0", fontWeight: "600", fontSize: "0.9rem" },
                  },
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ 3GB per file"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ 9GB daily upload cap"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Unlimited room creation"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Room analytics"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Video calls"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Screen share at system limit"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Pro tier badge"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Personal AI Agent"
                  ),
                  "\n                                ",
                  h(
                    "li",
                    null,
                    "✓ Offline Viewing"
                  ),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "upgrade-pro-btn",
                    className: "action-btn",
                    style: { width: "100%" },
                  },
                  "Upgrade"
                ),
                "\n                        "
              ),
              "\n                    "
            ),
            "\n                "
          ),
          "\n            "
        ),
        "\n            \n            ",
        h(
          "div",
          {
            className: "settings-pane hidden",
            id: "pane-performance",
          },
          "\n                ",
          h("h2", null, "Performance"),
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
            "h2",
            null,
            "Appearance"
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
                style: { display: "flex", gap: "1rem" },
              },
              "\n                        ",
              h(
                "button",
                {
                  className: "action-btn theme-select-btn",
                  "data-theme": "light",
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
                  style: { flex: "1", margin: "0" },
                },
                "Modern ✨"
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
          h("h2", null, "Notifications"),
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
                "Control room alerts, mentions, keyword alerts, digests, Do Not Disturb, schedules, and phone notifications from one place."
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
                h("span", null, h("i", { className: "ph-bold ph-device-mobile" }), " Phone alerts"),
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
      " \n    "
    ),
    " \n\n    ",
    h(
      "div",
      {
        id: "user-profile-popup",
        className: "hidden",
      },
      "\n        ",
      h(
        "div",
        {
          className: "profile-banner",
          id: "up-banner",
        },
        "\n            ",
        h(
          "div",
          {
            className: "profile-popup-more",
            id: "more-profile-btn",
          },
          h("i", {
              className: "ph-bold ph-dots-three",
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
            },
            "Name"
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
        h(
          "div",
          {
            className: "profile-spotlight",
            id: "up-spotlight",
          },
          "\n                ",
          h(
            "button",
            {
              id: "up-spotlight-btn",
              className: "ai-btn ai-btn-ghost",
            },
            h("i", {
                className: "ph-bold ph-sparkle",
              }),
            " AI Spotlight"
          ),
          "\n            "
        ),
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
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card room-action-card",
          id: "room-action-card",
          style: { width: "90%", maxWidth: "520px", padding: "2rem", textAlign: "left" },
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
              },
              "\n                        ",
              h("i", { className: "ph-bold ph-planet" }),
              "\n                        ",
              h(
                "span",
                null,
                "Club or community"
              ),
              "\n                        ",
              h(
                "small",
                null,
                "A more organized room for clubs, creators, teams, or public groups."
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
            "\n                "
          ),
          "\n            "
        ),
        "\n            ",
        h(
          "button",
          {
            id: "room-create-back-btn",
            className: "hidden",
            style: { background: "transparent", color: "var(--text-color)", marginTop: "1rem", border: "2px solid var(--text-color)", boxShadow: "none" },
          },
          "Back"
        ),
        "\n            ",
        h(
          "button",
          {
            id: "room-action-submit",
            style: { background: "var(--text-color)", color: "var(--bg-color)", marginTop: "1rem" },
          },
          "Join"
        ),
        "\n            ",
        h(
          "button",
          {
            id: "close-room-action-btn",
            style: { background: "transparent", color: "var(--text-color)", marginTop: "0.5rem", border: "2px solid var(--text-color)", boxShadow: "none" },
          },
          "Cancel"
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
        className: "hidden modal-overlay room-settings-overlay",
        style: { zIndex: "6000", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card room-settings-card room-settings-modern",
          id: "room-settings-card",
          style: { width: "90%", maxWidth: "700px", height: "70vh", padding: "0", textAlign: "left", display: "flex", flexDirection: "row", overflow: "hidden", background: "var(--bg-color)" },
        },
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
          "div",
          {
            className: "settings-sidebar",
            style: { width: "30%", minWidth: "180px", padding: "1.5rem", borderRight: "4px solid var(--text-color)" },
          },
          "\n                \n                ",
          h(
            "h3",
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
              className: "settings-tab active",
              id: "rs-tab-overview",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-squares-four" }),
            h("span", null, "Overview")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-members",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-users-three" }),
            h("span", null, "Members")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-channels",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-hash" }),
            h("span", null, "Channels")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-permissions",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-shield-check" }),
            h("span", null, "Permissions")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-webhooks",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-plugs-connected" }),
            h("span", null, "Platform")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-subscription",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-currency-circle-dollar" }),
            h("span", null, "Subscription")
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-logs",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            h("i", { className: "ph-bold ph-clock-counter-clockwise" }),
            h("span", null, "Audit Logs")
          ),
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
            "\n                    ",
            h(
              "section",
              {
                className: "member-permissions-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "member-permissions-head",
                },
                h(
                  "div",
                  null,
                  h("p", { className: "rs-mini-kicker" }, "User overrides"),
                  h("h3", null, "Individual user permissions")
                ),
                h("span", null, "Inherit, allow, or deny per member")
              ),
              "\n                        ",
              h(
                "p",
                {
                  className: "member-permissions-copy",
                },
                "Room permissions set the default. User overrides let you make exceptions for specific members without changing the whole room."
              ),
              "\n                        ",
              h("div", {
                id: "rs-member-permissions-list",
                className: "member-permissions-list",
              }),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          h(
            "div",
            {
              id: "rs-pane-channels",
              className: "rs-pane hidden",
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
                null,
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
            },
            "\n                    ",
            h(
              "h2",
              {
                style: { borderBottom: "3px solid var(--text-color)", paddingBottom: "0.5rem", marginBottom: "1rem" },
              },
              "Permissions"
            ),
            "\n                    ",
            h(
              "p",
              {
                style: { fontSize: "0.9rem", fontWeight: "600", color: "#666", marginBottom: "1rem" },
              },
              "Fine-grained controls for what members can do in this room."
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "permission-grid",
              },
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-chat",
                    defaultChecked: true,
                  }),
                " Members can send chat messages"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-files",
                    defaultChecked: true,
                  }),
                " Members can upload files"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-polls",
                    defaultChecked: true,
                  }),
                " Members can create polls"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-reminders",
                    defaultChecked: true,
                  }),
                " Members can create reminders"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-docs",
                    defaultChecked: true,
                  }),
                " Members can edit docs"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-whiteboard",
                    defaultChecked: true,
                  }),
                " Members can use whiteboard"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-calls",
                    defaultChecked: true,
                  }),
                " Members can join voice calls"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-video",
                    defaultChecked: true,
                  }),
                " Pro members can join video calls"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-screen-share",
                    defaultChecked: true,
                  }),
                " Members can share screen"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-invites",
                    defaultChecked: true,
                  }),
                " Members can invite people"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-create-channels",
                    defaultChecked: true,
                  }),
                " Members can create channels"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-manage-channels",
                    defaultChecked: false,
                  }),
                " Members can manage channels"
              ),
              "\n                        ",
              h(
                "label",
                null,
                h("input", {
                    type: "checkbox",
                    id: "perm-webhooks",
                    defaultChecked: false,
                  }),
                " Members can manage webhooks"
              ),
              "\n                    "
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "rs-save-permissions-btn",
                className: "action-btn",
                style: { width: "100%", marginTop: "1rem" },
              },
              "Save Permissions"
            ),
            "\n                "
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-webhooks",
              className: "rs-pane hidden",
            },
            "\n                    ",
            h(
              "h2",
              {
                style: { borderBottom: "3px solid var(--text-color)", paddingBottom: "0.5rem", marginBottom: "1rem" },
              },
              "Platform & Ecosystem"
            ),
            "\n                    ",
            h(
              "p",
              {
                style: { fontSize: "0.9rem", fontWeight: "600", color: "#666", marginBottom: "1rem" },
              },
              "Extend the platform with integrations, developer tools, and room bots."
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "platform-section-grid",
              },
              h(
                "section",
                {
                  className: "platform-card",
                },
                h("p", { className: "platform-kicker" }, "Integrations"),
                h("h3", null, "Connect your workflow"),
                h(
                  "div",
                  {
                    className: "platform-chip-row",
                  },
                  ["GitHub", "Notion", "Jira", "Trello", "Google Calendar", "Google Drive"].map((label) => h("span", { key: label }, label))
                )
              ),
              h(
                "section",
                {
                  className: "platform-card",
                },
                h("p", { className: "platform-kicker" }, "Developer Platform"),
                h("h3", null, "Build on Minimalist"),
                h(
                  "div",
                  {
                    className: "platform-chip-row",
                  },
                  ["Public API", "Webhooks", "OAuth Apps", "Custom Bots", "Bot Marketplace", "Automation Builder"].map((label) => h("span", { key: label }, label))
                )
              )
            ),
            "\n                    ",
            h(
              "h3",
              {
                className: "platform-subhead",
              },
              "Webhooks"
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
                "WEBHOOK URL"
              ),
              "\n                        ",
                h("input", {
                  type: "text",
                  id: "rs-webhook-input",
                  placeholder: "https://...",
                }),
              "\n                    "
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "input-group",
                style: { marginTop: "0.85rem" },
              },
              "\n                        ",
              h(
                "label",
                null,
                "POST FROM CHANNEL"
              ),
              "\n                        ",
              h("select", {
                  id: "rs-webhook-channel",
                }),
              "\n                    "
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "rs-save-webhook",
                className: "action-btn",
                style: { width: "100%" },
              },
              "Save Integration"
            ),
            "\n                    ",
            h(
              "h3",
              {
                className: "platform-subhead",
              },
              "Bot Marketplace"
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "bot-marketplace-grid",
              },
              h(
                "section",
                {
                  className: "bot-marketplace-card",
                },
                h(
                  "div",
                  {
                    className: "bot-card-head",
                  },
                  h("span", { className: "bot-card-icon" }, h("i", { className: "ph-bold ph-trend-up" })),
                  h("div", null, h("h4", null, "Stock Price Tracker"), h("p", null, "Replies to /stock AAPL and watched $TICKER mentions."))
                ),
                h(
                  "label",
                  {
                    className: "bot-toggle-row",
                  },
                  h("input", { type: "checkbox", id: "rs-stock-bot-enabled" }),
                  h("span", null, "Install stock tracker")
                ),
                h("label", { className: "bot-field-label", htmlFor: "rs-stock-symbols" }, "Watch symbols"),
                h("input", { type: "text", id: "rs-stock-symbols", placeholder: "AAPL, TSLA, MSFT" })
              ),
              h(
                "section",
                {
                  className: "bot-marketplace-card",
                },
                h(
                  "div",
                  {
                    className: "bot-card-head",
                  },
                  h("span", { className: "bot-card-icon" }, h("i", { className: "ph-bold ph-shield-check" })),
                  h("div", null, h("h4", null, "Auto Moderation"), h("p", null, "Blocks configured keywords, link spam, flood text, and excessive caps."))
                ),
                h(
                  "label",
                  {
                    className: "bot-toggle-row",
                  },
                  h("input", { type: "checkbox", id: "rs-automod-bot-enabled" }),
                  h("span", null, "Install auto moderation")
                ),
                h("label", { className: "bot-field-label", htmlFor: "rs-automod-words" }, "Blocked words"),
                h("textarea", { id: "rs-automod-words", rows: 3, placeholder: "spam, scam, raid..." }),
                h(
                  "label",
                  {
                    className: "bot-toggle-row",
                  },
                  h("input", { type: "checkbox", id: "rs-automod-links" }),
                  h("span", null, "Block links")
                )
              )
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "rs-save-bots",
                className: "action-btn",
                style: { width: "100%" },
              },
              "Save Bot Marketplace"
            ),
            "\n                "
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-subscription",
              className: "rs-pane hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "room-subscription-hero",
              },
              h("p", { className: "platform-kicker" }, "Room subscription"),
              h("h2", null, "Boost this room"),
              h("p", null, "Give selected members bigger uploads, better calls, room analytics, and screen-share quality inside this room.")
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "room-subscription-grid",
                id: "rs-room-subscription-plans",
              },
              h(
                "label",
                { className: "room-subscription-card" },
                h("input", { type: "radio", name: "rs-room-subscription-plan", value: "base", id: "rs-room-plan-base", defaultChecked: true }),
                h("span", { className: "room-subscription-price" }, "Base room"),
                h("strong", null, "$0"),
                h("small", null, "Current room limits")
              ),
              h(
                "label",
                { className: "room-subscription-card featured" },
                h("input", { type: "radio", name: "rs-room-subscription-plan", value: "advanced", id: "rs-room-plan-advanced" }),
                h("span", { className: "room-subscription-price" }, "Advanced Room"),
                h("strong", null, "$9.99/mo"),
                h("small", null, "2GB/file · 4GB/day · Video calls · 1080p/60 screen share · Analytics · 20 selected users")
              ),
              h(
                "label",
                { className: "room-subscription-card" },
                h("input", { type: "radio", name: "rs-room-subscription-plan", value: "pro", id: "rs-room-plan-pro" }),
                h("span", { className: "room-subscription-price" }, "Pro Room"),
                h("strong", null, "$14.99/mo"),
                h("small", null, "3GB/file · 9GB/day · System-limit screen share · Advanced included · 50 selected users")
              )
            ),
            "\n                    ",
            h(
              "div",
              {
                className: "room-subscription-members",
              },
              h(
                "div",
                { className: "room-subscription-members-head" },
                h("div", null, h("h3", null, "Selected boosted users"), h("p", { id: "rs-room-subscription-limit" }, "Choose a paid plan to select users.")),
                h("span", { id: "rs-room-subscription-count" }, "0/0")
              ),
              h("div", { id: "rs-room-subscription-user-list", className: "room-subscription-user-list" })
            ),
            "\n                    ",
            h(
              "button",
              {
                id: "rs-save-room-subscription-btn",
                className: "action-btn",
                style: { width: "100%", marginTop: "1rem" },
                type: "button",
              },
              "Save Room Subscription"
            ),
            "\n                "
          ),
          "\n                \n                ",
          h(
            "div",
            {
              id: "rs-pane-logs",
              className: "rs-pane hidden",
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
        },
        "✖"
      ),
      "\n    "
    ),
    "\n"
  );
}

export default function ChatPage() {
  useChatBoot();
  useRoomNavMotion();
  useEffect(() => initModernThemeMotion(), []);
  return h('div', { className: 'react-page chat-react-page' }, renderChatShell());
}
