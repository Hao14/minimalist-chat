---
type: "implementation"
date: "2026-07-15T07:37:42.244836+00:00"
question: "Why do Remote Analysis controls overlap, and how should the Compact header behave?"
contributor: "graphify"
outcome: "useful"
---

# Q: Why do Remote Analysis controls overlap, and how should the Compact header behave?

## Answer

At 900 logical pixels the old one-row header gave the Remote desktop selector only 128 px before 14 px margins, below the native combo's practical requirement, while a visible Sign in button and auto-sized live status competed for width. The app now uses a two-row Compact header: title/live/Refresh on row one and the full-width Remote desktop/Sign in controls on row two, with explicit status width and ellipsis-safe remote copy. Standard and Wide remain one row.

## Outcome

- Signal: useful