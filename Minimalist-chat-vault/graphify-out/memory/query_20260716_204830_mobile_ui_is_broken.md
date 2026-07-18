---
type: "query"
date: "2026-07-16T20:48:30.751271+00:00"
question: "Mobile ui is broken"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Appearance", "Personal AI Agent", "7. CSS architecture risk", "Mobile-First Optimization Plan", "Resilient Service Worker Caching"]
---

# Q: Mobile ui is broken

## Answer

Expanded from original query via graph vocab: [mobile, layout, image, css, personal, agent, chat, appearance]. Graph orientation highlighted Appearance, Personal AI Agent, CSS architecture risk, Mobile-First Optimization Plan, and Resilient Service Worker Caching. Current-code verification found that Winston navigation images declared 512x512 and relied on mutable cached base.css to shrink them, so stale CSS expanded the mobile flex dock. The fix sets true 25x25 desktop and 24x24 mobile dimensions with inline and CSS min/max/flex bounds, bumps base and mobile stylesheet cache keys, and adds a regression test. Browser QA at 390x844 and 320x568 confirmed a 24x24 avatar, 68px dock, equal button widths, no overflow, and working Winston interaction even when the Winston CSS selector was absent.

## Outcome

- Signal: useful

## Source Nodes

- Appearance
- Personal AI Agent
- 7. CSS architecture risk
- Mobile-First Optimization Plan
- Resilient Service Worker Caching