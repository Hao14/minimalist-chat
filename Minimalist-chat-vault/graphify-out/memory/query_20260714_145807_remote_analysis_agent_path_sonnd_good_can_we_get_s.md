---
type: "query"
date: "2026-07-14T14:58:07.327008+00:00"
question: "remote analysis agent path sonnd good can we get started on that"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Desktop-only AI Control & Analysis", "Protected Ollama Public Gateway", "Desktop Control App", "Local Bridge", "Public HTTPS Tunnel"]
---

# Q: remote analysis agent path sonnd good can we get started on that

## Answer

Expanded from original query via vocab: [analysis, agent, desktop, local, bridge, gateway, authenticated, private, protected, tunnel, security, control]. Implemented the first secure slice as a separate read-only Windows Analysis agent bound only to 127.0.0.1:8791. It is intentionally separate from the protected Ollama bridge and ai.minimalist.chat, publishes only metadata health/activity through a separate analysis.minimalist.chat Cloudflare Access application, validates signed Access assertions by issuer, audience, and exact owner email, and exposes no remote controls, users, moderation, logs, paths, prompts, or credentials. A hidden non-elevated logon task launches the WinExe directly without runtime PowerShell. Cloudflare account values are required before the route and task are enabled.

## Outcome

- Signal: useful

## Source Nodes

- Desktop-only AI Control & Analysis
- Protected Ollama Public Gateway
- Desktop Control App
- Local Bridge
- Public HTTPS Tunnel