import { Fragment, createElement, useEffect } from 'react';

const h = createElement;

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
      if (!window.GCAL_CLIENT_ID || !window.STRIPE_CHECKOUT_ENDPOINT) {
        await loadConfigScript();
      }
      if (!cancelled) await import('../features/shell/chatApp.js');
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
              className: "ph ph-sparkle",
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
            id: "open-bookmarks-btn",
            title: "Saved",
          },
          h("i", {
              className: "ph-bold ph-bookmark-simple",
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
    "\n    \n    ",
    h(
      "div",
      {
        className: "container fade-in-up app-screen hidden",
        id: "profile-setup-container",
      },
      "\n        ",
      h(
        "h1",
        null,
        "Who are ",
        h(
          "span",
          null,
          "you?"
        )
      ),
      "\n        ",
      h("input", {
          type: "text",
          id: "new-display-name",
          placeholder: "Enter your display name",
        }),
      "\n        ",
      h("input", {
          type: "url",
          id: "new-photo-url",
          placeholder: "Image URL (Leave blank for auto)",
        }),
      "\n        ",
      h(
        "button",
        {
          id: "save-new-profile-btn",
        },
        "Enter Chat"
      ),
      "\n    "
    ),
    "\n\n    ",
    h(
      "div",
      {
        className: "app-screen hidden",
        id: "loading-screen",
        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-start", flex: "1", height: "100vh", padding: "3rem", position: "fixed", top: "0", left: "0", width: "100vw", zIndex: "9999", background: "var(--bg-color)", transition: "opacity 0.5s ease", boxSizing: "border-box" },
      },
      "\n        \n        ",
      h(
        "div",
        {
          style: { display: "flex", alignItems: "center", gap: "15px" },
        },
        "\n            ",
        h(
          "div",
          {
            className: "mascot-blip",
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
          style: { display: "flex", flexDirection: "column", gap: "10px", fontFamily: "monospace", fontSize: "1rem", fontWeight: "700", color: "var(--text-color)", textTransform: "uppercase" },
        },
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
                "Invite to Room"
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
              style: { display: "flex", gap: "2rem", padding: "0 1.5rem", background: "var(--bg-color)", alignItems: "center" },
            },
            "\n                    ",
            h(
              "button",
              {
                className: "room-tab",
                "data-target": "home",
              },
              "Home"
            ),
            "\n                    ",
            h(
              "button",
              {
                className: "room-tab active",
                "data-target": "chat",
              },
              "Chat"
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
          h(
            "div",
            {
              id: "room-view-home",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "rh-scroll",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "rh-stats",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rh-stat",
                  },
                  h("i", {
                      className: "ph-bold ph-chats",
                    }),
                  " ",
                  h(
                    "span",
                    {
                      id: "rh-msg-count",
                    },
                    "~"
                  ),
                  " Messages"
                ),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rh-stat",
                  },
                  h("i", {
                      className: "ph-bold ph-users",
                    }),
                  " ",
                  h(
                    "span",
                    {
                      id: "rh-member-count",
                    },
                    "1"
                  ),
                  " Members"
                ),
                "\n                            ",
                h("div", {
                    style: { flex: "1" },
                  }),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rh-created",
                  },
                  "Created ",
                  h(
                    "span",
                    {
                      id: "rh-created-date",
                    },
                    "Loading..."
                  )
                ),
                "\n                        "
              ),
              "\n\n                        ",
              h(
                "div",
                {
                  className: "rh-grid",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rh-col",
                  },
                  "\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-info",
                          }),
                        " About This Room"
                      ),
                      h("span", {
                          id: "rh-desc-head",
                        })
                    ),
                    "\n                                    ",
                    h("div", {
                        id: "rh-description-wrap",
                      }),
                    "\n                                "
                  ),
                  "\n\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-list-checks",
                          }),
                        " Room Rules"
                      ),
                      h("span", {
                          id: "rh-rules-head",
                        })
                    ),
                    "\n                                    ",
                    h("div", {
                        id: "rh-rules-wrap",
                      }),
                    "\n                                "
                  ),
                  "\n\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-activity",
                          }),
                        " Recent Activity"
                      )
                    ),
                    "\n                                    ",
                    h(
                      "ul",
                      {
                        id: "rh-activity-list",
                        className: "rh-activity",
                      },
                      h(
                        "li",
                        {
                          className: "rh-muted",
                        },
                        "Loading activity..."
                      )
                    ),
                    "\n                                "
                  ),
                  "\n                            "
                ),
                "\n\n                            ",
                h(
                  "div",
                  {
                    className: "rh-col",
                  },
                  "\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-push-pin",
                          }),
                        " Resources"
                      ),
                      h("span", {
                          id: "rh-resources-head",
                        })
                    ),
                    "\n                                    ",
                    h("div", {
                        id: "rh-resources-wrap",
                      }),
                    "\n                                "
                  ),
                  "\n\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-calendar-dots",
                          }),
                        " Upcoming Events"
                      ),
                      h("span", {
                          id: "rh-events-head",
                        })
                    ),
                    "\n                                    ",
                    h("div", {
                        id: "rh-events-wrap",
                      }),
                    "\n                                "
                  ),
                  "\n\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-trophy",
                          }),
                        " Top Contributors"
                      )
                    ),
                    "\n                                    ",
                    h(
                      "div",
                      {
                        id: "rh-contributors-wrap",
                      },
                      h(
                        "div",
                        {
                          className: "rh-muted",
                        },
                        "Loading..."
                      )
                    ),
                    "\n                                "
                  ),
                  "\n\n                                ",
                  h(
                    "section",
                    {
                      className: "rh-section",
                    },
                    "\n                                    ",
                    h(
                      "div",
                      {
                        className: "rh-head",
                      },
                      h(
                        "h3",
                        null,
                        h("i", {
                            className: "ph-bold ph-users-three",
                          }),
                        " Members"
                      )
                    ),
                    "\n                                    ",
                    h(
                      "div",
                      {
                        id: "rh-members-list",
                        className: "rh-members",
                      },
                      h(
                        "span",
                        null,
                        "Loading..."
                      )
                    ),
                    "\n                                "
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
              id: "room-view-docs",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                id: "docs-list-view",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "docs-toolbar",
                },
                "\n                            ",
                h("input", {
                    type: "text",
                    id: "docs-search",
                    placeholder: "Search docs...",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "docs-new-btn",
                    id: "docs-new-btn",
                  },
                  h("i", {
                      className: "ph-bold ph-plus",
                    }),
                  " New doc"
                ),
                "\n                        "
              ),
              "\n                        ",
              h("div", {
                  className: "docs-tags",
                  id: "docs-tags",
                }),
              "\n                        ",
              h("div", {
                  className: "docs-grid",
                  id: "docs-grid",
                }),
              "\n                    "
            ),
            "\n\n                    ",
            h(
              "div",
              {
                id: "docs-editor-view",
                className: "hidden",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "docs-editor-bar",
                },
                "\n                            ",
                h(
                  "button",
                  {
                    className: "docs-icon-btn",
                    id: "doc-back-btn",
                  },
                  h("i", {
                      className: "ph-bold ph-arrow-left",
                    }),
                  " Back"
                ),
                "\n                            ",
                h("div", {
                    className: "doc-emoji-pick",
                    id: "doc-emoji-pick",
                  }),
                "\n                            ",
                h(
                  "span",
                  {
                    className: "doc-save-status",
                    id: "doc-save-status",
                  },
                  "Saved"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "docs-icon-btn danger",
                    id: "doc-delete-btn",
                  },
                  h("i", {
                      className: "ph-bold ph-trash",
                    })
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "docs-editor-body",
                },
                "\n                            ",
                h("input", {
                    type: "text",
                    id: "doc-title-input",
                    placeholder: "Untitled document",
                  }),
                "\n                            ",
                h("input", {
                    type: "text",
                    id: "doc-tags-input",
                    placeholder: "Tags (comma separated)",
                  }),
                "\n                            ",
                h("textarea", {
                    id: "doc-content-input",
                    placeholder: "Start writing... everyone in the room sees changes live.",
                  }),
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
              id: "room-view-whiteboard",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                id: "wb-toolbar",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "wb-tool-group",
                },
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-tool-btn active",
                    "aria-label": "Select",
                  },
                  h("i", {
                      className: "ph-bold ph-cursor",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-tool-btn",
                    id: "wb-add-note",
                    "aria-label": "Add note",
                  },
                  h("i", {
                      className: "ph-bold ph-file",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-tool-btn",
                    "aria-label": "Rectangle",
                  },
                  h("i", {
                      className: "ph-bold ph-square",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-tool-btn",
                    "aria-label": "Circle",
                  },
                  h("i", {
                      className: "ph-bold ph-circle",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-tool-btn",
                    "aria-label": "Text",
                  },
                  h("i", {
                      className: "ph-bold ph-text-t",
                    })
                ),
                "\n                        "
              ),
              "\n                        ",
              h("div", {
                  id: "wb-colors",
                }),
              "\n                        ",
              h(
                "div",
                {
                  className: "wb-zoom-controls",
                },
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-zoom-btn",
                    "aria-label": "Zoom out",
                  },
                  h("i", {
                      className: "ph-bold ph-magnifying-glass-minus",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-zoom-readout",
                  },
                  "100%"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-zoom-btn",
                    "aria-label": "Zoom in",
                  },
                  h("i", {
                      className: "ph-bold ph-magnifying-glass-plus",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "wb-zoom-btn",
                    "aria-label": "Undo",
                  },
                  h("i", {
                      className: "ph-bold ph-arrow-counter-clockwise",
                    })
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "span",
                {
                  id: "wb-hint",
                },
                "Middle-click to pan · Scroll to zoom"
              ),
              "\n                        ",
              h(
                "button",
                {
                  id: "wb-clear",
                },
                "Clear"
              ),
              "\n                    "
            ),
            "\n                    ",
            h("div", {
                id: "wb-canvas",
              }),
            "\n                "
          ),
          "\n\n                ",
          "\n                ",
          h(
            "div",
            {
              id: "room-view-tasks",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "tasks-toolbar",
              },
              "\n                        ",
              h("input", {
                  type: "text",
                  id: "task-input",
                  placeholder: "Add a task and press Enter...",
                }),
              "\n                        ",
              h(
                "button",
                {
                  id: "task-add-btn",
                },
                "Add"
              ),
              "\n                    "
            ),
            "\n                    ",
            h("div", {
                id: "tasks-board",
              }),
            "\n                "
          ),
          "\n\n                ",
          "\n                ",
          h(
            "div",
            {
              id: "room-view-events",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "events-page-scroll",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "events-head",
                },
                "\n                            ",
                h(
                  "h3",
                  null,
                  h("i", {
                      className: "ph-bold ph-calendar-dots",
                    }),
                  " Events"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "ev-page-add-btn",
                    className: "rh-add-btn hidden",
                  },
                  h("i", {
                      className: "ph-bold ph-plus",
                    }),
                  " New event"
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  id: "ev-page-form",
                  className: "rh-add-form hidden",
                },
                "\n                            ",
                h("input", {
                    type: "text",
                    id: "ev-page-title",
                    placeholder: "Event title...",
                  }),
                "\n                            ",
                h(
                  "div",
                  {
                    className: "rh-form-row",
                  },
                  "\n                                ",
                  h("input", {
                      type: "date",
                      id: "ev-page-date",
                    }),
                  "\n                                ",
                  h("input", {
                      type: "time",
                      id: "ev-page-time",
                    }),
                  "\n                            "
                ),
                "\n                            ",
                h("input", {
                    type: "text",
                    id: "ev-page-desc",
                    placeholder: "Details (optional)",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "rh-save-btn",
                    id: "ev-page-save",
                  },
                  "Add Event"
                ),
                "\n                        "
              ),
              "\n                        ",
              h("div", {
                  id: "events-page-list",
                }),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          "\n                ",
          h(
            "div",
            {
              id: "room-view-calendar",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "cal-wrap",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "cal-nav",
                },
                "\n                            ",
                h(
                  "button",
                  {
                    className: "cal-nav-btn",
                    id: "cal-prev-month",
                    title: "Previous month",
                  },
                  h("i", {
                      className: "ph-bold ph-caret-double-left",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "cal-nav-btn",
                    id: "cal-prev-week",
                    title: "Previous week",
                  },
                  h("i", {
                      className: "ph-bold ph-caret-left",
                    })
                ),
                "\n                            ",
                h("div", {
                    className: "cal-nav-label",
                    id: "cal-nav-label",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "cal-nav-btn",
                    id: "cal-next-week",
                    title: "Next week",
                  },
                  h("i", {
                      className: "ph-bold ph-caret-right",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "cal-nav-btn",
                    id: "cal-next-month",
                    title: "Next month",
                  },
                  h("i", {
                      className: "ph-bold ph-caret-double-right",
                    })
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    className: "cal-nav-btn cal-today-btn",
                    id: "cal-today",
                    title: "Jump to today",
                  },
                  "Today"
                ),
                "\n                        "
              ),
              "\n                        ",
              h(
                "div",
                {
                  className: "cal-top",
                },
                "\n                            ",
                h("div", {
                    className: "cal-daystrip",
                    id: "cal-daystrip",
                  }),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "cal-photo-btn",
                    className: "cal-photo-btn",
                    title: "Import events from a photo (AI)",
                  },
                  h("i", {
                      className: "ph-bold ph-camera",
                    })
                ),
                "\n                        "
              ),
              "\n\n                        ",
              h(
                "div",
                {
                  className: "cal-connect-banner",
                  id: "cal-connect-banner",
                },
                "\n                            ",
                h(
                  "div",
                  {
                    className: "cal-connect-left",
                  },
                  "\n                                ",
                  h("i", {
                      className: "ph-bold ph-warning-circle",
                    }),
                  "\n                                ",
                  h(
                    "span",
                    null,
                    "Connect Google Calendar to sync your real events."
                  ),
                  "\n                            "
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "cal-gcal-btn",
                    className: "cal-connect-link",
                  },
                  "Connect"
                ),
                "\n                        "
              ),
              "\n\n                        ",
              h("div", {
                  className: "cal-agenda",
                  id: "cal-agenda",
                }),
              "\n\n                        ",
              h(
                "div",
                {
                  className: "cal-add-row",
                  id: "cal-add-row",
                },
                "\n                            ",
                h(
                  "button",
                  {
                    id: "cal-add-btn",
                    className: "cal-add-btn",
                  },
                  h("i", {
                      className: "ph-bold ph-plus",
                    }),
                  " Add New Event"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "cal-import-btn",
                    className: "cal-add-btn hidden",
                  },
                  h("i", {
                      className: "ph-bold ph-arrows-clockwise",
                    }),
                  " Import from Google"
                ),
                "\n                        "
              ),
              "\n                        ",
              h("input", {
                  type: "file",
                  id: "cal-photo-input",
                  accept: "image/*",
                  className: "hidden",
                }),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          "\n                ",
          h(
            "div",
            {
              id: "room-view-ai",
              className: "room-view hidden",
            },
            "\n                    ",
            h(
              "div",
              {
                className: "ai-wrap",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "ai-head",
                },
                "\n                            ",
                h(
                  "h3",
                  null,
                  h("i", {
                      className: "ph-bold ph-sparkle",
                    }),
                  " AI Summary"
                ),
                "\n                            ",
                h(
                  "button",
                  {
                    id: "ai-refresh-btn",
                    className: "rh-add-btn",
                    title: "Re-read the room",
                  },
                  h("i", {
                      className: "ph-bold ph-arrows-clockwise",
                    }),
                  " Refresh"
                ),
                "\n                        "
              ),
              "\n                        ",
              h("div", {
                  id: "ai-output",
                  className: "ai-output",
                }),
              "\n                    "
            ),
            "\n                "
          ),
          "\n\n                ",
          "\n                ",
          h("div", {
              id: "room-view-calls",
              className: "room-view hidden",
            }),
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
            "Inbox"
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
          "span",
          null,
          "Contacts"
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
          style: { padding: "1rem", borderBottom: "4px solid var(--text-color)", background: "var(--bg-color)", flexShrink: "0" },
        },
        "\n            ",
        h("input", {
            type: "text",
            id: "contact-search-input",
            autoComplete: "off",
            placeholder: "Search for users...",
            style: { width: "100%", margin: "0", padding: "0.6rem 0.8rem", border: "3px solid var(--text-color)", borderRadius: "6px", fontSize: "0.95rem", fontWeight: "700", fontFamily: "inherit", background: "var(--bg-color)", color: "var(--text-color)" },
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
        h("div", {
            className: "settings-divider",
          }),
        "\n            ",
        h(
          "div",
          {
            className: "settings-tab danger",
            id: "logout-btn",
          },
          "Log Out"
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
              className: "settings-card",
              style: { border: "4px solid var(--text-color)", boxShadow: "6px 6px 0px var(--accent-color)" },
            },
            "\n                    ",
            h(
              "div",
              {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 2rem", background: "var(--accent-color)", color: "var(--text-color)" },
              },
              "\n                        ",
              h(
                "div",
                {
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
                  "10MB per file · 500MB/day"
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
              style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" },
            },
            "\n                    ",
            h(
              "div",
              {
                className: "settings-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "settings-card-body",
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
                className: "settings-card",
              },
              "\n                        ",
              h(
                "div",
                {
                  className: "settings-card-body",
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
            "\n                "
          ),
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
          className: "brutalist-auth-card",
          style: { width: "90%", maxWidth: "400px", padding: "2rem", textAlign: "center" },
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
          "div",
          {
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
        className: "hidden modal-overlay",
        style: { zIndex: "6000", display: "flex", justifyContent: "center", alignItems: "center" },
      },
      "\n        ",
      h(
        "div",
        {
          className: "brutalist-auth-card room-settings-card",
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
              id: "rs-tab-members",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            "Members"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-channels",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            "Channels"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-permissions",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            "Permissions"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-webhooks",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            "Webhooks"
          ),
          "\n                ",
          h(
            "div",
            {
              className: "settings-tab",
              id: "rs-tab-logs",
              style: { padding: "0.6rem", fontSize: "0.9rem" },
            },
            "Audit Logs"
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
            style: { flex: "1", padding: "2rem", overflowY: "auto" },
          },
          "\n                ",
          h(
            "div",
            {
              id: "rs-pane-members",
              className: "rs-pane",
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
                " Members can join calls/screen share"
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
              "Webhooks"
            ),
            "\n                    ",
            h(
              "p",
              {
                style: { fontSize: "0.9rem", fontWeight: "600", color: "#666", marginBottom: "1rem" },
              },
              "Integrate with Discord, Slack, or automated bots."
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
              "button",
              {
                id: "rs-save-webhook",
                className: "action-btn",
                style: { width: "100%" },
              },
              "Save Integration"
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
    h(
      "footer",
      null,
      "\n        ",
      h(
        "div",
        {
          className: "footer-links",
        },
        "\n            ",
        h(
          "a",
          {
            href: "/faq",
          },
          "FAQ"
        ),
        "\n            ",
        h(
          "a",
          {
            href: "/terms",
          },
          "Terms of Service"
        ),
        "\n            ",
        h(
          "a",
          {
            href: "/privacy",
          },
          "Privacy Policy"
        ),
        "\n            ",
        h(
          "a",
          {
            href: "mailto:support@minimalist.com",
          },
          "Contact"
        ),
        "\n            ",
        h(
          "a",
          {
            href: "https://github.com/Hao14/minimalist-chat/issues",
            target: "_blank",
            rel: "noopener noreferrer",
          },
          "Bug Report"
        ),
        "\n        "
      ),
      "\n        ",
      h(
        "div",
        {
          className: "footer-info",
          id: "live-clock",
        },
        "SYSTEM TIME: LOADING..."
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
  return h('div', { className: 'react-page chat-react-page' }, renderChatShell());
}
