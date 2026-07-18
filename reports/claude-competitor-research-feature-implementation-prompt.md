# Claude Desktop Task: Competitor Research + Feature Implementation

You are working in the local repo `C:\Users\jaysa\Documents\minimalist-chat`.

The user wants Claude Desktop / Opus 4.6 if available. If the desktop model selector only exposes a newer Opus model, use the available Opus model and state that in your final summary.

## Goal

Research and compare Minimalist Chat against respected chat/collaboration products, then implement the highest-impact safe local improvements.

Do not deploy.
Do not create a PR.
Do not revert unrelated user/Codex changes.
This repo is already dirty; only edit the regions needed for your chosen improvements.

## Current App Context

Minimalist Chat is a React 19 + Vite 6 PWA using Firebase Auth / Realtime Database / Functions, with rooms, channels, chat, docs, whiteboard, tasks, events/calendar, calls, AI, vault, contacts, themes, mobile/PWA features, and Firebase hosting/deploy tooling.

Recent areas the user cares about:

- Mobile-first UX and performance.
- Chat usability, Global Chat reliability, reaction menu behavior, catch-up/digest UI.
- Calls tab and multi-channel call experiences.
- AI tab polish and safe Ollama bridge usage.
- Public deploy readiness and Firebase rule safety.
- App-like experience on Android/tablet/desktop.
- Modern competitive features without bloating the app.

## Competitor Research Seeds

Use these as starting points and research more if needed:

- Discord Stage Channels: audience/speaker event model; voice/video/screen share for community events. Official references:
  - https://support.discord.com/hc/en-us/articles/1500005513722-Stage-Channels-FAQ
  - https://discord.com/stages
  - https://discord.com/blog/when-to-use-stage-channels-vs-voice-channels
- Slack Huddles: lightweight audio/video huddles inside channels/DMs, screen share, huddle thread/notes. Official references:
  - https://slack.com/features/huddles
  - https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack
- Slack Clips / Canvas: async audio/video context and durable room documents.
  - https://slack.com/features/clips
  - https://slack.com/features/canvas
- Telegram Folders / Channels: organizing large numbers of chats and broadcast-style channels.
  - https://telegram.org/tour/chat-folders
  - https://telegram.org/tour/channels
- Element / Matrix: secure collaboration, rooms/spaces, privacy/control, self-hosting angle.
  - https://element.io/
  - https://matrix.org/

## Research Deliverable

Create a short internal comparison in your final response:

- What Minimalist already does well.
- Feature gaps that matter most.
- What not to copy because it would add complexity or privacy/security risk.
- A prioritized list of features, with implementation effort and user impact.

## Implementation Rules

Implement only the best safe subset in this run. Prefer features that:

- Improve mobile/tablet UX immediately.
- Reduce friction in existing workflows.
- Are explainable and discoverable without adding tutorial text everywhere.
- Reuse existing data structures and components.
- Do not require a new paid backend, new external service, or broad Firebase rule rewrite.
- Can be verified with lint/build and local browser checks.

Good candidates:

1. Room/Channel Quick Switcher inspired by Discord/Slack/Telegram:
   - Search/filter rooms and channels from the chat UI.
   - Mobile-friendly overlay or command palette.
   - Keyboard shortcut optional, but do not rely on it.
   - Must avoid layout overlap and must work with existing room/channel state.

2. Lightweight “Huddle Notes” for Calls inspired by Slack Huddles:
   - A call/channel side panel or compact section for agenda/notes/action items.
   - Persist notes in existing Firebase room data only if rules already allow it; otherwise keep it local/session-only and state that.
   - Avoid starting media automatically or changing permission behavior.

3. Room Inbox / Unread grouping inspired by Telegram folders:
   - Better grouping/filtering of rooms, pinned/unread/recent.
   - Keep it client-side if easier.
   - Must improve mobile scan speed.

4. Async Update / Clip placeholder inspired by Slack Clips:
   - If real audio/video recording is too large, implement a UI affordance for “record/update coming soon” only if it is useful and not misleading.
   - Prefer text-based async update templates if implementing now.

5. Trust/Safety/Privacy polish inspired by Element:
   - Clearer privacy/security status in settings or room info.
   - Do not claim E2EE unless implemented.

## Hard Constraints

- No deploy.
- No PR.
- No broad rewrite.
- Do not add dependencies unless absolutely necessary.
- Do not edit generated files unless the repo clearly expects it.
- Keep accessibility strong: focus states, escape close, mobile touch targets, no text overflow, good aria labels.
- Avoid marketing-only changes; implement something usable inside the product.
- Do not add explanatory in-app paragraphs that make the UI feel like a tutorial.
- Keep changes compatible with existing light/dark/codex themes.

## Verification

Run:

```powershell
npm run lint
npm run build
```

If possible, run a local preview/dev server and visually check:

- Mobile width around 390px.
- Tablet width around 820px.
- Desktop width around 1280px.
- Login/marketing does not regress.
- Chat route does not crash.

## Final Summary Format

Report:

- Model used.
- Research comparison summary.
- Features implemented.
- Files changed.
- Tests run and results.
- What needs manual signed-in QA.
- Any risks or follow-up features you intentionally deferred.
