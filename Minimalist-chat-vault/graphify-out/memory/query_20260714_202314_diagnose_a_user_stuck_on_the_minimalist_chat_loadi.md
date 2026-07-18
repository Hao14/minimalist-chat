---
type: "query"
date: "2026-07-14T20:23:14.729046+00:00"
question: "Diagnose a user stuck on the Minimalist Chat loading screen using the supplied CSP console screenshots and browser log."
contributor: "graphify"
outcome: "useful"
source_nodes: ["4. Chat boot/loading timing", "Security and AI invariants"]
---

# Q: Diagnose a user stuck on the Minimalist Chat loading screen using the supplied CSP console screenshots and browser log.

## Answer

The log contained 68 Firebase RTDB long-poll URLs and 138 CSP block messages. Firebase browser long polling injects script tags from the exact RTDB origin, but production script-src omitted that origin, causing a reconnect loop while chat boot awaited profile hydration. Add only the exact RTDB origin to script-src, bound initial auth readiness, bound the profile read, and expose retry/sign-in recovery actions. The separate Cloudflare Insights block is non-critical analytics noise.

## Outcome

- Signal: useful

## Source Nodes

- 4. Chat boot/loading timing
- Security and AI invariants