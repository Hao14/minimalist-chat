---
type: "query"
date: "2026-07-16T16:40:13.663505+00:00"
question: "Can Personal AI visibility also be an independent option on desktop?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Personal AI Agent", "Appearance", "Project Memory"]
---

# Q: Can Personal AI visibility also be an independent option on desktop?

## Answer

Expanded from the original query via vocab: [personal, agent, desktop, mobile, preference, control, feature, page, chat, local]. Implemented independent Desktop and Mobile Personal AI navigation preferences in Appearance settings. New per-surface keys override the legacy shared key, which remains a read-only fallback so existing users keep their prior choice. Programmatic opens infer the active surface at the 768px breakpoint, and an open Personal AI panel closes when resizing into a disabled surface. Verified asymmetric states, reload persistence, 320px navigation fit, and the 768/769px transition.

## Outcome

- Signal: useful

## Source Nodes

- Personal AI Agent
- Appearance
- Project Memory