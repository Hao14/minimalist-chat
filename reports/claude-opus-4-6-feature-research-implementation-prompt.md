# Claude Research Result: Minimalist Chat Feature Implementation Prompt

## Model And Research Notes

- Requested model/effort: Claude Opus 4.6, max effort.
- Actual Claude CLI model result: the `opus` alias resolved to Claude Opus 4.8 / `claude-opus-4-8`.
- Web research: available and used by Claude via WebSearch and WebFetch.
- Repo grounding: Claude read the app architecture, chat core, AI, calls, notifications, local AI client, RTDB rules, and existing audit reports.

Sources Claude cited:

1. https://slack.com/help/articles/23814859584659-Automations--Schedule-recurring-messages-in-a-channel
2. https://slack.com/help/articles/214888418-Set-default-Do-Not-Disturb-hours
3. https://slack.com/help/articles/208423427-Set-a-reminder
4. https://slack.com/features/huddles
5. https://slack.com/features/canvas
6. https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ
7. https://discord.com/blog/forum-channels-space-for-organized-conversation
8. https://support.discord.com/hc/en-us/articles/1500005513722-Stage-Channels-FAQ
9. https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ
10. https://telegram.org/blog/folders
11. https://telegram.org/blog/new-saved-messages-and-9-more
12. https://support.signal.org/hc/en-us/articles/360007320771-Set-and-manage-disappearing-messages
13. https://blog.whatsapp.com/now-you-can-edit-your-whatsapp-messages
14. https://www.opengraph.io/unfurl-url

## Competitive Findings

Minimalist Chat already does well:

- The composer is competitive: replies, polls, reminders, mentions, slash commands, smart replies, attachments, previews, scoped drafts, and typing indicators.
- Catch-up/digest already exists and is mobile-clamped.
- AI is differentiated through room agent, personal agent, Ollama/gateway support, and Bananas quota protection.
- Calls use WebRTC P2P with multi-channel behavior and permission gates.
- Recent security hardening is strong: owner-bound messages, trusted notification endpoint, App Check support, notification validation, rule hardening, and SSRF-aware webhook behavior.

Competitors are stronger at:

- Multiple reactions per user. Minimalist currently stores one reaction per user as `reactions/$uid = "<emoji>"`, so a second reaction replaces the first.
- Read state and unread navigation: unread dividers, per-channel badges, and jump-to-unread.
- Notification quiet-hours UI. Minimalist already enforces quiet hours in code, but the user-facing configuration surface is missing.
- Link previews/unfurls.
- Completing advertised slash commands, especially poll close/results and notification schedule.

Do not copy:

- Do not claim E2EE unless implemented.
- Do not present disappearing messages as real security.
- Do not chase large group/stage calls without an SFU backend.
- Do not add heavy automod before the core app is stable.
- Do not duplicate Docs/Whiteboard with another canvas/doc surface.
- Do not add friction-heavy onboarding gates.

## Highest-Impact Feature Opportunities

| Priority | Feature | Inspiration | Impact | Effort | Risk | Why now |
|---|---|---|---|---|---|---|
| 1 | Quiet Hours / Do Not Disturb config UI | Slack DND | High | Low | Low | Enforcement already exists; missing UI |
| 2 | Multiple reactions per user + quick tray | Discord, Slack, Telegram | High | Medium | Low-Medium | Current reaction model silently replaces reactions |
| 3 | Always-visible Bananas meter/explainer | Quota UX | Medium-High | Low | Low | User explicitly asked for Bananas clarity |
| 4 | Poll close + final results | Slack/poll apps | Medium | Low-Medium | Low | Finishes half-built poll feature |
| 5 | Jump-to-unread divider + room unread badges | Discord, Slack, Telegram | High | Medium | Low | Biggest navigation gap |
| 6 | Link unfurl previews | Slack, Discord, Telegram, WhatsApp | High | Medium | Medium | Needs SSRF-safe server fetch/cache |
| 7 | Slash palette honesty pass | UX hygiene | Medium | Low | Low | Many dead commands reduce trust |
| 8 | Voice messages | WhatsApp, Telegram | High | Medium-High | Medium | Strong mobile feature, but requires Storage/media QA |

## GPT/Codex Implementation Prompt

You are working in the existing repo `minimalist-chat`, a React 19 + Vite 6 PWA using Firebase RTDB/Auth/Functions/Hosting and Capacitor. The working tree is already dirty. Preserve unrelated user/Codex work. Implement only the scoped features below.

Hard constraints:

- Do not deploy.
- Do not run Firebase deploy, native builds, branch creation, commits, pushes, or PR creation.
- Do not rewrite unrelated modules.
- Do not add runtime dependencies.
- Do not claim end-to-end encryption or false privacy/security properties.
- Prefer existing Firebase data paths and local storage where possible.
- Mobile-first target is around `390x844`; tablet target around `820x1180`; desktop target around `1280x720`.

Known data paths:

- Global messages: `messages/$id`.
- Room messages: `rooms_data/$roomId/messages/$id`.
- Channel messages: `rooms_data/$roomId/channels/$channelId/messages/$id`.
- Current reactions: `.../$messageId/reactions/$uid = "<emoji>"`.
- Current poll votes: `.../$messageId/poll/votes/$uid`.
- Quiet-hours local keys already used by notification code:
  - `minimalist:notify-schedule` as `{ enabled, start, end }`
  - `minimalist:dnd` as `'on'`

Implement these first-pass items:

1. Quiet Hours / DND Configuration UI

- Likely files:
  - `src/features/notifications/notificationService.js`
  - `src/features/settings/settingsService.js`
  - `src/features/settings/SettingsWidgets.jsx`
  - `src/features/chat-core/ChatCore.jsx`
  - `public/features.css`
  - `public/mobile.css`
- Add a Notifications settings control for DND and quiet hours.
- DND writes `minimalist:dnd`.
- Quiet hours writes `minimalist:notify-schedule` with `enabled`, `start`, `end`.
- Defaults: `22:00` to `07:00`.
- Convert `/notify schedule` and `/notify dnd` from coming-soon entries to real handlers that open or focus the notification control.
- Acceptance:
  - Values persist across reload.
  - Active DND/quiet hours suppress visible in-app notifications through existing enforcement.
  - UI works at mobile width with readable labels and usable touch targets.

2. Multiple Reactions Per User + Quick Reaction Tray

- Likely files:
  - `src/features/chat-core/ChatCore.jsx`
  - `database.rules.json`
  - `tools/rtdb-rules-smoke-test.mjs`
  - `public/features.css`
  - `public/mobile.css`
- Migrate reaction writes from `reactions/$uid = "<emoji>"` to `reactions/$uid/$emoji = true`.
- Reader must support both:
  - Legacy string: `reactions/$uid = "👍"`
  - New map: `reactions/$uid = { "👍": true, "❤️": true }`
- Toggle behavior:
  - If user taps an emoji they already have, delete that emoji leaf.
  - If not present, set that emoji leaf to true.
- Update all three RTDB rules reaction blocks: global, room, channel.
- Writable leaf should be only `reactions/$uid/$emoji`.
- Validate auth ownership, existing parent message, and room/channel membership where applicable.
- Limit emoji key length to 32.
- Add or keep a compact quick tray in the message action rail.
- Acceptance:
  - Same user can add at least two distinct reactions to one message.
  - Counts aggregate by emoji.
  - Legacy reactions still render.
  - Non-members are denied.
  - Reaction tray stays inside the bubble on mobile and does not cover the composer.

3. Bananas Clarity Meter

- Likely files:
  - `src/features/ai/AI.jsx`
  - `src/features/ai/localAiClient.js`
  - `public/features.css`
- Show Banana tier/meter on AI tab load, not only after the first request.
- Plain copy: "Bananas are AI credits that protect the shared gateway. They refill every 5 hours, with a weekly cap by plan."
- Keep it compact; use an expandable/help affordance instead of a long paragraph.
- If live usage numbers are not available before the first request, show: "Live usage appears after your first request."
- Acceptance:
  - AI tab immediately shows tier and Bananas explanation.
  - After an AI request, live 5-hour/weekly used/limit and reset time still render.
  - No extra network call beyond the existing AI status probe.

4. Poll Close + Final Results

- Likely files:
  - `src/features/chat-core/ChatCore.jsx`
  - `database.rules.json`
  - `tools/rtdb-rules-smoke-test.mjs`
  - `public/features.css`
- Add `poll/closed` boolean and optional `poll/closedAt`.
- Only the message author can close the poll.
- Closed polls disable voting and show final tallies, closed badge, and winning option.
- Convert `/poll close` and `/poll results` from coming-soon entries to real handlers.
- Acceptance:
  - Poll author can close a poll.
  - Non-author cannot close it.
  - Closed polls block new votes and show final results.
  - Rules smoke covers author-close allowed and non-author denied.

5. Stretch: Jump-To-Unread Divider + Room Unread Badges

- Likely files:
  - `src/features/chat-core/ChatCore.jsx`
  - `database.rules.json`
  - `tools/rtdb-rules-smoke-test.mjs`
  - `public/features.css`
  - `public/mobile.css`
- Add per-user read markers:
  - `reads/$uid/$roomId = lastReadTimestamp`
  - Include channel if needed for multi-channel rooms.
- Rule: only `auth.uid === $uid` can write their own numeric read marker.
- Render "New messages" divider above first message newer than the marker.
- Add one-tap "Jump to unread".
- Add unread dot/count on room list items.
- Acceptance:
  - Returning to a room shows unread divider.
  - Jump moves to the first unread.
  - Room unread indicator clears when viewed.
  - Read state is isolated per user.

Verification:

```powershell
npm run lint
npm run audit:regression
npm run build
```

If rules changed and emulator is available:

```powershell
npm run audit:rules
```

If browser testing is available:

- Test `/`, `/login`, and `/chat`.
- Test mobile `390x844`, tablet `820x1180`, desktop `1280x720`.
- Check no console errors, no crash overlay, no horizontal overflow.
- Confirm reaction tray stays inside bubble.
- Confirm Quiet Hours and Bananas controls are reachable.

Do not deploy, commit, push, or create a PR.

## Recommended Implementation Scope For First Pass

1. Quiet Hours / DND configuration UI.
2. Multiple reactions per user + quick tray.
3. Bananas clarity meter.
4. Poll close + final results.
5. Jump-to-unread + unread badges only if time/risk allows.

## Defer

- Link previews/unfurls: needs an SSRF-guarded server endpoint and cache.
- Voice messages: needs MediaRecorder, Storage upload, playback UI, and real-device QA.
- Scheduled send: true scheduled delivery needs Cloud Scheduler/Functions.
- Disappearing messages: easy to misrepresent as security.
- Full threads/forum channels: broad UI/data rewrite.
- Closed-app native push: important, but needs device QA and deploy/native testing.
- Stage/broadcast calls: needs an SFU backend.
- Automated moderation suite: high false-positive and trust/safety risk.
